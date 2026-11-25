/**
 * Tool: egov_add_entity
 *
 * 이미 생성된 eGovFrame 프로젝트에 DDL 한 줄로 엔티티 CRUD 세트를 추가한다.
 * `egov_scaffold_project` 가 프로젝트 골격까지 한꺼번에 만드는 1회성 도구라면,
 * 이 도구는 다회성 — 한 프로젝트에 엔티티가 늘어날 때마다 호출된다.
 *
 * 설계 결정
 * ---------
 * - **projectType/stackVersion 은 입력받지 않는다.** 기존 pom.xml 에서 자동 감지한다.
 *   비표준 구조는 명확한 에러로 거부한다 (override 옵션 없음).
 * - **충돌 시 원자적 거부, 완전 동일 재호출은 멱등 성공.** force 옵션 없음. 렌더 결과를
 *   기존 산출물과 내용까지 비교해 (a) 전부 존재 + 내용 동일 → 아무 것도 쓰지 않고 "변경 없음"
 *   성공, (b) 일부만 존재하거나 내용이 다르면 → 모든 충돌 파일 목록(내용 동일/상이 구분)을
 *   반환하고 종료한다 (어떤 파일도 쓰지 않는다).
 * - **부수 효과 최소화.** CRUD 산출물(`scope: "entity"` 매니페스트 항목)만 추가한다.
 *   pom.xml, application.properties, sql-mapper-config.xml, 정적 자원 등은 건드리지 않는다.
 */

import path from "node:path";
import fs from "fs-extra";
import { writeFile } from "node:fs/promises";
import Handlebars from "handlebars";
import { z } from "zod";

import {
  buildContext,
  getScaffoldTemplatePath,
  registerScaffoldHelpers,
  applyLabels,
  type ScaffoldParams,
} from "../utils/scaffold/scaffoldGenerator.js";
import { deriveLabelFromComment } from "../utils/scaffold/messageLabel.js";
import { resolveManifest } from "../utils/scaffold/manifestLoader.js";
import { assertInsideProject } from "../utils/scaffold/pathGuard.js";
import { FileWriteJournal, withWriteRollback } from "../utils/scaffold/writeRollback.js";
import { decideMigrationStrategy } from "../utils/scaffold/migrationStrategy.js";
import {
  detectAttachFileInfra,
  detectBasePackage,
  detectProjectStack,
  usesApacheMapperScan,
} from "../utils/scaffold/projectDetector.js";
import {
  discoverEntities,
  discoverParentEntity,
  type DiscoveredEntity,
} from "../utils/scaffold/entityDiscovery.js";
import {
  formatNormalizationReport,
  normalizeDdl,
  type NormalizationReport,
} from "../utils/ddlNormalizer.js";
import { completionFooter, nonRetryable, retryAfterAction } from "../utils/scaffold/toolMessages.js";
import { validateRenderedFiles } from "../utils/scaffold/outputValidator.js";
import {
  applyAttachFileInfra,
  defaultAttachFileInstallOptions,
  planAttachFileInfra,
  summarizeAttachFileInstall,
  type AttachFilePlan,
} from "../utils/scaffold/attachFileInstaller.js";
import { applyAttachmentContext } from "../utils/scaffold/attachmentContext.js";

/**
 * 입력 검증 스키마. `egov_scaffold_project` 와 다른 점:
 * - `projectName`, `outputPath`, `projectType`, `stackVersion` 없음.
 * - 대신 `projectPath` (기존 프로젝트 루트) 가 필수.
 */
export const AddEntityInputSchema = z.object({
  projectPath: z.string().min(1, { error: "projectPath 는 필수입니다." }),
  packageName: z
    .string()
    .min(1, { error: "packageName 은 필수입니다." })
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/, {
      error:
        "packageName 은 Java 패키지 규약을 따라야 합니다 (예: 'egovframework.example.article').",
    }),
  entityName: z
    .string()
    .min(1, { error: "entityName 은 필수입니다." })
    .regex(/^[A-Z][a-zA-Z0-9]*$/, {
      error: "entityName 은 PascalCase 여야 합니다 (예: 'Article').",
    }),
  ddl: z
    .string()
    .min(1, { error: "ddl 은 필수입니다." })
    .refine((v) => /CREATE\s+(?:MEMORY\s+)?TABLE/i.test(v), {
      error: "ddl 은 CREATE TABLE 문이어야 합니다.",
    }),
  description: z.string().optional().default(""),
  normalizeDdl: z.boolean().optional().default(true),
  /**
   * true (기본) 면 마이그레이션 DDL 을 기존 시드 SQL 파일 끝에 자동 append 한다.
   * 안전 조건: src/main/resources/db/ 에 사용자 시드 *.sql 파일이 정확히 1개일 때만 동작.
   * 0개 또는 2개 이상이면 자동 append 를 포기하고 별도 파일(add-{entity}-tables.sql) 생성으로 fallback.
   *
   * 사용자가 직접 적용을 선호하거나 시드 상태가 비표준이면 false 로 호출. 이 경우 항상 별도 파일만 만든다.
   *
   * 기본 true 정책 근거: 안전 조건(시드 파일 정확히 1개) 미충족 시 자동으로 fallback 하므로 실수로 시드를
   * 망가뜨릴 위험이 낮고, autoApplyMessages 와 일관된 "그냥 동작" UX 를 유지한다.
   */
  autoApplyMigration: z.boolean().optional().default(true),
  /**
   * true (기본) 면 새 엔티티의 메시지 키(`list.{entity}`, `title.{entity}.X`,
   * `confirm.required.{entity}.X` 등) 를 기존 메시지 번들 파일들 끝에 자동 append 한다.
   *
   * 대상: `src/main/resources/egovframework/message/message-common.properties`,
   *      `...message-common_ko.properties`, `...message-common_en.properties`
   *
   * 안전 조건: 위 3개 파일이 모두 존재할 때만 append. 하나라도 빠지면 fallback
   * (별도 안내 — 결과 메시지로 추가해야 할 키 목록을 출력).
   *
   * 기본 true: 메시지 키 추가는 SQL 시드 머지보다 위험이 낮고 (단순 텍스트 line 추가),
   * 자동화하지 않으면 화면에 `??title.member.X_ko_KR??` 같은 미해석 키가 그대로 노출되므로
   * UX 문제를 일으킨다.
   */
  autoApplyMessages: z.boolean().optional().default(true),
  /**
   * true 면 엔티티 간 메뉴 네비게이션 fragment(`_fragments/nav.html` 또는 `_fragments/nav.jsp`) 를
   * 기존 컨트롤러들에서 탐색한 전체 엔티티 목록으로 재생성한다 — 그 결과 모든 List 화면이
   * 자동으로 신규 엔티티 메뉴 링크를 갖는다.
   *
   * 동작:
   *   1) `src/main/java/.../web/Egov*Controller.java` 들을 스캔해 기존 엔티티 목록 추출
   *   2) 새 엔티티를 포함한 목록으로 nav fragment 파일을 덮어쓴다 (단일 출처).
   *   3) 기존 List 화면들에 fragment include 라인이 없으면 자동 마이그레이션 (`<h2>` /
   *      `<!-- 타이틀 -->` 뒤에 `<div th:replace=...>` / `<jsp:include>` 한 줄 삽입).
   *
   * 기본 false (보수적): 메뉴 정책은 프로젝트마다 다르고 (위치/스타일/순서), 자동화하면 사용자
   * 커스텀 메뉴와 충돌할 수 있어 명시적으로 켜야 한다.
   */
  autoApplyMenu: z.boolean().optional().default(false),
  /**
   * true 면 생성되는 엔티티가 eGov 표준 첨부파일(atchFileId) 와이어드 형태로 emit 된다.
   *
   * 영향:
   * - VO 에 `String atchFileId` 필드 추가 + getter/setter
   * - 엔티티 DDL / 마이그레이션 SQL 에 `ATCH_FILE_ID CHAR(20)` 컬럼 추가
   * - Mapper SQL 의 INSERT/UPDATE/SELECT 에 ATCH_FILE_ID 포함
   * - Controller 가 multipart 핸들러로 분기 (`MultipartHttpServletRequest` + parseFileInf + insertFileInfs + getMaxFileSN + updateFileInfs)
   * - ServiceImpl 의 delete 가 `EgovFileMngService.deleteAllFileInf` 를 함께 호출 (orphan 방지)
   * - 등록/수정 화면(`...Register.html`)에 `<input type="file" name="file_1" multiple>` 추가
   *
   * 첨부파일 인프라(`EgovFileMngService.java` + `EgovConfigAttachFile.java`)가 없으면 기본 옵션으로
   * 자동 설치한다 (Boot 만 지원: 5.1, 4.3 — WAR 은 거부). 설치는 엔티티 사전 검사가 모두 통과한 뒤
   * 엔티티 파일 쓰기와 하나의 롤백 저널로 수행된다. 세부 옵션이 필요하면 먼저
   * `egov_add_attach_file_infrastructure` 를 호출한다.
   */
  withAttachment: z.boolean().optional().default(false),
  /**
   * 첨부파일 그룹 키 필드의 이름. 표준은 'atchFileId' — 다른 이름은 공통컴포넌트 fragment 와
   * 어긋나므로 비추천. 두 엔티티에서 다른 키명을 쓰고 싶을 때만 변경.
   */
  attachmentFieldName: z.string().min(1).optional().default("atchFileId"),
  /**
   * UI 단의 첨부 개수 상한. 0 = 무제한. 등록/수정 화면에 client-side 검증 힌트로만 노출
   * (서버측 강제 검증은 별도 — v1 범위 밖).
   */
  maxAttachmentCount: z.number().int().min(0).optional().default(0),
  /**
   * PK 채번 방식.
   *
   * - "auto" (기본): EgovTableIdGnrServiceImpl 로 자동 채번. PK 값은 `<TABLE_NAME>-NNNNN` 형식
   *   (예: TB_ORDER-00001). 데이터 테이블(Customer/Order/Article 같은 surrogate-ID 도메인) 에 적합.
   *   사용자 화면에서는 PK 가 readonly — 신규 등록 시 입력란이 아예 보이지 않는다.
   *
   * - "manual": 채번 빈 / IDS row / Service 의 채번 호출 모두 생략. PK 는 사용자가 직접 입력.
   *   코드 마스터 테이블 (배송상태/권한코드/분류코드/우편번호 등 짧은 자연 코드 PK) 에 적합.
   *   PK 값 예: 'RCPT', 'SHIP', 'DONE', 'ADMIN', 'USER'. Register 화면에 PK 입력란 + required 검증.
   *
   * "auto" 일 때 PK 컬럼 길이가 채번 형식보다 작으면 (tableName 길이 + 6 = "<TABLE>-NNNNN")
   * 거부한다 — 런타임 truncation 에러를 컴파일/실행 전에 잡기 위함.
   *
   * 사용자가 "배송상태/권한/분류/코드 마스터" 같은 표현을 쓰면 "manual" 로 호출하도록 설계.
   */
  idGeneration: z.enum(["auto", "manual"]).optional().default("auto"),
});

