/**
 * Manifest Loader
 *
 * `templates/manifests/*.json` 의 선언적 파일 매니페스트를 로드한다.
 * 각 매니페스트는 `{ template, output }` 항목 배열로 구성되며, output 은
 * Handlebars 변수(`{{basePackagePath}}`, `{{entityName}}` 등)를 포함할 수 있다.
 *
 * 설계 원칙
 * ---------
 * - **stack 매트릭스가 매니페스트를 가리킨다.** `templates/stacks.json` 의
 *   각 stack 항목에 `manifest` 경로를 적고, 라우팅은 매트릭스가 단일 출처가 된다.
 * - **Handlebars 단일 의존**: output 경로 렌더링도 .hbs 본문과 같은 Handlebars 를
 *   재사용한다. 새 의존성 없음.
 * - **순수 함수 + 캐시**: stack 매트릭스와 동일한 패턴으로 매니페스트 파일을
 *   메모리 캐시한다. 테스트는 `clearManifestCache()` 로 초기화.
 * - **외부 경로 오버라이드**: `EGOVFRAME_SCAFFOLD_TEMPLATE_PATH` 가 있으면
 *   그 디렉터리를 기준으로 매니페스트를 해석한다.
 *
 * 새 파일 추가 = 매니페스트 JSON 한 줄 추가, 코드 수정 0줄.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

/**
 * 매니페스트 항목의 생명주기 분류.
 * - `framework`: 프로젝트당 1회만 생성되는 골격/공통 인프라 (pom.xml, config/*, 페이징, 예외 핸들러 등).
 *   `egov_add_entity` 는 이 항목들을 건드리지 않는다 (이미 존재).
 * - `entity`: 엔티티마다 DDL 기반으로 새로 생성되는 CRUD 산출물 (VO, Service, Controller, Mapper, View 등).
 *   `egov_add_entity` 는 정확히 이 항목들만 추가한다.
 *
 * 매니페스트 JSON 에서 `scope` 가 생략되면 `framework` 로 간주한다.
 */
export type ManifestScope = "framework" | "entity";

/**
 * 매니페스트 항목의 적용 방식.
 * - `create` (기본): 새 파일을 생성. 동일 경로에 다른 내용 파일이 있으면 충돌.
 * - `append-idempotent`: 기존 파일 끝에 추가. 같은 키/내용이 이미 있으면 skip(멱등),
 *   같은 키가 다른 값으로 있으면 충돌. 주로 properties / 시드 SQL 보강.
 * - `append-fallback`: 우선 `appendTarget.glob` 의 단일 파일 끝에 append 시도.
 *   매칭 파일이 0개 또는 2개 이상이면 `output` 경로에 새 파일을 만들어 fallback.
 *
 * 매니페스트 JSON 에서 `mode` 가 생략되면 `create` 로 간주한다.
 */
export type ManifestMode = "create" | "append-idempotent" | "append-fallback";

/**
 * `append-fallback` / `append-idempotent` 모드가 사용할 append 대상 메타데이터.
 */
export interface AppendTarget {
  /**
   * 프로젝트 디렉터리 기준 glob 패턴. 예: 'src/main/resources/db/*.sql'.
   * Handlebars 변수 사용 가능 (`{{basePackagePath}}` 등).
   */
  glob: string;
  /**
   * `append-fallback` 전용. 이 값과 정확히 매칭되는 파일 수일 때만 append 를 시도한다.
   * 그 외(0개 또는 다른 개수)는 `output` 경로에 새 파일을 만들어 fallback.
   * 생략하면 `1` 로 간주.
   */
  matchCount?: number;
}

/**
 * 운영 DB 마이그레이션 SQL 의 dialect 분기에 사용되는 7개 방언.
 * `expandDialects: true` 인 매니페스트 항목은 이 배열을 순회해 7개의 출력으로 fan-out 된다.
 *
 * 순서/식별자는 `dialectFullType` 헬퍼(`src/utils/scaffold/dialectTypes.ts`) 가 받는 값과 일치해야 한다.
 * `mysql` 은 MySQL/MariaDB 양쪽에 공용 (동일 SQL 문법).
 */
export const SUPPORTED_DIALECTS = [
  "oracle",
  "tibero",
  "altibase",
  "cubrid",
  "goldilocks",
  "mysql",
  "postgres",
] as const;
export type SupportedDialect = (typeof SUPPORTED_DIALECTS)[number];

