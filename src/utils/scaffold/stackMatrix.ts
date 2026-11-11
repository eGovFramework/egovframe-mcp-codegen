/**
 * Stack Matrix Loader
 *
 * `templates/stacks.json` 의 호환성 매트릭스를 로드해 (projectType, stackVersion)
 * 조합으로 stack 메타데이터를 돌려준다. 템플릿과 scaffold 코드 양쪽이 같은
 * 데이터를 참조하도록 단일 출처로 만든다.
 *
 * 설계 원칙
 * ---------
 * - **순수 함수 + 캐시**: 매트릭스는 프로세스 수명 동안 1회만 읽고 메모리 캐시한다.
 *   테스트에서 caching 을 끄고 싶으면 `resolveStack` 호출 직전 `clearStackMatrixCache()`.
 * - **외부 경로 오버라이드**: `EGOVFRAME_SCAFFOLD_TEMPLATE_PATH` 또는
 *   `EGOVFRAME_STACK_MATRIX_PATH` 로 매트릭스 위치를 바꿀 수 있다. 조직별
 *   커스텀 스택을 검증할 때 유용하다.
 * - **모순 조합 차단**: `egov_scaffold_project` 의 Zod 스키마가 WAR + 5.0 을 이미
 *   차단하지만, 매트릭스에도 명시적으로 등재되지 않은 조합은 여기서 다시 막는다.
 *
 * 매트릭스 키 형식은 `templates/stacks.json` 의 `$comment` 를 참고할 것.
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

export type ProjectType = "boot" | "war";
export type StackVersion = "4.3" | "5.0";

export interface StackEntry {
  projectType: ProjectType;
  stackVersion: StackVersion;
  /** eGovFrame 메이저 버전 (예: '5.0.0', '4.3.0') */
  egovframe: string;
  /** Spring Boot 버전 (Boot 스택에서만 의미 있음) */
  springBoot: string | null;
  /** 전통 Spring 버전 (WAR 스택에서만 의미 있음) */
  spring: string | null;
  /** maven.compiler 의 source/target 으로 쓰이는 자바 버전 */
  java: string;
  /** Jakarta EE 이주 여부 (true=jakarta.*, false=javax.*) */
  jakarta: boolean;
  /** egovframe-rte 의존성 버전. Boot 5.0 처럼 starter-parent 가 대체하면 null. */
  rteVersion: string | null;
  /** pom.xml `<parent>` 의 groupId. 없는 스택은 null. */
  starterParentGroupId: string | null;
  /** pom.xml `<parent>` 의 artifactId. 없는 스택은 null. */
  starterParentArtifactId: string | null;
  /** pom.xml `<parent>` 의 version. 없는 스택은 null. */
  starterParentVersion: string | null;
  /** result 메시지에 노출되는 사람-읽기 좋은 프레임워크 라벨. */
  frameworkLabel: string;
  /** 정적 리소스 템플릿 디렉터리명 (`templates/<name>`). */
  staticAssets: "static" | "static50";
  /**
   * 파일 매니페스트 위치 (templates/ 기준 상대경로).
   * `manifestLoader.resolveManifest(manifest, ctx)` 가 이 경로를 읽어 최종 파일 매핑을 만든다.
   */
  manifest: string;
  /**
   * `egov_add_entity` 전용 마이그레이션 SQL 템플릿 경로 (templates/ 기준 상대경로).
   *
   * 첫 스캐폴드는 sampledb.sql 안에 엔티티 DDL 과 IDS 정의를 함께 만들지만,
   * 추가 엔티티는 IDS 테이블 정의를 다시 만들면 안 된다(이미 존재). 이 템플릿은
   * "엔티티 CREATE TABLE + IDS row INSERT" 만 담아 사용자가 기존 시드에 합쳐
   * 적용할 수 있는 추가용 마이그레이션 파일을 만든다.
   *
   * 매니페스트와 분리되어 있는 이유: 이 산출물은 add_entity 전용이며 primary
   * 스캐폴드에는 의미가 없다. 매니페스트는 "엔티티 자체에 필요한 파일"만 다룬다.
   */
  addEntityMigration: string;
  /**
   * `egov_add_entity` 가 새 엔티티의 메시지 키들을 기존 메시지 번들 파일들에
   * append 할 때 사용하는 partial 템플릿 경로들 (templates/ 기준 상대경로).
   *
   * 첫 스캐폴드는 message-common.properties 안에 엔티티별 키(`title.{entity}.X`,
   * `confirm.required.{entity}.X` 등) 를 함께 만들지만, 추가 엔티티는 기존 공유
   * 번들에 자신의 키만 추가해 넣어야 한다. 이 partial 들은 그 "엔티티-only" 부분만
   * 담고, autoApplyMessages 옵션이 켜져 있을 때 기존 번들 파일 끝에 append 된다.
   *
   * - `defaultLocale`: message-common.properties + message-common_ko.properties 에 append
   * - `en`: message-common_en.properties 에 append
   */
  addEntityMessages: {
    defaultLocale: string;
    en: string;
  };
  /**
   * 엔티티 간 메뉴 네비게이션 fragment 의 템플릿/출력 경로.
   *
   * - `template`: templates/ 기준 상대경로 (예: 'boot50/thymeleaf/_fragments/nav.html.hbs')
   * - `output`: 프로젝트 루트 기준 상대경로 (예: 'src/main/resources/templates/thymeleaf/_fragments/nav.html')
   *
   * 첫 스캐폴드에서 framework scope 로 한 번 생성되고, 이후 `egov_add_entity` 가
   * `autoApplyMenu=true` 로 호출되면 동일 경로를 덮어써서 단일 출처를 유지한다.
   */
  navFragment: {
    template: string;
    output: string;
  };
  /**
   * `egov_add_query_view` 가 생성하는 산출물 목록. 정의가 없는 스택은 query view 미지원.
   *
   * - `template`: templates/ 기준 상대경로
   * - `output`: 프로젝트 루트 기준 상대경로. Handlebars 로 렌더링되며 사용 가능한 변수는
   *   `packagePath`, `basePackagePath`, `entityModule`, `viewName`.
   */
  queryView?: QueryViewFileSpec[];
  /**
   * true 면 `egov_add_query_view` 가 메시지 번들에 append 하는 값의 비 ASCII 문자를 \uXXXX 로
   * 이스케이프한다. messageSource 가 번들을 ISO-8859-1 로 읽는 스택(WAR 4.3)에서 한글 깨짐을 막는다.
   */
  messageUnicodeEscape?: boolean;
}