export type AddEntityInput = z.infer<typeof AddEntityInputSchema>;

function formatZodError(err: z.ZodError): string {
  const lines = err.issues.map((i) => {
    const p = i.path.length ? `${i.path.join(".")}: ` : "";
    return `  - ${p}${i.message}`;
  });
  return `입력 검증 실패:\n${lines.join("\n")}`;
}

/**
 * 마이그레이션 SQL 템플릿을 렌더링해 문자열로 돌려준다.
 * 별도 파일 출력 흐름은 manifest 경로를 통해 renderEntityFilesInMemory/writeRenderedEntityFiles 가 처리하므로,
 * 이 함수는 appendToSeed 모드에서 한 번만 호출된다.
 */
async function renderMigrationContent(
  templateBasePath: string,
  templateRelPath: string,
  ctx: Record<string, unknown>,
): Promise<string> {
  const absTemplatePath = path.join(templateBasePath, templateRelPath);
  if (!(await fs.pathExists(absTemplatePath))) {
    throw new Error(`마이그레이션 템플릿을 찾을 수 없습니다: ${absTemplatePath}`);
  }
  const raw = await fs.readFile(absTemplatePath, "utf-8");
  return Handlebars.compile(raw)(ctx);
}

/**
 * autoApplyMessages 옵션의 처리 전략을 결정한다.
 *
 * 안전 조건: `src/main/resources/egovframework/message/` 아래에 다음 3개 파일이 모두
 * 존재할 때만 append 가 진행된다. 하나라도 빠지면 `notApplicable` 로 fallback 한다.
 *
 *   - message-common.properties        (기본 로케일)
 *   - message-common_ko.properties     (한국어)
 *   - message-common_en.properties     (영어)
 */
async function decideMessagesStrategy(args: {
  projectDir: string;
  autoApplyMessages: boolean;
}): Promise<
  | { strategy: "appendToBundles"; targets: { absPath: string; relPath: string; locale: "default" | "ko" | "en" }[] }
  | { strategy: "notApplicable"; fallbackReason?: string }
> {
  if (!args.autoApplyMessages) {
    return {
      strategy: "notApplicable",
      fallbackReason: "autoApplyMessages=false 로 호출되어 메시지 번들을 수정하지 않습니다.",
    };
  }

  const msgDir = path.join(
    args.projectDir,
    "src/main/resources/egovframework/message",
  );
  if (!(await fs.pathExists(msgDir))) {
    return {
      strategy: "notApplicable",
      fallbackReason:
        "src/main/resources/egovframework/message/ 디렉터리를 찾을 수 없습니다. 비표준 프로젝트 구조로 보입니다.",
    };
  }

  const expected: { file: string; locale: "default" | "ko" | "en" }[] = [
    { file: "message-common.properties", locale: "default" },
    { file: "message-common_ko.properties", locale: "ko" },
    { file: "message-common_en.properties", locale: "en" },
  ];

  const missing: string[] = [];
  const targets: { absPath: string; relPath: string; locale: "default" | "ko" | "en" }[] = [];

  for (const e of expected) {
    const abs = path.join(msgDir, e.file);
    if (await fs.pathExists(abs)) {
      targets.push({
        absPath: abs,
        relPath: path.relative(args.projectDir, abs),
        locale: e.locale,
      });
    } else {
      missing.push(e.file);
    }
  }

  if (missing.length > 0) {
    return {
      strategy: "notApplicable",
      fallbackReason: `메시지 번들 파일 ${missing.length}개가 존재하지 않습니다 (${missing.join(", ")}). 3개 파일이 모두 있을 때만 자동 append 합니다.`,
    };
  }

  return { strategy: "appendToBundles", targets };
}

/**
 * 메뉴(nav fragment) 자동 갱신 처리 결과.
 */