export interface ManifestEntry {
  /** 템플릿 디렉터리 기준 상대경로 (예: 'boot/pom.xml.hbs') */
  template: string;
  /**
   * 프로젝트 디렉터리 기준 상대경로. Handlebars 로 렌더링되며,
   * `ScaffoldContext` 의 모든 변수(`basePackagePath`, `packagePath`,
   * `entityName`, `entityModule`, `entityNameLower` 등)를 사용할 수 있다.
   */
  output: string;
  /** 생명주기 분류. 생략 시 'framework'. */
  scope?: ManifestScope;
  /**
   * true 이면 이 항목 하나가 `SUPPORTED_DIALECTS` 의 7개 방언으로 fan-out 된다.
   * 각 출력 렌더링 시 `dialect` 변수가 컨텍스트에 주입되므로 template 본문과 output 경로 모두
   * `{{dialect}}` 를 사용할 수 있다 (예: 'migrations/{{dialect}}/{{entityNameLower}}db.sql').
   * 운영 DB 마이그레이션 SQL 처럼 방언별 산출물이 필요할 때만 사용.
   */
  expandDialects?: boolean;
  /**
   * 항목 적용 방식. 생략 시 'create' — 신규 파일 emit, 충돌 시 거부.
   * 'append-idempotent' / 'append-fallback' 은 `appendTarget` 과 함께 사용.
   */
  mode?: ManifestMode;
  /** `append-*` 모드 전용 메타데이터. */
  appendTarget?: AppendTarget;
}

export interface ManifestFile {
  /** 매니페스트 식별자 (디버깅 메시지용). 매트릭스 키와 동일 권장. */
  name: string;
  files: ManifestEntry[];
}

export interface ResolvedFileMapping {
  template: string;
  /** 컨텍스트로 렌더링이 끝난 최종 출력 경로. */
  output: string;
  /** 항목의 생명주기 분류. 매니페스트에서 누락되었으면 'framework' 로 정규화된다. */
  scope: ManifestScope;
  /** 적용 방식. 매니페스트에서 누락되었으면 'create' 로 정규화. */
  mode: ManifestMode;
  /** `append-*` 모드 전용. 렌더링이 끝난 glob 경로. */
  appendTarget?: { glob: string; matchCount: number };
  /**
   * `expandDialects: true` 인 매니페스트 항목의 fan-out 결과. 채워져 있으면 렌더링 측은
   * 이 값을 컨텍스트의 `dialect` 변수로 주입해야 한다 (template 본문이 방언별 분기에 사용).
   */
  dialect?: SupportedDialect;
}

const cache = new Map<string, ManifestFile>();

/**
 * 테스트나 핫리로드 시 캐시를 비운다.
 */
export function clearManifestCache(): void {
  cache.clear();
}

/**
 * 매니페스트 파일의 절대 경로를 해석한다.
 * 우선순위:
 *   1. `manifestPath` 가 절대경로면 그대로 사용
 *   2. `EGOVFRAME_SCAFFOLD_TEMPLATE_PATH` 가 있으면 그 디렉터리 기준 상대 해석
 *   3. `<repo>/templates` 기준 상대 해석
 */
export function resolveManifestPath(manifestPath: string): string {
  if (path.isAbsolute(manifestPath)) return manifestPath;
  if (process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH) {
    return path.join(process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH, manifestPath);
  }
  try {
    const here = fileURLToPath(import.meta.url);
    const projectRoot = path.resolve(path.dirname(here), "../../..");
    return path.join(projectRoot, "templates", manifestPath);
  } catch {
    return path.join(process.cwd(), "templates", manifestPath);
  }
}

/**
 * 매니페스트 JSON 을 읽고 검증한 뒤 캐시한다.
 */
export function loadManifest(manifestPath: string): ManifestFile {
  const resolved = resolveManifestPath(manifestPath);
  const cached = cache.get(resolved);
  if (cached) return cached;

  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf-8");
  } catch (e) {
    throw new Error(
      `매니페스트를 읽을 수 없습니다 (${resolved}). templates/manifests/*.json 이 누락되었거나 EGOVFRAME_SCAFFOLD_TEMPLATE_PATH 가 잘못 지정되었는지 확인하세요. (${
        e instanceof Error ? e.message : "Unknown error"
      })`,
    );
  }
  let parsed: ManifestFile;
  try {
    parsed = JSON.parse(raw) as ManifestFile;
  } catch (e) {
    throw new Error(
      `매니페스트 파싱 실패 (${resolved}): ${
        e instanceof Error ? e.message : "Unknown error"
      }`,
    );
  }
  validateManifest(parsed, resolved);
  cache.set(resolved, parsed);
  return parsed;
}

/**
 * 매니페스트의 각 항목을 컨텍스트로 렌더링해 최종 파일 매핑을 만든다.
 * 컴파일된 Handlebars 템플릿은 항목별로 한 번만 만들고 즉시 버린다 — 매니페스트
 * 항목 수가 100여개로 작아 컴파일 비용이 무시할 수 있다.
 *
 * `scopeFilter` 가 주어지면 해당 scope 의 항목만 반환한다. 누락된 scope 는
 * 'framework' 로 정규화되므로 명시되지 않은 항목은 framework 필터에만 매칭된다.
 */