/** `StackEntry.queryView` 의 항목 1건 (템플릿 → 출력 경로). */
export interface QueryViewFileSpec {
  template: string;
  output: string;
}

interface StackSelection {
  projectType: ProjectType;
  stackVersion: StackVersion;
  stack: string;
}

interface StackMatrixFile {
  version: number;
  stacks: Record<string, StackEntry>;
  selection: StackSelection[];
}

let cachedMatrix: StackMatrixFile | undefined;
let cachedPath: string | undefined;

/**
 * 매트릭스 파일 경로를 해석한다.
 * 우선순위:
 *   1. `EGOVFRAME_STACK_MATRIX_PATH` 환경변수
 *   2. `EGOVFRAME_SCAFFOLD_TEMPLATE_PATH/stacks.json`
 *   3. `<repo>/templates/stacks.json`
 */
export function resolveStackMatrixPath(): string {
  if (process.env.EGOVFRAME_STACK_MATRIX_PATH) {
    return process.env.EGOVFRAME_STACK_MATRIX_PATH;
  }
  if (process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH) {
    return path.join(process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH, "stacks.json");
  }
  try {
    const here = fileURLToPath(import.meta.url);
    const projectRoot = path.resolve(path.dirname(here), "../../..");
    return path.join(projectRoot, "templates", "stacks.json");
  } catch {
    return path.join(process.cwd(), "templates", "stacks.json");
  }
}

