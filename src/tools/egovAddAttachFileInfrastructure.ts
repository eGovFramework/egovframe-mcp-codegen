/**
 * Tool: egov_add_attach_file_infrastructure
 *
 * 이미 생성된 eGovFrame 프로젝트에 표준 첨부파일 인프라(`atchFileId` + COMTNFILE/COMTNFILEDETAIL
 * 2테이블 모델 + EgovFileMngService/Util + EgovConfigAttachFile Bean 등) 를 1회 설치한다.
 *
 * 설계 결정 (egov_add_entity 와 동일 원칙)
 * --------------------------------------
 * - **projectType/stackVersion 은 입력받지 않는다.** pom.xml 에서 자동 감지.
 * - **충돌 시 거부.** force/overwrite 옵션 없음.
 * - **skipIfPresent (기본 true)**: 모든 출력 파일이 *내용까지 동일하게* 이미 존재하면 no-op + 성공.
 *   하나라도 다른 내용이거나, append 위치에 다른 값으로 key 가 박혀 있으면 거부.
 * - **부수 효과 제한.** 8개 Java 파일 + 1개 mapper XML + 7개 dialect별 DDL + 2개 properties append.
 *   pom.xml / sql-mapper-config.xml 등은 건드리지 않음.
 *
 * Phase A 한계
 * ------------
 * - **boot50 한 stack 만 지원.** boot43 / war43 은 다음 페이즈.
 * - 매니페스트 mode `append-fallback` 은 본 도구에서는 사용 안 함 (운영 DB DDL 은 `create` 로
 *   `db/migrations/<dialect>/` 에 fan-out). HSQL 임베디드 시드 머지는 매니페스트 외부에서
 *   `decideMigrationStrategy` + `planHsqlSeedMerge` 로 별도 처리 — 시드 파일명이 프로젝트마다
 *   다르고(`<firstEntity>db.sql`), HSQL 부트는 단일 시드만 .addScript() 로 로드하기 때문.
 */

import path from "node:path";
import fs from "fs-extra";
import os from "node:os";
import Handlebars from "handlebars";
import { z } from "zod";

import { resolveManifest, type ResolvedFileMapping } from "../utils/scaffold/manifestLoader.js";
import {
  detectProjectStack,
  detectBasePackage,
} from "../utils/scaffold/projectDetector.js";
import {
  getScaffoldTemplatePath,
  registerScaffoldHelpers,
} from "../utils/scaffold/scaffoldGenerator.js";
import { decideMigrationStrategy } from "../utils/scaffold/migrationStrategy.js";

/** 첨부파일 인프라가 만들 HSQL 시드 fallback 출력 경로(프로젝트 상대). */
const HSQL_SEED_FALLBACK_OUTPUT = "src/main/resources/db/attach-file.sql";
/** HSQL 시드 DDL 템플릿 (boot50). */
const HSQL_SEED_TEMPLATE = "attach-file/boot50/ddl/attach-file-hsql-seed.sql.hbs";

/**
 * 입력 스키마. spec(docs/design/attach-file-tool-schema.md §1.1) 과 1:1 매핑.
 * 필수는 projectPath 하나뿐 — 나머지는 안전한 default 보유.
 */