interface MenuResult {
  /** fragment 파일이 실제로 (재)생성된 경우 그 경로 — 그 외에는 undefined. */
  fragmentRelPath?: string;
  /** 기존 List 화면 중 마이그레이션(fragment include 라인 삽입) 된 파일들. */
  migratedViewRelPaths: string[];
  /** 메뉴에 포함된 엔티티 목록 (디버깅/메시지용). */
  entities: DiscoveredEntity[];
  /** 처리되지 않은 경우의 사유. (autoApplyMenu=false 등) */
  skippedReason?: string;
}

/**
 * boot50/boot43 의 Thymeleaf List 화면에 nav fragment include 라인을 삽입한다.
 * 이미 include 라인이 있으면 idempotent (변경 없음).
 *
 * 삽입 위치: `<h2 ...></h2>` 직후 (boot50) 또는 `<div id="title">...</div>` 직후 (boot43).
 * anchor 를 찾지 못하면 변경 없이 false 를 돌려준다.
 */
async function ensureThymeleafNavInclude(
  viewAbsPath: string,
): Promise<{ changed: boolean; reason?: string }> {
  const content = await fs.readFile(viewAbsPath, "utf-8");

  if (content.includes("_fragments/nav :: links")) {
    return { changed: false }; // 이미 적용됨
  }

  // boot50: `<h2 class="heading-large" th:text="...">...</h2>` 뒤
  const boot50Anchor = /(<h2[^>]*th:text="[^"]*list\.[^"]*"[^>]*><\/h2>)/;
  // boot43: `<div id="title">...title_dot.gif.../></span></li></ul></div>` 뒤
  const boot43Anchor = /(<div id="title">[^<]*<ul>[\s\S]*?<\/ul><\/div>)/;

  const insertion = `\n\n\t<!-- @egov:nav-include — egov_add_entity 가 자동 삽입 (legacy 마이그레이션) -->\n\t<div th:replace="~{_fragments/nav :: links}"></div>`;

  let next: string | undefined;
  if (boot50Anchor.test(content)) {
    next = content.replace(boot50Anchor, (m) => m + insertion);
  } else if (boot43Anchor.test(content)) {
    next = content.replace(boot43Anchor, (m) => m + insertion);
  }
  if (!next || next === content) {
    return {
      changed: false,
      reason:
        "List 화면에서 fragment include 삽입 anchor (<h2 th:text=...> 또는 <div id=\"title\">) 를 찾지 못했습니다. 사용자가 수동으로 한 줄 추가하세요.",
    };
  }
  await fs.writeFile(viewAbsPath, next, "utf-8");
  return { changed: true };
}

/**
 * WAR JSP List 화면에 nav fragment include 라인을 삽입한다.
 * Anchor: `<!-- // 타이틀 -->` 다음 줄에 jsp:include 한 줄을 끼운다.
 */
async function ensureJspNavInclude(
  viewAbsPath: string,
): Promise<{ changed: boolean; reason?: string }> {
  const content = await fs.readFile(viewAbsPath, "utf-8");

  if (content.includes("/_fragments/nav.jsp")) {
    return { changed: false }; // 이미 적용됨
  }

  const anchor = /(<!-- \/\/ 타이틀 -->)/;
  if (!anchor.test(content)) {
    return {
      changed: false,
      reason:
        "JSP 에서 fragment include 삽입 anchor (<!-- // 타이틀 -->) 를 찾지 못했습니다. 사용자가 수동으로 한 줄 추가하세요.",
    };
  }
  const insertion = `\n\n\t<%-- @egov:nav-include — egov_add_entity 가 자동 삽입 (legacy 마이그레이션) --%>\n\t<jsp:include page="/WEB-INF/jsp/_fragments/nav.jsp" />`;
  const next = content.replace(anchor, (m) => m + insertion);
  await fs.writeFile(viewAbsPath, next, "utf-8");
  return { changed: true };
}

/**
 * 프로젝트 디렉터리에서 기존 entity 들의 List view 파일들을 찾는다.
 * - boot50: `src/main/resources/templates/thymeleaf/<module>/egov<Entity>List.html`
 * - boot43: `src/main/resources/templates/thymeleaf/egov<Entity>List.html`
 * - war:    `src/main/webapp/WEB-INF/jsp/<basePackagePath>/<module>/egov<Entity>List.jsp`
 *
 * 이미 마이그레이션된 파일은 결과에 포함되지만 ensureXxxNavInclude 가 idempotent.
 */
async function findListViews(
  projectDir: string,
  projectType: "boot" | "war",
): Promise<string[]> {
  const SKIP = new Set(["target", "build", "node_modules", ".git", ".idea"]);
  const root =
    projectType === "war"
      ? path.join(projectDir, "src/main/webapp/WEB-INF/jsp")
      : path.join(projectDir, "src/main/resources/templates/thymeleaf");

  const results: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
      // _fragments 디렉터리 자체는 view 가 아니므로 건너뛴다.
      if (e.isDirectory() && e.name === "_fragments") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await visit(full);
      } else if (e.isFile()) {
        if (
          (projectType === "war" && /^egov[A-Z]\w*List\.jsp$/.test(e.name)) ||
          (projectType !== "war" && /^egov[A-Z]\w*List\.html$/.test(e.name))
        ) {
          results.push(full);
        }
      }
    }
  }

  await visit(root);
  return results;
}

/**
 * autoApplyMenu 처리의 전체 흐름.
 * - 엔티티 탐색
 * - nav fragment 재생성 (덮어쓰기)
 * - 기존 List 화면들에 include 라인 자동 삽입 (legacy 마이그레이션)
 */
async function applyMenuFragment(args: {
  projectDir: string;
  templateBasePath: string;
  ctx: import("../utils/scaffold/scaffoldGenerator.js").ScaffoldContext;
  newEntity: DiscoveredEntity;
}): Promise<MenuResult> {
  // 1) 기존 엔티티 + 새 엔티티 머지.
  //    - 기존 엔티티 중 @GetMapping("/") 를 가진 것이 primary 로 마킹됨 (discoverEntities 가 처리).
  //    - 새 엔티티는 isPrimaryEntity=false 로 호출됐으므로 isPrimary=false.
  //    - 같은 이름이 양쪽에 있으면(드물지만), 기존 발견을 신뢰 (이미 컨트롤러가 있으므로).
  const existing = await discoverEntities(args.projectDir);
  const mergedMap = new Map<string, DiscoveredEntity>();
  for (const e of existing) mergedMap.set(e.entityName, e);
  if (!mergedMap.has(args.newEntity.entityName)) {
    mergedMap.set(args.newEntity.entityName, args.newEntity);
  }
  const entities = Array.from(mergedMap.values()).sort((a, b) =>
    a.entityName.localeCompare(b.entityName),
  );

  // 2) 컨텍스트 entities 를 머지된 목록으로 덮어쓰고 fragment 렌더링
  const renderCtx: Record<string, unknown> = {
    ...(args.ctx as unknown as Record<string, unknown>),
    entities,
  };
  const fragSpec = args.ctx.stack.navFragment;
  const templateAbs = path.join(args.templateBasePath, fragSpec.template);
  if (!(await fs.pathExists(templateAbs))) {
    throw new Error(`nav fragment 템플릿을 찾을 수 없습니다: ${templateAbs}`);
  }
  const raw = await fs.readFile(templateAbs, "utf-8");
  const rendered = Handlebars.compile(raw)(renderCtx);
  const fragOutAbs = path.join(args.projectDir, fragSpec.output);
  await fs.ensureDir(path.dirname(fragOutAbs));
  await fs.writeFile(fragOutAbs, rendered, "utf-8");

  // 3) 기존 List view 들에 include 라인 자동 삽입 (legacy 마이그레이션)
  const projectType = args.ctx.projectType;
  const listViews = await findListViews(args.projectDir, projectType);
  const migrated: string[] = [];
  for (const v of listViews) {
    const r =
      projectType === "war"
        ? await ensureJspNavInclude(v)
        : await ensureThymeleafNavInclude(v);
    if (r.changed) {
      migrated.push(path.relative(args.projectDir, v));
    }
  }

  return {
    fragmentRelPath: fragSpec.output,
    migratedViewRelPaths: migrated,
    entities,
  };
}