export function resolveManifest(
  manifestPath: string,
  context: Record<string, unknown>,
  scopeFilter?: ManifestScope,
): ResolvedFileMapping[] {
  const manifest = loadManifest(manifestPath);
  const entries = scopeFilter
    ? manifest.files.filter((e) => (e.scope ?? "framework") === scopeFilter)
    : manifest.files;
  const out: ResolvedFileMapping[] = [];
  for (const entry of entries) {
    const scope = entry.scope ?? "framework";
    const mode = entry.mode ?? "create";
    const resolveAppendTarget = (
      ctx: Record<string, unknown>,
    ): { glob: string; matchCount: number } | undefined => {
      if (!entry.appendTarget) return undefined;
      return {
        glob: renderOutput(entry.appendTarget.glob, ctx, manifest.name),
        matchCount: entry.appendTarget.matchCount ?? 1,
      };
    };
    if (entry.expandDialects) {
      // 방언별 fan-out: dialect 를 컨텍스트에 주입해 output 경로를 7번 렌더링.
      for (const dialect of SUPPORTED_DIALECTS) {
        const ctx = { ...context, dialect };
        out.push({
          template: entry.template,
          output: renderOutput(entry.output, ctx, manifest.name),
          scope,
          mode,
          appendTarget: resolveAppendTarget(ctx),
          dialect,
        });
      }
    } else {
      out.push({
        template: entry.template,
        output: renderOutput(entry.output, context, manifest.name),
        scope,
        mode,
        appendTarget: resolveAppendTarget(context),
      });
    }
  }
  return out;
}

function renderOutput(
  template: string,
  context: Record<string, unknown>,
  manifestName: string,
): string {
  // 출력 경로에는 변수가 없을 수도 있다. 변수 없으면 컴파일조차 건너뛴다.
  if (!template.includes("{{")) return template;
  try {
    return Handlebars.compile(template, { noEscape: true })(context);
  } catch (e) {
    throw new Error(
      `매니페스트 '${manifestName}' 의 output '${template}' 렌더링 실패: ${
        e instanceof Error ? e.message : "Unknown error"
      }`,
    );
  }
}

function validateManifest(file: ManifestFile, source: string): void {
  if (!file || typeof file !== "object") {
    throw new Error(`매니페스트 형식 오류 (${source}): 최상위 객체가 아닙니다.`);
  }
  if (typeof file.name !== "string" || !file.name) {
    throw new Error(`매니페스트 형식 오류 (${source}): 'name' 필드가 필요합니다.`);
  }
  if (!Array.isArray(file.files)) {
    throw new TypeError(`매니페스트 형식 오류 (${source}): 'files' 는 배열이어야 합니다.`);
  }
  for (const [idx, entry] of file.files.entries()) {
    if (
      !entry ||
      typeof entry.template !== "string" ||
      typeof entry.output !== "string" ||
      !entry.template ||
      !entry.output
    ) {
      throw new Error(
        `매니페스트 형식 오류 (${source}): files[${idx}] 항목에 template/output 문자열이 모두 필요합니다.`,
      );
    }
    if (entry.scope !== undefined && entry.scope !== "framework" && entry.scope !== "entity") {
      throw new Error(
        `매니페스트 형식 오류 (${source}): files[${idx}].scope 는 'framework' 또는 'entity' 여야 합니다 (현재: ${JSON.stringify(entry.scope)}).`,
      );
    }
    if (entry.expandDialects !== undefined && typeof entry.expandDialects !== "boolean") {
      throw new TypeError(
        `매니페스트 형식 오류 (${source}): files[${idx}].expandDialects 는 boolean 이어야 합니다 (현재: ${JSON.stringify(entry.expandDialects)}).`,
      );
    }
    if (entry.mode !== undefined && !["create", "append-idempotent", "append-fallback"].includes(entry.mode)) {
      throw new Error(
        `매니페스트 형식 오류 (${source}): files[${idx}].mode 는 'create'|'append-idempotent'|'append-fallback' 여야 합니다 (현재: ${JSON.stringify(entry.mode)}).`,
      );
    }
    if (entry.appendTarget !== undefined) {
      if (
        !entry.appendTarget ||
        typeof entry.appendTarget !== "object" ||
        typeof entry.appendTarget.glob !== "string" ||
        !entry.appendTarget.glob
      ) {
        throw new Error(
          `매니페스트 형식 오류 (${source}): files[${idx}].appendTarget 은 { glob: string, matchCount?: number } 구조여야 합니다.`,
        );
      }
      if (
        entry.appendTarget.matchCount !== undefined &&
        (typeof entry.appendTarget.matchCount !== "number" || entry.appendTarget.matchCount < 0)
      ) {
        throw new Error(
          `매니페스트 형식 오류 (${source}): files[${idx}].appendTarget.matchCount 는 0 이상 정수여야 합니다.`,
        );
      }
    }
    if ((entry.mode === "append-idempotent" || entry.mode === "append-fallback") && !entry.appendTarget) {
      throw new Error(
        `매니페스트 형식 오류 (${source}): files[${idx}].mode='${entry.mode}' 는 appendTarget 이 필수입니다.`,
      );
    }
  }
}