export const AddAttachFileInfrastructureInputSchema = z.object({
  projectPath: z.string().min(1, "projectPath 는 필수입니다."),

  /**
   * Globals.fileStorePath 값. 절대경로 권장.
   * 비워두면 OS 임시 디렉터리 하위 'egov-upload' 로 대체 — 개발 편의용이며 운영은 사용자가 명시.
   */
  fileStorePath: z.string().optional(),

  /**
   * atchFileId 채번 prefix. 기본 "FILE_" (공통컴포넌트 표준). len(prefix) + cipers 가 정확히 20이
   * 아니면 거부 — COMTNFILE.ATCH_FILE_ID CHAR(20) PK 와 길이 일치 보장.
   */
  idGnrPrefix: z.string().optional().default("FILE_"),

  /** 채번 자릿수. 기본 15. */
  idGnrCipers: z.number().int().min(1).max(30).optional().default(15),

  /**
   * application.properties / globals.properties 에 `Globals.fileStorePath=…` 키를 append.
   * 같은 키가 같은 값으로 있으면 skip(멱등). 다른 값이면 거부. false 면 append 스킵 + 안내.
   */
  autoApplyProperties: z.boolean().optional().default(true),

  /**
   * Spring multipart 한도 — `spring.servlet.multipart.max-file-size`.
   * 단일 파일 한도. 단위 B/KB/MB/GB. 기본 10MB (Spring Boot 기본 1MB 에서 상향).
   */
  maxFileSize: z.string().optional().default("10MB"),

  /**
   * Spring multipart 한도 — `spring.servlet.multipart.max-request-size`.
   * 한 요청 전체 합산 한도 (여러 파일 + 폼 필드). 기본 50MB.
   */
  maxRequestSize: z.string().optional().default("50MB"),

  /**
   * 화이트리스트 확장자 (소/대문자 무관). 지정하면 화이트리스트 모드 활성화 — 이 목록에 없는 확장자는 거부.
   * 비어 있거나 미지정이면 기본 블랙리스트만 적용.
   * 예: ["pdf", "docx", "xlsx", "png", "jpg", "jpeg", "gif", "hwp"]
   */
  allowedExtensions: z.array(z.string()).optional().default([]),

  /**
   * 추가 블랙리스트 확장자. EgovFileMngUtil.DEFAULT_BLOCKED_EXTENSIONS (P0 기본 셋) 에 합쳐서 적용.
   * 운영 정책으로 더 막아야 하는 확장자가 있을 때 추가.
   */
  blockedExtensions: z.array(z.string()).optional().default([]),

  /**
   * 이미 인프라가 *완전히 동일하게* 설치되어 있으면(모든 출력 파일 존재 + 내용 일치) no-op + 성공 보고.
   * false 면 한 파일이라도 존재할 시 거부 (멱등성 포기 — 강제 신규 설치 의도).
   */
  skipIfPresent: z.boolean().optional().default(true),

  /**
   * HSQL 임베디드 부트 시드(`src/main/resources/db/*.sql`)에 COMTNFILE/COMTNFILEDETAIL/COMTECOPSEQ
   * DDL 을 자동 append 한다. `EgovConfigDatasource` 의 hsql 분기는 `.addScript()` 로 *단일* 시드 파일만
   * 로드하므로, 그 안에 머지해야 부팅 시 첨부 테이블이 잡힌다.
   *
   * 시드 후보가 정확히 1개일 때만 append 하고, 0개·2개 이상이면 안전을 위해 별도 파일
   * `src/main/resources/db/attach-file.sql` 로 fallback 한다 (사용자가 직접 시드에 머지).
   * `egov_add_entity` 의 autoApplyMigration 옵션과 의미가 대칭이다.
   */
  autoMergeHsqlSeed: z.boolean().optional().default(true),
});

export type AddAttachFileInfrastructureInput = z.infer<typeof AddAttachFileInfrastructureInputSchema>;

function formatZodError(err: z.ZodError): string {
  const lines = err.issues.map((i) => {
    const p = i.path.length ? `${i.path.join(".")}: ` : "";
    return `  - ${p}${i.message}`;
  });
  return `입력 검증 실패:\n${lines.join("\n")}`;
}

/**
 * stack → 매니페스트 경로 라우팅. Phase A 는 boot50 만.
 * boot43 / war43 추가 시 본 함수만 확장하면 된다.
 */