/**
 * 매트릭스 파일을 1회 읽어 메모리에 캐시한다. 경로가 바뀌었거나
 * `clearStackMatrixCache()` 가 호출된 경우 다시 읽는다.
 */
export function loadStackMatrix(matrixPath?: string): StackMatrixFile {
  const resolved = matrixPath ?? resolveStackMatrixPath();
  if (cachedMatrix && cachedPath === resolved) {
    return cachedMatrix;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf-8");
  } catch (e) {
    throw new Error(
      `Stack matrix 를 읽을 수 없습니다 (${resolved}). 'templates/stacks.json' 이 누락되었거나 EGOVFRAME_STACK_MATRIX_PATH 가 잘못 지정되었는지 확인하세요. (${
        e instanceof Error ? e.message : "Unknown error"
      })`,
    );
  }
  let parsed: StackMatrixFile;
  try {
    parsed = JSON.parse(raw) as StackMatrixFile;
  } catch (e) {
    throw new Error(
      `Stack matrix 파싱 실패 (${resolved}): ${
        e instanceof Error ? e.message : "Unknown error"
      }`,
    );
  }
  validateMatrix(parsed, resolved);
  cachedMatrix = parsed;
  cachedPath = resolved;
  return parsed;
}

/**
 * 테스트나 핫리로드 시 매트릭스 캐시를 비운다.
 */
export function clearStackMatrixCache(): void {
  cachedMatrix = undefined;
  cachedPath = undefined;
}

/**
 * (projectType, stackVersion) 으로 stack 메타데이터를 해석한다.
 * 매트릭스에 등재되지 않은 조합이면 명확한 에러를 던진다.
 */
export function resolveStack(
  projectType: ProjectType,
  stackVersion: StackVersion,
  matrixPath?: string,
): StackEntry {
  const matrix = loadStackMatrix(matrixPath);
  const sel = matrix.selection.find(
    (s) => s.projectType === projectType && s.stackVersion === stackVersion,
  );
  if (!sel) {
    throw new Error(
      `지원하지 않는 스택 조합입니다: projectType='${projectType}', stackVersion='${stackVersion}'. templates/stacks.json 의 selection 에 등재된 조합만 허용됩니다.`,
    );
  }
  const entry = matrix.stacks[sel.stack];
  if (!entry) {
    throw new Error(
      `Stack matrix 파일이 손상되었습니다: selection 이 '${sel.stack}' 을 참조하지만 stacks 에 해당 키가 없습니다.`,
    );
  }
  // 매트릭스 무결성: 항목의 projectType/stackVersion 과 selection 키가 일치해야 한다.
  if (entry.projectType !== projectType || entry.stackVersion !== stackVersion) {
    throw new Error(
      `Stack matrix 무결성 위반: '${sel.stack}' 의 projectType/stackVersion 이 selection 키와 다릅니다.`,
    );
  }
  return entry;
}

function validateMatrix(file: StackMatrixFile, source: string): void {
  if (!file || typeof file !== "object") {
    throw new Error(`Stack matrix 형식 오류 (${source}): 최상위 객체가 아닙니다.`);
  }
  if (!file.stacks || typeof file.stacks !== "object") {
    throw new Error(`Stack matrix 형식 오류 (${source}): 'stacks' 필드가 없습니다.`);
  }
  if (!Array.isArray(file.selection)) {
    throw new Error(`Stack matrix 형식 오류 (${source}): 'selection' 필드는 배열이어야 합니다.`);
  }
  for (const sel of file.selection) {
    if (!sel.projectType || !sel.stackVersion || !sel.stack) {
      throw new Error(
        `Stack matrix 형식 오류 (${source}): selection 항목에 projectType/stackVersion/stack 가 모두 필요합니다.`,
      );
    }
    if (!file.stacks[sel.stack]) {
      throw new Error(
        `Stack matrix 형식 오류 (${source}): selection 이 stacks 에 없는 '${sel.stack}' 을 참조합니다.`,
      );
    }
  }
}