/** 렌더 결과 1건 — 파일로 쓰기 전 메모리 상태. */
interface RenderedEntityFile {
  output: string;
  content: string;
}

/**
 * 매니페스트의 entity-scope 항목들을 메모리에서 렌더링한다 (파일 쓰기는 하지 않는다).
 *
 * 충돌 검사를 "경로 존재 여부" 가 아니라 "렌더 결과와 내용까지 동일한지" 기준으로 하기
 * 위해, 렌더링과 파일 쓰기를 분리했다 — 호출자가 렌더 결과를 먼저 기존 파일과 비교한 뒤
 * 안전할 때만 `writeRenderedEntityFiles` 를 호출한다.
 */
async function renderEntityFilesInMemory(
  templateBasePath: string,
  ctx: Record<string, unknown>,
  mappings: { template: string; output: string; dialect?: string }[],
): Promise<RenderedEntityFile[]> {
  const rendered: RenderedEntityFile[] = [];
  for (const mapping of mappings) {
    const templatePath = path.join(templateBasePath, mapping.template);
    if (!(await fs.pathExists(templatePath))) {
      throw new Error(`템플릿을 찾을 수 없습니다: ${templatePath}`);
    }

    const templateContent = await fs.readFile(templatePath, "utf-8");
    const compiled = Handlebars.compile(templateContent);
    // dialect 가 매핑에 채워져 있으면 방언별 fan-out 항목 — 템플릿이 `{{dialect}}` 분기에 사용.
    const renderCtx = mapping.dialect ? { ...ctx, dialect: mapping.dialect } : ctx;
    const content = compiled(renderCtx);
    rendered.push({ output: mapping.output, content });
  }
  return rendered;
}

/**
 * `renderEntityFilesInMemory` 의 결과를 실제 파일로 쓴다.
 * 사전 충돌 검사(내용 비교) 통과 시점 이후에만 호출된다.
 * 롤백은 호출자가 넘긴 저널로 수행한다 (`withWriteRollback` 은 호출자 책임) — 인프라 설치와
 * 하나의 저널을 공유하기 위함.
 */
async function writeRenderedEntityFiles(
  projectDir: string,
  rendered: RenderedEntityFile[],
  journal: FileWriteJournal,
): Promise<string[]> {
  const written: string[] = [];
  for (const r of rendered) {
    const fullOutputPath = assertInsideProject(projectDir, path.join(projectDir, r.output));
    await journal.recordBeforeWrite(fullOutputPath);
    await fs.ensureDir(path.dirname(fullOutputPath));
    await writeFile(fullOutputPath, r.content, "utf-8");
    written.push(r.output);
  }
  return written;
}

/** 인프라 자동 설치 결과 안내 라인. */
function infraInstallLines(
  plan: AttachFilePlan,
  result: Awaited<ReturnType<typeof applyAttachFileInfra>>,
): string[] {
  return [``, `🧩 첨부파일 인프라 자동 설치:`, ...summarizeAttachFileInstall(plan, result)];
}