function manifestForStack(stackVersion: "5.0" | "4.3", projectType: "boot" | "war"): string {
  if (stackVersion === "5.0" && projectType === "boot") {
    return "attach-file/manifests/boot50.json";
  }
  throw new Error(
    `egov_add_attach_file_infrastructure 는 현재 eGovFrame 5.0 Boot 만 지원합니다 (감지: ${stackVersion} ${projectType}). ` +
      `4.3 Boot / 4.3 WAR 지원은 다음 페이즈에서 추가됩니다.`,
  );
}

/**
 * Bean 모듈은 "create" 모드 — 사전 검사 시 파일별로 4가지 상태 분류:
 *   - missing: 신규 생성 가능
 *   - identical: 이미 동일 내용 존재 (skipIfPresent=true 면 skip)
 *   - different: 다른 내용으로 존재 (항상 충돌)
 *   - other-mode: append-idempotent / append-fallback 으로 별도 처리
 */
type PreflightStatus = "missing" | "identical" | "different";

interface CreateModePreflight {
  mapping: ResolvedFileMapping;
  absPath: string;
  renderedContent: string;
  status: PreflightStatus;
}

interface AppendIdempotentPreflight {
  mapping: ResolvedFileMapping;
  absTargetPath: string;
  renderedContent: string;
  /** 'key=value' 라인 중 key 가 같지만 값이 다른 경우의 기존 라인 — 충돌 보고용. */
  conflictLine?: string;
  /** 같은 key+value 가 이미 있어서 skip 해야 하는 경우. */
  alreadyMatches: boolean;
  /** target file 자체가 없는 경우 (그래도 append 시도 — target 디렉터리는 생성). */
  targetMissing: boolean;
}

/**
 * HSQL 임베디드 시드(`src/main/resources/db/*.sql`)에 첨부 인프라 DDL 을 어떻게 반영할지의
 * 사전 결정. 매니페스트 흐름과 동일하게 *먼저* 결정·검증한 뒤 *나중에* 일괄 적용한다.
 */
type HsqlSeedPlan =
  /** autoMergeHsqlSeed=false — 아무것도 하지 않음. */
  | { kind: "disabled" }
  /** 시드 1개를 찾았고, 그 안에 COMTNFILE 가 아직 없어 끝에 append 한다. */
  | { kind: "append"; seedAbsPath: string; rendered: string }
  /** 시드에 이미 COMTNFILE 정의가 있어 멱등 skip 한다. */
  | { kind: "alreadyMerged"; seedAbsPath: string }
  /** 시드를 결정할 수 없어 별도 파일로 fallback. */
  | {
      kind: "fallbackCreate";
      absPath: string;
      relPath: string;
      rendered: string;
      reason?: string;
    }
  /** fallback 별도 파일이 이미 존재하고 내용이 같아 skip. */
  | { kind: "fallbackIdentical"; relPath: string; reason?: string }
  /** fallback 별도 파일이 이미 존재하지만 내용이 달라 충돌. */
  | { kind: "fallbackConflict"; relPath: string; reason?: string };

/**
 * append-idempotent 모드의 핵심 — 렌더링한 조각(보통 1줄짜리 key=value)의 key 를 추출하고,
 * 기존 target 의 같은 key 라인과 비교한다.
 *
 * 본 도구의 append fragment 는 의도적으로 단순: 주석 + 1개 key 라인.
 * 향후 복수 key 가 필요해지면 본 함수의 파싱 로직을 일반화한다.
 */
function extractPropertiesKeys(rendered: string): { key: string; value: string }[] {
  const out: { key: string; value: string }[] = [];
  for (const raw of rendered.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) out.push({ key, value });
  }
  return out;
}

function findExistingValue(targetContent: string, key: string): string | undefined {
  const lines = targetContent.split(/\r?\n/);
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*${escaped}\\s*=\\s*(.*)$`);
  for (const line of lines) {
    if (line.trim().startsWith("#") || line.trim().startsWith("!")) continue;
    const m = re.exec(line);
    if (m) return m[1].trim();
  }
  return undefined;
}

async function renderTemplate(
  templateBasePath: string,
  relTemplatePath: string,
  ctx: Record<string, unknown>,
): Promise<string> {
  const absTemplate = path.join(templateBasePath, relTemplatePath);
  if (!(await fs.pathExists(absTemplate))) {
    throw new Error(`템플릿을 찾을 수 없습니다: ${absTemplate}`);
  }
  const raw = await fs.readFile(absTemplate, "utf-8");
  return Handlebars.compile(raw, { noEscape: true })(ctx);
}

/**
 * HSQL 시드 머지 계획 수립. 매니페스트와 별개로 처리하는 이유:
 *   - 시드 파일명이 프로젝트마다 다름 (`<firstEntity>db.sql`) — 매니페스트 정적 경로로 불가능
 *   - 매니페스트의 dialect fan-out 은 운영 DB 용 `db/migrations/<dialect>/` 가 목표라
 *     HSQL 임베디드 부트 시드와는 정책이 다름
 */
async function planHsqlSeedMerge(args: {
  projectDir: string;
  autoMergeHsqlSeed: boolean;
  templateBasePath: string;
  ctx: Record<string, unknown>;
}): Promise<HsqlSeedPlan> {
  if (!args.autoMergeHsqlSeed) return { kind: "disabled" };

  const rendered = await renderTemplate(args.templateBasePath, HSQL_SEED_TEMPLATE, args.ctx);

  const decision = await decideMigrationStrategy({
    projectDir: args.projectDir,
    autoApplyMigration: true,
    newMigrationOutput: HSQL_SEED_FALLBACK_OUTPUT,
  });

  if (decision.strategy === "appendToSeed") {
    const seedContent = await fs.readFile(decision.seedFileAbsPath, "utf-8");
    if (/\bCOMTNFILE\b/i.test(seedContent)) {
      return { kind: "alreadyMerged", seedAbsPath: decision.seedFileAbsPath };
    }
    return { kind: "append", seedAbsPath: decision.seedFileAbsPath, rendered };
  }

  const fallbackAbs = path.join(args.projectDir, HSQL_SEED_FALLBACK_OUTPUT);
  if (await fs.pathExists(fallbackAbs)) {
    const existing = await fs.readFile(fallbackAbs, "utf-8");
    if (existing === rendered) {
      return {
        kind: "fallbackIdentical",
        relPath: HSQL_SEED_FALLBACK_OUTPUT,
        reason: decision.fallbackReason,
      };
    }
    return {
      kind: "fallbackConflict",
      relPath: HSQL_SEED_FALLBACK_OUTPUT,
      reason: decision.fallbackReason,
    };
  }

  return {
    kind: "fallbackCreate",
    absPath: fallbackAbs,
    relPath: HSQL_SEED_FALLBACK_OUTPUT,
    rendered,
    reason: decision.fallbackReason,
  };
}

export async function egovAddAttachFileInfrastructure(rawParams: unknown): Promise<string> {
  // 1) 입력 검증
  const parsed = AddAttachFileInfrastructureInputSchema.safeParse(rawParams);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }
  const params = parsed.data;

  // 2) prefix + cipers 길이 검증 (CHAR(20) PK 일치)
  if (params.idGnrPrefix.length + params.idGnrCipers !== 20) {
    throw new Error(
      `idGnrPrefix.length(${params.idGnrPrefix.length}) + idGnrCipers(${params.idGnrCipers}) 합이 정확히 20이어야 합니다 ` +
        `— COMTNFILE.ATCH_FILE_ID CHAR(20) PK 와 길이를 일치시키기 위함입니다.`,
    );
  }

  // 3) 프로젝트 자동 감지
  const projectDir = path.resolve(params.projectPath);
  const detected = detectProjectStack(projectDir);
  const basePackage = detectBasePackage(projectDir);
  if (!basePackage) {
    throw new Error(
      `프로젝트의 base package 를 감지하지 못했습니다 (${projectDir}). ` +
        `src/main/java/.../cmm/vo/FkComboVO.java 가 발견되어야 합니다 — egov_scaffold_project 로 만든 프로젝트인지 확인하세요.`,
    );
  }

  // 4) 매니페스트 라우팅
  const manifestPath = manifestForStack(detected.stackVersion, detected.projectType);

  // 5) Handlebars 컨텍스트
  const fileStorePath =
    params.fileStorePath && params.fileStorePath.length > 0
      ? params.fileStorePath
      : path.join(os.tmpdir(), "egov-upload");

  registerScaffoldHelpers();
  // 확장자 배열을 대문자 CSV 로 정규화 (Java 의 parseExtensionCsv 와 동일 표기 보장).
  const toUpperCsv = (arr: string[]): string =>
    arr
      .map((s) => s.trim().replace(/^\./, "").toUpperCase())
      .filter((s) => s.length > 0)
      .join(",");
  const ctx: Record<string, unknown> = {
    basePackage,
    basePackagePath: basePackage.replace(/\./g, "/"),
    idGnrPrefix: params.idGnrPrefix,
    idGnrCipers: params.idGnrCipers,
    fileStorePath,
    maxFileSize: params.maxFileSize,
    maxRequestSize: params.maxRequestSize,
    allowedExtensionsCsv: toUpperCsv(params.allowedExtensions),
    blockedExtensionsCsv: toUpperCsv(params.blockedExtensions),
    stackVersion: detected.stackVersion,
    projectType: detected.projectType,
  };

  const mappings = resolveManifest(manifestPath, ctx);
  if (mappings.length === 0) {
    throw new Error(`매니페스트 '${manifestPath}' 에 항목이 없습니다.`);
  }

  const templateBasePath = getScaffoldTemplatePath();

  // 6) 사전 검사 — create / append-idempotent 별로 상태 수집
  const creates: CreateModePreflight[] = [];
  const appends: AppendIdempotentPreflight[] = [];

  for (const m of mappings) {
    const rendered = await renderTemplate(templateBasePath, m.template, {
      ...ctx,
      ...(m.dialect ? { dialect: m.dialect } : {}),
    });

    if (m.mode === "create") {
      const abs = path.join(projectDir, m.output);
      let status: PreflightStatus = "missing";
      if (await fs.pathExists(abs)) {
        const existing = await fs.readFile(abs, "utf-8");
        status = existing === rendered ? "identical" : "different";
      }
      creates.push({ mapping: m, absPath: abs, renderedContent: rendered, status });
    } else if (m.mode === "append-idempotent") {
      if (!m.appendTarget) {
        throw new Error(`매니페스트 오류: append-idempotent 인데 appendTarget 누락 (${m.output}).`);
      }
      // appendTarget.glob 은 정적 경로 (Phase A 에서는 wildcard 없이 정확한 파일 1개).
      const absTarget = path.join(projectDir, m.appendTarget.glob);
      let targetMissing = false;
      let existing = "";
      if (await fs.pathExists(absTarget)) {
        existing = await fs.readFile(absTarget, "utf-8");
      } else {
        targetMissing = true;
      }
      if (!params.autoApplyProperties) {
        // append 스킵 — append 시도조차 안 함
        appends.push({
          mapping: m,
          absTargetPath: absTarget,
          renderedContent: rendered,
          alreadyMatches: false,
          targetMissing,
        });
        continue;
      }
      const keys = extractPropertiesKeys(rendered);
      let conflictLine: string | undefined;
      let allMatch = keys.length > 0;
      for (const { key, value } of keys) {
        const ev = findExistingValue(existing, key);
        if (ev === undefined) {
          allMatch = false;
        } else if (ev !== value) {
          conflictLine = `${key}=${ev}  (요청 값: ${value})`;
          allMatch = false;
          break;
        }
      }
      appends.push({
        mapping: m,
        absTargetPath: absTarget,
        renderedContent: rendered,
        conflictLine,
        alreadyMatches: allMatch,
        targetMissing,
      });
    } else {
      throw new Error(`Phase A 미지원 매니페스트 mode: ${m.mode} (${m.output}).`);
    }
  }

  // 6-b) HSQL 임베디드 시드 머지 계획 — 매니페스트 외부에서 별도 결정.
  const hsqlSeedPlan = await planHsqlSeedMerge({
    projectDir,
    autoMergeHsqlSeed: params.autoMergeHsqlSeed,
    templateBasePath,
    ctx,
  });

  // 7) 거부 조건 수집
  const conflicts: string[] = [];
  for (const c of creates) {
    if (c.status === "different") {
      conflicts.push(`(파일 충돌) ${c.mapping.output}`);
    } else if (c.status === "identical" && !params.skipIfPresent) {
      conflicts.push(`(파일 존재) ${c.mapping.output} — skipIfPresent=false 로 호출되어 거부`);
    }
  }
  for (const a of appends) {
    if (a.conflictLine) {
      conflicts.push(
        `(속성 충돌) ${path.relative(projectDir, a.absTargetPath)} 의 기존 라인: ${a.conflictLine}`,
      );
    }
  }
  if (hsqlSeedPlan.kind === "fallbackConflict") {
    conflicts.push(
      `(파일 충돌) ${hsqlSeedPlan.relPath} 에 이미 다른 내용이 존재합니다 (HSQL 시드 fallback)`,
    );
  } else if (hsqlSeedPlan.kind === "fallbackIdentical" && !params.skipIfPresent) {
    conflicts.push(
      `(파일 존재) ${hsqlSeedPlan.relPath} — skipIfPresent=false 로 호출되어 거부`,
    );
  }
  if (conflicts.length > 0) {
    throw new Error(
      `첨부파일 인프라 설치가 충돌로 거부되었습니다 (${conflicts.length}건):\n` +
        conflicts.map((s) => `  - ${s}`).join("\n") +
        `\n\n기존 파일을 보존하기 위해 어떤 변경도 적용되지 않았습니다. ` +
        `(skipIfPresent=true 로 호출하면 내용 일치 시 멱등 스킵됩니다.)`,
    );
  }

  // 8) 적용 — 파일 쓰기 + append
  const filesCreated: string[] = [];
  const filesSkipped: string[] = [];
  const filesAppended: { path: string; addedKeys: string[] }[] = [];
  const filesAppendSkipped: { path: string; reason: string }[] = [];

  for (const c of creates) {
    if (c.status === "identical") {
      filesSkipped.push(c.mapping.output);
      continue;
    }
    await fs.ensureDir(path.dirname(c.absPath));
    await fs.writeFile(c.absPath, c.renderedContent, "utf-8");
    filesCreated.push(c.mapping.output);
  }

  for (const a of appends) {
    if (!params.autoApplyProperties) {
      filesAppendSkipped.push({
        path: path.relative(projectDir, a.absTargetPath),
        reason: "autoApplyProperties=false 로 호출되어 속성 자동 append 를 건너뜁니다.",
      });
      continue;
    }
    if (a.alreadyMatches) {
      filesSkipped.push(path.relative(projectDir, a.absTargetPath));
      continue;
    }
    if (a.targetMissing) {
      // target 파일 자체가 없으면 새로 만들어서 쓴다 (디렉터리는 생성).
      await fs.ensureDir(path.dirname(a.absTargetPath));
      await fs.writeFile(a.absTargetPath, a.renderedContent, "utf-8");
    } else {
      // 끝에 빈 줄 보장 후 append.
      await fs.appendFile(a.absTargetPath, "\n" + a.renderedContent);
    }
    filesAppended.push({
      path: path.relative(projectDir, a.absTargetPath),
      addedKeys: extractPropertiesKeys(a.renderedContent).map((k) => k.key),
    });
  }

  // 8-b) HSQL 시드 머지 실행
  let hsqlSeedResult:
    | { kind: "append"; seedRelPath: string }
    | { kind: "alreadyMerged"; seedRelPath: string }
    | { kind: "fallbackCreate"; relPath: string; reason?: string }
    | { kind: "fallbackIdentical"; relPath: string; reason?: string }
    | { kind: "disabled" } = { kind: "disabled" };
  if (hsqlSeedPlan.kind === "append") {
    await fs.appendFile(hsqlSeedPlan.seedAbsPath, "\n" + hsqlSeedPlan.rendered);
    hsqlSeedResult = {
      kind: "append",
      seedRelPath: path.relative(projectDir, hsqlSeedPlan.seedAbsPath),
    };
  } else if (hsqlSeedPlan.kind === "alreadyMerged") {
    hsqlSeedResult = {
      kind: "alreadyMerged",
      seedRelPath: path.relative(projectDir, hsqlSeedPlan.seedAbsPath),
    };
  } else if (hsqlSeedPlan.kind === "fallbackCreate") {
    await fs.ensureDir(path.dirname(hsqlSeedPlan.absPath));
    await fs.writeFile(hsqlSeedPlan.absPath, hsqlSeedPlan.rendered, "utf-8");
    hsqlSeedResult = {
      kind: "fallbackCreate",
      relPath: hsqlSeedPlan.relPath,
      reason: hsqlSeedPlan.reason,
    };
  } else if (hsqlSeedPlan.kind === "fallbackIdentical") {
    hsqlSeedResult = {
      kind: "fallbackIdentical",
      relPath: hsqlSeedPlan.relPath,
      reason: hsqlSeedPlan.reason,
    };
  }

  // 9) 결과 메시지
  const egovLabel = detected.stackVersion === "5.0" ? "eGovFrame 5.0" : "eGovFrame 4.3";
  const kindLabel = detected.projectType === "war" ? "WAR" : "Spring Boot";

  const lines = [
    `✅ ${egovLabel} ${kindLabel} 프로젝트에 첨부파일 인프라 설치 완료!`,
    ``,
    `📁 프로젝트: ${projectDir}`,
    `🔎 감지된 스택: ${detected.reason}`,
    `📦 base package: ${basePackage}`,
    `🔐 atchFileId 채번: prefix="${params.idGnrPrefix}" + cipers=${params.idGnrCipers} (총 ${params.idGnrPrefix.length + params.idGnrCipers}자)`,
    `📂 파일 저장 경로: ${fileStorePath}`,
    ``,
    `📄 생성된 파일 (${filesCreated.length}):`,
    ...filesCreated.map((f) => `  - ${f}`),
  ];

  if (filesAppended.length > 0) {
    lines.push(``, `📝 속성 append (${filesAppended.length}):`);
    for (const a of filesAppended) {
      lines.push(`  - ${a.path}  (+ ${a.addedKeys.join(", ")})`);
    }
  }
  if (filesSkipped.length > 0) {
    lines.push(``, `⏭️  내용 동일로 skip (${filesSkipped.length}):`);
    for (const s of filesSkipped) {
      lines.push(`  - ${s}`);
    }
  }
  if (filesAppendSkipped.length > 0) {
    lines.push(``, `ℹ️  append 건너뜀:`);
    for (const s of filesAppendSkipped) {
      lines.push(`  - ${s.path}: ${s.reason}`);
    }
  }

  if (hsqlSeedResult.kind === "append") {
    lines.push(
      ``,
      `🧩 HSQL 임베디드 시드 자동 머지:`,
      `  - ${hsqlSeedResult.seedRelPath} 끝에 COMTNFILE / COMTNFILEDETAIL / COMTECOPSEQ DDL 추가`,
      `  → 기본 hsql 프로파일로 부팅 시 첨부 테이블이 자동 생성됩니다.`,
    );
  } else if (hsqlSeedResult.kind === "alreadyMerged") {
    lines.push(
      ``,
      `⏭️  HSQL 시드 머지 skip: ${hsqlSeedResult.seedRelPath} 에 이미 COMTNFILE 정의가 존재합니다.`,
    );
  } else if (hsqlSeedResult.kind === "fallbackCreate") {
    lines.push(
      ``,
      `📄 HSQL 시드 (fallback): ${hsqlSeedResult.relPath} 별도 파일로 생성`,
      ...(hsqlSeedResult.reason ? [`  사유: ${hsqlSeedResult.reason}`] : []),
      `  ⚠️  EgovConfigDatasource 의 hsql 분기는 .addScript() 로 단일 시드 파일만 로드합니다.`,
      `       임베디드 HSQL 부트에 적용하려면 위 파일 내용을 src/main/resources/db/<entity>db.sql 끝에`,
      `       머지하거나, .addScript("classpath:/db/attach-file.sql") 라인을 추가하세요.`,
    );
  } else if (hsqlSeedResult.kind === "fallbackIdentical") {
    lines.push(
      ``,
      `⏭️  HSQL 시드 fallback 파일 skip: ${hsqlSeedResult.relPath} 가 이미 동일 내용으로 존재합니다.`,
    );
  } else if (hsqlSeedResult.kind === "disabled") {
    lines.push(
      ``,
      `ℹ️  HSQL 시드 머지 건너뜀: autoMergeHsqlSeed=false 로 호출되었습니다.`,
      `   임베디드 HSQL 부트에 첨부 테이블을 직접 만들려면 db/migrations/<dialect>/attach-file.sql 의`,
      `   COMTNFILE/COMTNFILEDETAIL/COMTECOPSEQ DDL 을 시드(<entity>db.sql)에 머지하세요.`,
    );
  }

  lines.push(
    ``,
    `다음 단계:`,
    `  1. ${fileStorePath} 디렉터리의 쓰기 권한을 확인하세요 (운영 배포 시 외부 마운트 권장).`,
    `     ⚠️  Globals.fileStorePath 는 절대로 src/main/resources/static, src/main/webapp 등 webroot 하위로`,
    `         지정하지 마세요 — EgovFileMngUtil 가 @PostConstruct 에서 거부합니다.`,
    `  2. 운영 DB 벤더에 맞는 DDL 을 적용하세요: src/main/resources/db/migrations/<dialect>/attach-file.sql`,
    `     (HSQL 임베디드용 DDL 은 위 시드 머지 결과를 참고하세요.)`,
    `  3. egov_add_entity 호출 시 첨부 와이어드 컨트롤러를 받으려면 withAttachment 옵션을 켜세요.`,
    `  4. 다운로드 URL: GET /cmm/fms/FileDown.do?atchFileId=&fileSn=  (Spring Security 정책으로 보호 권장)`,
    ``,
    `🔐 보안 정책 (자동 적용됨):`,
    `  - 실행 가능 확장자 차단 (EXE/BAT/SH/JSP/PHP/SVG/HTML/JAR 등) — EgovFileMngUtil.BLOCKED_EXTENSIONS`,
    `  - 저장 경로 webroot/classpath 겹침 검증 — 부팅 시 @PostConstruct 로 거부`,
    `  - 차단/사이즈초과 시 EgovFileUploadExceptionAdvice 가 referer 로 redirect + flash errorMessage`,
    ``,
    `🪧 화면에 에러 메시지를 보여주려면 (기존 첨부 화면들에 1회만):`,
    `   List/Register/Update 화면의 콘텐츠 영역 상단에 다음 한 줄을 추가하세요 —`,
    `     <th:block th:replace="~{_fragments/alertMessages :: messages}"></th:block>`,
    `   메시지 키는 message-common.properties 의 fail.common.fileSize.exceeded / fail.common.fileType.blocked`,
    `   가 자동 append 되었습니다. 추가 키가 필요하면 같은 파일에 직접 추가하세요.`,
  );

  return lines.join("\n");
}