export async function egovAddEntity(rawParams: unknown): Promise<string> {
  // 1) 입력 검증
  const parsed = AddEntityInputSchema.safeParse(rawParams);
  if (!parsed.success) {
    throw nonRetryable(formatZodError(parsed.error));
  }
  const params = parsed.data;

  try {
    const projectDir = path.resolve(params.projectPath);

    // 2) 기존 프로젝트의 projectType / stackVersion 자동 감지 (비표준 시 throw)
    const detected = detectProjectStack(projectDir);

    // 2-a) withAttachment 사전조건 — 인프라(EgovFileMngService + EgovConfigAttachFile|context-idgn-File.xml) 가
    //   없으면 설치 *계획* 만 세운다 (쓰기 없음). 실제 적용은 엔티티 사전 검사가 모두 통과한 뒤
    //   엔티티 파일 쓰기와 같은 롤백 저널 안에서 수행한다 — 거부 시 어떤 파일도 쓰지 않는다.
    //   WAR 등 미지원 스택이면 계획 단계에서 nonRetryable 로 거부된다.
    let infraPlan: AttachFilePlan | undefined;
    if (params.withAttachment && !detectAttachFileInfra(projectDir).present) {
      infraPlan = await planAttachFileInfra(defaultAttachFileInstallOptions(projectDir));
    }

    // 3) DDL 정규화 (옵션, 기본 on) — egov_scaffold_project 와 동일 동작
    let ddlForGenerator = params.ddl;
    let normalizationReport: NormalizationReport | undefined;
    if (params.normalizeDdl) {
      const r = normalizeDdl(params.ddl);
      ddlForGenerator = r.normalizedDdl;
      normalizationReport = r.report;
    }

    // 4) 스캐폴드 컨텍스트 구성 — projectName 은 표시용으로만 사용되므로 디렉터리명으로 채운다.
    // `isPrimaryEntity: false` 가 핵심: 컨트롤러 `@GetMapping("/")` 같은
    // 프로젝트당 1회만 있어야 하는 산출물이 추가 엔티티에서 재생성되지 않도록 한다.
    const scaffoldParams: ScaffoldParams = {
      projectName: path.basename(projectDir),
      packageName: params.packageName,
      outputPath: path.dirname(projectDir),
      entityName: params.entityName,
      ddl: ddlForGenerator,
      description: params.description,
      projectType: detected.projectType,
      stackVersion: detected.stackVersion,
      isPrimaryEntity: false,
    };

    registerScaffoldHelpers();
    const ctx = buildContext(scaffoldParams);
    const templateBasePath = getScaffoldTemplatePath();

    // ctx 에 withAttachment 관련 변수 주입 — 모든 entity 템플릿이 {{#if withAttachment}} 분기로 활용.
    const ctxDyn = ctx as unknown as Record<string, unknown>;
    if (params.withAttachment) {
      applyAttachmentContext(ctx, {
        attachmentFieldName: params.attachmentFieldName,
        maxAttachmentCount: params.maxAttachmentCount,
      });
    } else {
      ctxDyn.withAttachment = false;
    }
    // 이전 버전이 생성한 4.3 Boot 프로젝트는 MyBatis @Mapper 로 스캔하므로 새 매퍼도 그 설정을 따른다.
    ctxDyn.useApacheMapper = usesApacheMapperScan(projectDir);
    // idGeneration 관련 — 템플릿이 두 boolean 으로 분기 (Handlebars 가 enum 직접 비교를 어색하게 다룸).
    ctxDyn.idGenerationAuto = params.idGeneration === "auto";
    ctxDyn.idGenerationManual = params.idGeneration === "manual";

    // 2-b) idGeneration=auto 사전 검증: PK 컬럼 maxLength 가 채번 형식보다 작으면 거부.
    //   eGov 자동 채번 형식: '<TABLE_NAME>-NNNNN' (prefix=tableName + '-', cipers=5)
    //   필요 길이 = tableName.length + 1(하이픈) + 5(자릿수) = tableName.length + 6
    //   부족하면 runtime 의 `string data, right truncation` 으로 INSERT 실패. 사전에 거부.
    if (params.idGeneration === "auto" && ctx.pkAttributes && ctx.pkAttributes.length > 0) {
      const pk = ctx.pkAttributes[0];
      const requiredLen = ctx.tableName.length + 6;
      const pkLen = pk.maxLength;
      // maxLength 가 정의된 String PK 만 검증 (NUMBER 등 비문자 PK 는 자동 채번 부적합 — 별도 케이스).
      if (typeof pkLen === "number" && pkLen > 0 && pkLen < requiredLen) {
        throw nonRetryable(
          `PK 컬럼 길이 부족: '${pk.columnName} ${pk.dataType}(${pkLen})' 인데 자동 채번 형식은 ` +
            `'${ctx.tableName}-NNNNN' (${requiredLen}자) 입니다.\n` +
            `해결 방향 두 가지:\n` +
            `  (a) PK 길이를 ${requiredLen} 이상으로 늘려서 다시 호출 — 데이터 테이블이라 surrogate ID 채번이 적합한 경우.\n` +
            `  (b) idGeneration='manual' 로 호출 — DeliveryStatus / Role / CategoryCode 같은 ` +
            `코드 마스터 테이블이라 PK 가 짧은 자연 코드(RCPT/SHIP/DONE 등) 인 경우.`,
        );
      }
    }

    // 4-a) basePackage 자동 보정.
    //   buildContext 는 사용자 packageName 의 마지막 segment 를 떼서 basePackage 를 추출한다.
    //   그러나 사용자가 add_entity 호출 시 깊은 packageName 을 주면 (예: scaffold='egovframework.example.academic'
    //   + add='egovframework.example.academic.student') basePackage 가 첫 스캐폴드의 basePackage 와
    //   어긋나, FkComboVO 같은 공유 클래스의 import 가 실제 파일 위치와 불일치해 컴파일이 실패한다.
    //
    //   기존 프로젝트의 FkComboVO.java 의 실제 package 선언을 읽어 단일 진실원본으로 삼고,
    //   ctx 의 basePackage / basePackagePath 를 그 값으로 덮어쓴다. 첫 스캐폴드에서는 자동 일치하므로
    //   감지 결과가 같아 영향 없음. 어긋날 때만 보정된다.
    const detectedBasePackage = detectBasePackage(projectDir);
    let basePackageRebased: { from: string; to: string } | undefined;
    if (detectedBasePackage && detectedBasePackage !== ctx.basePackage) {
      basePackageRebased = { from: ctx.basePackage, to: detectedBasePackage };
      (ctx as { basePackage: string }).basePackage = detectedBasePackage;
      (ctx as { basePackagePath: string }).basePackagePath = detectedBasePackage.replace(/\./g, "/");
    }

    // 4-a) FK 해석 — DDL 의 REFERENCES 절에서 추출된 fk 컬럼들에 대해 부모 엔티티를
    // 프로젝트에서 찾아 fkParent 를 채운다. 못 찾으면 그대로 두고 (graceful degrade)
    // Register view 가 plain input 으로 fallback 한다.
    const unresolvedFks: { columnName: string; targetTable: string }[] = [];
    for (const col of ctx.attributes) {
      if (!col.fk) continue;
      const parent = await discoverParentEntity(projectDir, col.fk.targetTable);
      if (parent) {
        col.fkParent = parent;
      } else {
        unresolvedFks.push({ columnName: col.columnName, targetTable: col.fk.targetTable });
      }
    }
    // 해석 결과를 ScaffoldContext 의 편의 필드에 반영
    ctx.fkAttributes = ctx.attributes.filter((a) => !!a.fk);
    ctx.resolvedFks = ctx.attributes.filter((a) => !!a.fkParent);
    ctx.hasTrailingTableClauses = ctx.hasCompositePk || ctx.fkAttributes.length > 0;
    {
      const seen = new Set<string>();
      ctx.uniqueFkParents = ctx.resolvedFks.filter((c) => {
        const key = c.fkParent?.entityName;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    ctx.hasFk = ctx.resolvedFks.length > 0;
    // FK 부모가 채워진 뒤 라벨을 다시 계산한다 (코멘트 없는 FK 컬럼은 부모 엔티티명이 라벨).
    applyLabels(ctx);

    // 5) entity-scope 항목만 추려 최종 출력 경로 산출
    const mappings = resolveManifest(
      ctx.stack.manifest,
      ctx as unknown as Record<string, unknown>,
      "entity",
    );

    if (mappings.length === 0) {
      throw new Error(
        `매니페스트 '${ctx.stack.manifest}' 에 scope='entity' 항목이 없습니다. 매니페스트 설정을 확인하세요.`,
      );
    }

    // 5-pre) idGeneration='manual' 이면 채번 빈/XML 항목을 mapping 에서 제거한다.
    //   - boot43/boot50: EgovConfig{Entity}IdGeneration.java
    //   - war43: context-{entity}-idgen.xml
    // 매니페스트 파일 자체는 건드리지 않고 도구 측에서 필터링 — 다른 호출에서는 항목 그대로 사용.
    if (params.idGeneration === "manual") {
      for (let i = mappings.length - 1; i >= 0; i--) {
        const t = mappings[i].template;
        const o = mappings[i].output;
        if (t.includes("config/EgovConfigIdGeneration") || (t.includes("context-") && o.includes("idgen"))) {
          mappings.splice(i, 1);
        }
      }
    }

    // 5-a) 마이그레이션 SQL 전략 결정.
    //   - 첫 스캐폴드는 sampledb.sql 안에 IDS 테이블/엔티티 DDL 을 함께 만들지만
    //     추가 엔티티는 그 위에 적용할 "엔티티 CREATE TABLE + IDS row INSERT" 만
    //     담은 작은 마이그레이션 SQL 이 필요하다.
    //   - autoApplyMigration=false (기본): 별도 파일(add-{entity}-tables.sql) 생성.
    //     사용자/LLM 이 직접 시드에 반영하는 보수적 흐름.
    //   - autoApplyMigration=true: src/main/resources/db/ 에 사용자 시드 *.sql 이 정확히 1개일 때
    //     그 파일 끝에 자동 append. 0개·2개 이상이면 안전을 위해 별도 파일 생성으로 fallback.
    const migrationOutput = `src/main/resources/db/add-${ctx.entityNameLower}-tables.sql`;
    const migrationDecision = await decideMigrationStrategy({
      projectDir,
      autoApplyMigration: params.autoApplyMigration,
      newMigrationOutput: migrationOutput,
    });

    // 자동 append 모드면 매니페스트에 추가하지 않는다 (별도 파일을 만들지 않음).
    // 기본/fallback 모드면 일반 entity 산출물과 동일하게 mappings 에 push 하여
    // 충돌 사전 검사 / 렌더링 / 결과 목록을 그대로 받는다.
    if (migrationDecision.strategy === "separateFile") {
      mappings.push({
        template: ctx.stack.addEntityMigration,
        output: migrationOutput,
        scope: "entity",
        mode: "create",
      });
    }

    // 5-b) 운영 DB 용 방언별 마이그레이션 SQL 은 매니페스트의 sampledb-migrations 항목이
    //   expandDialects=true 로 fan-out 되어 7개 방언 폴더에 자동 생성된다 — add_entity 측에서
    //   추가로 push 할 필요 없음. 첫 엔티티만 isPrimaryEntity=true 라서 IDS CREATE TABLE 을
    //   포함하고, 그 이후 엔티티는 INSERT INTO IDS 만 포함한다 (템플릿 분기).

    // 6) 렌더링(메모리) — 파일을 쓰기 전에 기존 산출물과 내용을 비교해 멱등 여부를 판단한다.
    const renderedFiles = await renderEntityFilesInMemory(
      templateBasePath,
      ctx as unknown as Record<string, unknown>,
      mappings,
    );

    const fileStatuses: { output: string; status: "missing" | "identical" | "different" }[] = [];
    for (const r of renderedFiles) {
      // 비교(읽기) 단계에도 경로 가드 적용 — 심층 방어 (쓰기 단계와 동일 기준).
      const abs = assertInsideProject(projectDir, path.join(projectDir, r.output));
      if (await fs.pathExists(abs)) {
        const existing = await fs.readFile(abs, "utf-8");
        fileStatuses.push({
          output: r.output,
          status: existing === r.content ? "identical" : "different",
        });
      } else {
        fileStatuses.push({ output: r.output, status: "missing" });
      }
    }
    const existingStatuses = fileStatuses.filter((s) => s.status !== "missing");

    // 6-a) 완전 멱등 — 대상 파일이 전부 존재하고 내용까지 렌더 결과와 정확히 동일하면
    //   아무 파일도 쓰지 않고 "변경 없음" 성공으로 종료한다. autoApplyMigration/autoApplyMessages/
    //   autoApplyMenu 같은 후속 단계도 실행하지 않는다 — 이미 이전(첫) 호출에서 반영되었을
    //   것이므로 재실행하면 시드/메시지 번들에 중복 append 될 위험이 있다.
    if (
      renderedFiles.length > 0 &&
      existingStatuses.length === fileStatuses.length &&
      existingStatuses.every((s) => s.status === "identical")
    ) {
      // 엔티티는 그대로지만 첨부 인프라만 없는 경우 — 인프라만 설치한다 (롤백 저널 공유 불필요, 단독 적용).
      let infraLines: string[] = [];
      if (infraPlan) {
        const plan = infraPlan;
        const journal = new FileWriteJournal();
        const result = await withWriteRollback(projectDir, journal, () =>
          applyAttachFileInfra(plan, journal),
        );
        infraLines = infraInstallLines(plan, result);
      }
      return (
        (infraLines.length > 0
          ? `ℹ️ 엔티티 '${params.entityName}' 은(는) 변경 없이 이미 동일한 내용으로 생성되어 있고, 누락된 첨부파일 인프라를 설치했습니다.\n\n`
          : `ℹ️ 엔티티 '${params.entityName}' 은(는) 이미 동일한 내용으로 생성되어 있습니다. 변경 사항 없음.\n\n`) +
        `📁 프로젝트: ${projectDir}\n` +
        `🏷️ 엔티티: ${ctx.entityName} (테이블: ${ctx.tableName})\n` +
        `📄 대상 파일 수: ${fileStatuses.length} (모두 기존 내용과 동일)\n\n` +
        `대상 파일:\n${fileStatuses.map((s) => `  - ${s.output}`).join("\n")}\n\n` +
        `⏭️ autoApplyMigration / autoApplyMessages / autoApplyMenu 후속 단계는 건너뛰었습니다 ` +
        `(이미 이전 호출에서 반영되었을 것으로 간주해 중복 적용을 방지합니다).` +
        (infraLines.length > 0 ? `\n${infraLines.join("\n")}\n` : ``) +
        completionFooter()
      );
    }

    // 6-b) 부분 충돌 — 하나라도 존재하면(내용 동일/상이 무관) 원자적으로 거부하고
    //   어떤 파일도 쓰지 않는다. 존재하는 파일을 내용 동일/상이로 구분해 안내한다.
    if (existingStatuses.length > 0) {
      const identical = existingStatuses.filter((s) => s.status === "identical").map((s) => s.output);
      const different = existingStatuses.filter((s) => s.status === "different").map((s) => s.output);
      const sections: string[] = [];
      if (different.length > 0) {
        sections.push(
          `  내용 상이 (${different.length}개):\n${different.map((f) => `    - ${f}`).join("\n")}`,
        );
      }
      if (identical.length > 0) {
        sections.push(
          `  내용 동일 (${identical.length}개):\n${identical.map((f) => `    - ${f}`).join("\n")}`,
        );
      }
      throw retryAfterAction(
        `엔티티 '${params.entityName}' 추가가 충돌로 거부되었습니다. ` +
          `다음 파일이 이미 존재합니다 (${existingStatuses.length}개):\n` +
          sections.join("\n") +
          `\n\n기존 파일을 보존하기 위해 어떤 파일도 작성되지 않았습니다. ` +
          `다른 entityName 으로 호출하거나, 충돌 파일을 직접 정리한 뒤 다시 시도하세요.`,
      );
    }

    // 6-c) 생성 결과 자체 검증 — 디스크에 쓰기 전에 Handlebars 잔존 토큰 / XML 태그 균형을
    //   점검한다. 실패하면 어떤 파일도 쓰지 않고 nonRetryable 로 거부한다 — 재시도해도
    //   같은 렌더 결과가 나오므로(생성기 내부 버그) 인자를 바꾸지 않는 재시도는 무의미하다.
    const validationIssues = validateRenderedFiles(
      renderedFiles.map((r) => ({ relPath: r.output, content: r.content })),
    );
    if (validationIssues.length > 0) {
      throw nonRetryable(
        `생성 결과 자체 검증 실패 — 생성기 내부 문제일 수 있습니다.\n${validationIssues.map((v) => `  - ${v}`).join("\n")}`,
      );
    }

    // 7) 파일 쓰기 (위 단계에서 대상 파일이 모두 없음을 확인했으므로 전량 신규 생성)
    //   인프라 설치(있다면)를 먼저, 이어서 엔티티 파일을 하나의 롤백 저널로 쓴다 —
    //   어느 쪽이 실패해도 둘 다 원상 복구된다.
    const writeJournal = new FileWriteJournal();
    let infraInstallLinesOut: string[] = [];
    const written = await withWriteRollback(projectDir, writeJournal, async () => {
      if (infraPlan) {
        const result = await applyAttachFileInfra(infraPlan, writeJournal);
        infraInstallLinesOut = infraInstallLines(infraPlan, result);
      }
      return writeRenderedEntityFiles(projectDir, renderedFiles, writeJournal);
    });

    // 7-a) appendToSeed 모드: 마이그레이션 템플릿을 별도 렌더링해 감지된 시드 파일 끝에 append.
    let appendedSeedRelPath: string | undefined;
    if (migrationDecision.strategy === "appendToSeed") {
      const seedAbs = migrationDecision.seedFileAbsPath;
      const migrationContent = await renderMigrationContent(
        templateBasePath,
        ctx.stack.addEntityMigration,
        ctx as unknown as Record<string, unknown>,
      );
      // 시드 끝과 추가 내용 사이에 빈 줄 보장 (가독성 + 마지막 줄 종결 누락 방지)
      await fs.appendFile(seedAbs, "\n" + migrationContent);
      appendedSeedRelPath = path.relative(projectDir, seedAbs);
    }

    // 7-b) autoApplyMessages 처리.
    //   - appendToBundles: 3개 메시지 번들 파일 끝에 엔티티별 키들을 append.
    //     번들마다 로케일이 다르므로 default/ko 는 한국어 partial, en 은 영문 partial 을 사용.
    //   - notApplicable: 아무것도 안 함. 사유는 결과 메시지에 노출.
    const messagesDecision = await decideMessagesStrategy({
      projectDir,
      autoApplyMessages: params.autoApplyMessages,
    });
    const appendedMessageFiles: string[] = [];
    if (messagesDecision.strategy === "appendToBundles") {
      // KR + EN 두 partial 을 한 번씩만 렌더링해 재사용한다.
      const krContent = await renderMigrationContent(
        templateBasePath,
        ctx.stack.addEntityMessages.defaultLocale,
        ctx as unknown as Record<string, unknown>,
      );
      const enContent = await renderMigrationContent(
        templateBasePath,
        ctx.stack.addEntityMessages.en,
        ctx as unknown as Record<string, unknown>,
      );

      for (const target of messagesDecision.targets) {
        const content = target.locale === "en" ? enContent : krContent;
        // 번들 파일 끝이 줄바꿈으로 안 끝나는 경우 대비해 leading newline 보장.
        await fs.appendFile(target.absPath, "\n" + content);
        appendedMessageFiles.push(target.relPath);
      }
    }

    // 7-c) autoApplyMenu 처리.
    //   - false (기본): 메뉴는 사용자가 직접 관리. nav fragment 는 첫 스캐폴드 시 만들어진 그대로 유지.
    //   - true:
    //       1) Egov*Controller.java 들에서 기존 엔티티 목록 탐색
    //       2) 새 엔티티 + 기존 엔티티들로 nav fragment 재생성 (덮어쓰기)
    //       3) 기존 List 화면들에 fragment include 라인이 없으면 자동 마이그레이션 한 줄 삽입
    let menuResult: MenuResult | undefined;
    if (params.autoApplyMenu) {
      try {
        menuResult = await applyMenuFragment({
          projectDir,
          templateBasePath,
          ctx,
          newEntity: {
            entityName: ctx.entityName,
            entityNameLower: ctx.entityNameLower,
            isPrimary: false, // egov_add_entity 의 새 엔티티는 정의상 primary 아님
          },
        });
      } catch (e) {
        menuResult = {
          migratedViewRelPaths: [],
          entities: [],
          skippedReason: `메뉴 fragment 자동 갱신 중 오류: ${e instanceof Error ? e.message : "Unknown error"}`,
        };
      }
    }

    // 8) 결과 메시지 구성
    const egovLabel = detected.stackVersion === "5.1" ? "eGovFrame 5.1" : "eGovFrame 4.3";
    const kindLabel = detected.projectType === "war" ? "WAR" : "Spring Boot";

    const lines = [
      `✅ ${egovLabel} ${kindLabel} 프로젝트에 엔티티 '${params.entityName}' 추가 완료!`,
      ``,
      `📁 프로젝트: ${projectDir}`,
      `🔎 감지된 스택: ${detected.reason}`,
      `🏷️  엔티티: ${ctx.entityName} (테이블: ${ctx.tableName})`,
      `📦 패키지: ${params.packageName}`,
      `📄 추가된 파일 수: ${written.length}`,
      ``,
      `추가된 파일:`,
      ...written.map((f) => `  - ${f}`),
    ];

    if (infraInstallLinesOut.length > 0) {
      lines.push(...infraInstallLinesOut);
    }

    // basePackage 자동 보정 안내 — 입력 packageName 으로 추출한 basePackage 가 기존 프로젝트와 달라
    // FkComboVO 등 공유 클래스 위치에 맞춰 보정한 경우.
    if (basePackageRebased) {
      lines.push(
        ``,
        `🔧 공유 basePackage 자동 보정:`,
        `   입력 packageName 으로 추출한 basePackage 가 기존 프로젝트와 달라 보정했습니다.`,
        `     ${basePackageRebased.from}  →  ${basePackageRebased.to}`,
        `   (FkComboVO 등 공유 클래스의 실제 위치를 기준으로 import 가 일치하도록 맞춥니다.)`,
      );
    }

    // FK 처리 결과 — 해석된 FK 가 있으면 어떻게 처리됐는지, 미해석 FK 는 경고 안내
    if (ctx.resolvedFks.length > 0) {
      lines.push(
        ``,
        `🔗 외래키(FK) 자동 처리 완료 — ${ctx.resolvedFks.length}개 컬럼:`,
        ...ctx.resolvedFks.map((c) => {
          const p = c.fkParent!;
          return `   - ${c.columnName} → ${c.fk!.targetTable}(${c.fk!.targetColumn}) : 표시 컬럼=[${p.displayColumns.join(", ")}]`;
        }),
        `   생성 효과:`,
        `     - Register 화면: <select> 콤보박스로 부모 PK + 표시 컬럼 노출`,
        `     - List 화면: ID 대신 부모 표시 컬럼 (예: 이름) 으로 자동 JOIN 표시`,
        `     - Controller: addView/updateView 가 부모 콤보 리스트를 model 에 자동 주입`,
      );
    }
    if (unresolvedFks.length > 0) {
      lines.push(
        ``,
        `⚠️  외래키(FK) 미해석 — ${unresolvedFks.length}개 컬럼:`,
        ...unresolvedFks.map(
          (u) =>
            `   - ${u.columnName} → ${u.targetTable} : 부모 엔티티가 프로젝트에 없어 plain <input> 으로 fallback`,
        ),
        `   해결: 부모 엔티티를 (이 프로젝트에 먼저) 추가한 뒤 본 엔티티를 다시 만드세요.`,
        `   주의: 이미 만들어진 산출물은 보존됩니다 — 부모 추가 후 같은 엔티티 재생성을 원하면 산출물을 직접 삭제하거나 별도 도구가 필요합니다.`,
      );
    }

    // 코멘트 라벨 반영 결과 — DDL COMMENT 가 라벨로 쓰인 컬럼 수와, 코멘트는 있으나 규칙에 걸려
    // 컬럼명 표기로 폴백된 컬럼을 안내한다. 코멘트가 전혀 없는 DDL 이면 아무 것도 출력하지 않는다.
    const commentedCols = ctx.attributes.filter((c) => c.comment !== null);
    const labeledFromComment = commentedCols.filter((c) => deriveLabelFromComment(c.comment) !== null);
    const excludedByRule = commentedCols.filter((c) => deriveLabelFromComment(c.comment) === null);
    if (commentedCols.length > 0 || ctx.hasTableLabel) {
      lines.push(
        ``,
        `🏷️  코멘트 라벨 반영: ${labeledFromComment.length}개 컬럼 (DDL COMMENT 가 화면 라벨·메시지 번들 값으로 사용됨)`,
      );
      if (ctx.hasTableLabel) {
        lines.push(`   엔티티 표시명: ${ctx.entityLabel} (테이블 COMMENT → 메뉴·제목)`);
      } else if (ctx.tableComment !== null) {
        lines.push(
          `   테이블 COMMENT '${ctx.tableComment}' 은 규칙에 걸려 엔티티명 ${ctx.entityName} 을(를) 사용합니다 (메뉴·제목)`,
        );
      }
      if (excludedByRule.length > 0) {
        lines.push(
          `   규칙으로 제외된 컬럼: ${excludedByRule.map((c) => c.columnName).join(", ")} (괄호 밖 구분 문자(, / ; :) 포함·괄호 앞이 비어 있음·10자 초과 코멘트는 컬럼명 표기 사용)`,
        );
      }
    }

    // 운영 DB 용 방언별 마이그레이션 SQL — 7개 방언 폴더 각각에 단일 엔티티 파일.
    lines.push(
      ``,
      `🌐 운영 DB 용 방언별 마이그레이션 SQL 이 함께 생성되었습니다 (7개 방언):`,
      `   📁 src/main/resources/db/migrations/{oracle,tibero,altibase,cubrid,goldilocks,mysql,postgres}/${ctx.entityNameLower}db.sql`,
      `   기본 HSQL 프로파일에서는 사용되지 않습니다. 운영 DB 전환 시 해당 방언 폴더의 파일을 그대로 또는 Flyway/Liquibase 로 적용하세요.`,
    );

    // 마이그레이션 SQL 처리 결과 안내 — 3 흐름
    if (migrationDecision.strategy === "appendToSeed") {
      lines.push(
        ``,
        `✅ 데이터베이스 마이그레이션 자동 적용 완료 (autoApplyMigration=true):`,
        `   📄 ${appendedSeedRelPath}`,
        `   파일 끝에 다음이 append 되었습니다:`,
        `     - CREATE MEMORY TABLE ${ctx.tableName}(...)`,
        `     - INSERT INTO IDS VALUES('${ctx.entityNameUpper}', 1)`,
        `   재기동 시 HSQLDB 가 시드를 다시 로드하면 자동 반영됩니다.`,
      );
    } else if (migrationDecision.fallbackReason) {
      // autoApplyMigration=true 였으나 안전 조건 미충족
      lines.push(
        ``,
        `⚠️  자동 적용 조건 미충족 — 별도 마이그레이션 파일로 fallback:`,
        `   사유: ${migrationDecision.fallbackReason}`,
        `   📄 ${migrationOutput}`,
        `   적용 방법 (택일):`,
        `     (a) 기존 시드 SQL 파일 (예: src/main/resources/db/*.sql) 끝에 위 파일 내용을 추가`,
        `     (b) HSQL Database Manager/DBeaver 등에서 별도로 직접 실행`,
        `   적용 후 IDS 에 '${ctx.entityNameUpper}' row 가 존재해야 egov${ctx.entityName}IdGnrService 빈이 정상 동작합니다.`,
      );
    } else {
      // 명시적 autoApplyMigration=false (사용자가 직접 적용을 선호)
      lines.push(
        ``,
        `⚠️  데이터베이스 마이그레이션 필수 (autoApplyMigration=false 로 호출됨):`,
        `   생성된 CRUD 코드가 동작하려면 다음 SQL 파일을 기존 DB 에 적용해야 합니다.`,
        `     📄 ${migrationOutput}`,
        `   적용 방법 (택일):`,
        `     (a) 기존 시드 SQL 파일 (예: src/main/resources/db/*.sql) 끝에 위 파일 내용을 추가`,
        `     (b) HSQL Database Manager/DBeaver 등에서 별도로 직접 실행`,
        `   적용 후 IDS 에 '${ctx.entityNameUpper}' row 가 존재해야 egov${ctx.entityName}IdGnrService 빈이 정상 동작합니다.`,
      );
    }

    // 메뉴 처리 결과 안내 (autoApplyMenu=true 인 경우에만 노출)
    if (menuResult) {
      if (menuResult.skippedReason) {
        lines.push(
          ``,
          `⚠️  메뉴 자동 갱신 미수행:`,
          `   사유: ${menuResult.skippedReason}`,
        );
      } else {
        const entityList = menuResult.entities
          .map((e) => e.entityName)
          .join(", ");
        lines.push(
          ``,
          `✅ 메뉴 자동 갱신 완료 (autoApplyMenu=true):`,
          `   📄 ${menuResult.fragmentRelPath}`,
          `   포함된 엔티티: ${entityList}`,
        );
        if (menuResult.migratedViewRelPaths.length > 0) {
          lines.push(
            `   기존 List 화면 ${menuResult.migratedViewRelPaths.length}개에 fragment include 라인 자동 삽입:`,
            ...menuResult.migratedViewRelPaths.map((f) => `     - ${f}`),
          );
        }
        // autoApplyMessages 가 꺼져 있으면 nav.{entity} 키가 누락되어 화면에 ??nav.X?? 노출됨
        if (!params.autoApplyMessages) {
          lines.push(
            `   ⚠️  autoApplyMessages=false 라 nav.* 메시지 키가 누락될 수 있습니다 — 화면에 ??nav.${ctx.entityNameLower}?? 노출 시 message-common 에 nav.${ctx.entityNameLower}={{표시명}} 을 직접 추가하세요.`,
          );
        }
      }
    }

    // 메시지 번들 처리 결과 안내 — 2 흐름
    if (messagesDecision.strategy === "appendToBundles") {
      lines.push(
        ``,
        `✅ 메시지 번들 자동 적용 완료 (autoApplyMessages=true):`,
        `   다음 ${appendedMessageFiles.length}개 파일 끝에 엔티티 '${params.entityName}' 메시지 키들이 append 되었습니다:`,
        ...appendedMessageFiles.map((f) => `     - ${f}`),
        `   추가된 키: list.${ctx.entityNameLower}, title.${ctx.entityNameLower}.sample, title.${ctx.entityNameLower}.* (컬럼별), confirm.required.${ctx.entityNameLower}.* (필수입력)`,
      );
    } else {
      lines.push(
        ``,
        `⚠️  메시지 번들 자동 적용 미수행:`,
        `   사유: ${messagesDecision.fallbackReason ?? "알 수 없음"}`,
        `   직접 적용 가이드: src/main/resources/egovframework/message/message-common(_ko/_en).properties 에 다음 키들을 추가하세요.`,
        `     list.${ctx.entityNameLower}, title.${ctx.entityNameLower}.sample, title.${ctx.entityNameLower}.<컬럼>, confirm.required.${ctx.entityNameLower}.<컬럼>`,
        `   💡 autoApplyMessages=true 로 호출하면 자동 append 됩니다 (3개 번들이 모두 존재할 때).`,
      );
    }

    // 9) DDL 파서 폴백 안내 — AST(MySQL) 파싱 실패로 legacy 정규식 파서가 쓰인 경우.
    //    산출물은 정상 생성되지만 입력 DDL 이 비표준일 수 있음을 사용자가 알아야 한다.
    if (ctx.ddlParserUsed === "legacy") {
      lines.push(
        ``,
        `⚠️  DDL 파서 폴백 안내:`,
        ...ctx.ddlWarnings.map((w) => `   - ${w}`),
        `   생성된 코드가 의도와 다르면 DDL 을 표준 MySQL 문법으로 정리한 뒤 다시 실행해 보세요.`,
      );
    }

    // 10) 정규화 보고서 첨부 (변경/경고가 있을 때만)
    if (normalizationReport) {
      const summary = formatNormalizationReport(normalizationReport);
      if (summary) {
        lines.push(``, `---`, `🧹 DDL 정규화 결과:`, ``, summary);
      }
    }

    lines.push(``, `✅ 자체 검증 통과 (검사한 파일 ${renderedFiles.length}개)`);

    return lines.join("\n") + completionFooter();
  } catch (error) {
    console.error("Error in egovAddEntity:", error);
    throw new Error(
      `엔티티 추가 실패: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
