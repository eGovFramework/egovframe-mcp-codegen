import * as path from "path";
import fs from "fs-extra";
import { writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import { parseDDL, Column } from "./ddlParser.js";
import { deriveLabelFromComment, escapePropertiesValue } from "./messageLabel.js";
import { resolveStack, type StackEntry } from "./stackMatrix.js";
import { resolveManifest, type ResolvedFileMapping } from "./manifestLoader.js";
import { dialectFullType, type Dialect } from "./dialectTypes.js";
import { assertInsideProject } from "./pathGuard.js";
import { osJunkCopyFilter } from "../fsCopyFilter.js";
import { validateRenderedFiles } from "./outputValidator.js";
import { nonRetryable, retryAfterAction } from "./toolMessages.js";
import { applyAttachmentContext } from "./attachmentContext.js";

export interface ScaffoldParams {
  projectName: string;
  packageName: string;
  outputPath: string;
  entityName: string;
  ddl: string;
  description: string;
  projectType: "boot" | "war";
  stackVersion: "4.3" | "5.1";
  /**
   * true 이면 첫 엔티티를 첨부파일 연결(`withAttachment`) 형태로 렌더링한다.
   * 인프라 설치는 이 함수가 아니라 도구 계층(`egovScaffoldProject`)이 생성 직후 수행한다.
   */
  withAttachment?: boolean;
  /**
   * 이 호출이 프로젝트의 "최초/주(primary) 엔티티"를 만드는지 여부.
   * - `egov_scaffold_project` 가 새 프로젝트의 첫 엔티티를 만들 때: `true` (기본).
   * - `egov_add_entity` 가 기존 프로젝트에 추가 엔티티를 끼워넣을 때: `false`.
   *
   * 템플릿에서 `{{#if isPrimaryEntity}}` 분기로 한 프로젝트에 하나만 있어야 하는
   * 산출물(예: 컨트롤러의 `@GetMapping("/")` 루트 매핑)을 통제한다.
   */
  isPrimaryEntity?: boolean;
  /**
   * nav fragment 렌더링에 사용될 전체 엔티티 목록 (옵션).
   *
   * 미지정 시 `buildContext` 가 primary 엔티티 1개로 채운다 — `egov_scaffold_project` 의
   * 첫 호출이 이에 해당. `egov_add_entity` 가 nav fragment 를 재생성할 때는 기존 컨트롤러
   * 들에서 탐색한 전체 목록을 직접 넘긴다.
   */
  entities?: { entityName: string; entityNameLower: string; isPrimary: boolean }[];
}

export interface ScaffoldContext {
  projectName: string;
  groupId: string;
  artifactId: string;
  description: string;
  projectType: "boot" | "war";
  stackVersion: "4.3" | "5.1";
  /**
   * 첫 엔티티 여부. 템플릿에서 한 프로젝트당 1개만 있어야 하는 산출물을 분기 처리할 때 사용.
   * `egov_scaffold_project` 의 기본값은 `true`, `egov_add_entity` 는 항상 `false`.
   */
  isPrimaryEntity: boolean;

  packageName: string;
  packagePath: string;
  basePackage: string;
  basePackagePath: string;
  entityModule: string;

  entityName: string;
  entityNameLower: string;
  entityNameUpper: string;

  tableName: string;
  attributes: Column[];
  pkAttributes: Column[];
  /** 테이블 COMMENT 원문 (파서 IR 그대로). 없으면 null. */
  tableComment: string | null;
  /**
   * 엔티티 표시명 — 메시지 번들의 `nav.<entity>`, `title.<entity>[.sample]`, `list.<entity>` 값.
   * 테이블 코멘트가 라벨 규칙(`deriveLabelFromComment`)을 통과하면 그 값, 아니면 `entityName`.
   * `applyLabels` 가 채운다.
   */
  entityLabel: string;
  /** `entityLabel` 이 테이블 코멘트에서 왔는지. 템플릿이 "List X" / "X 목록" 문구를 분기할 때 사용. */
  hasTableLabel: boolean;
  /**
   * DDL 파싱에 사용된 파서 경로. "legacy" 면 AST(MySQL dialect) 파싱이 실패해
   * 정규식 파서로 폴백한 것 — 입력 DDL 이 비표준일 가능성이 있어 도구 결과
   * 메시지에서 사용자에게 안내한다.
   */
  ddlParserUsed: "ast" | "legacy";
  /** DDL 파싱 경고 목록 (legacy 폴백 사유 등). 정상 경로에서는 빈 배열. */
  ddlWarnings: string[];
  nonPkAttributes: Column[];
  searchableAttributes: Column[];
  hasCompositePk: boolean;
  hasDateAttr: boolean;
  /** PK 가 아닌 NOT NULL 문자열 컬럼 — WAR validator.xml 의 required 필드 (DTD 상 form 은 field 1개 이상이어야 하므로 비어 있으면 form 을 만들지 않는다). */
  requiredStringAttributes: Column[];
  hasRequiredStringAttr: boolean;
  imports: string[];
  /**
   * DDL 의 REFERENCES 절에서 추출된 모든 FK 컬럼 (부모 해석 여부 무관).
   *
   * 시드 SQL 의 `CONSTRAINT FK_X FOREIGN KEY (col) REFERENCES TARGET(col)` 절 출력에
   * 사용된다. resolvedFks 와 달리 부모가 프로젝트에 없어도 SQL 제약은 보존해야 하므로
   * 별도 집합이 필요하다.
   */
  fkAttributes: Column[];
  /**
   * CREATE TABLE 의 컬럼 블록 뒤에 테이블-레벨 절(복합 PK, FK 제약) 이 있는지.
   * 마지막 컬럼 라인 뒤에 콤마를 붙일지 결정하는 가독성용 플래그.
   */
  hasTrailingTableClauses: boolean;
  /**
   * 부모 엔티티가 해석된 FK 컬럼들의 목록. Register view 가 `<select>` 로,
   * List view 의 JOIN 절이 한 JOIN 씩 생성하기 위해 한 곳에서 일괄 iterate 한다.
   * 빈 배열이면 FK 처리 자체를 스킵.
   */
  resolvedFks: Column[];
  /**
   * `resolvedFks` 를 부모 엔티티 기준으로 중복 제거한 부분집합 (Mapper 메서드 / Service /
   * Controller 모델 주입처럼 "부모당 1회" 가 맞는 산출물에 사용). 같은 부모를 가리키는 FK 가
   * 둘 이상 있어도 콤보 리스트 쿼리는 하나만 만들어진다.
   */
  uniqueFkParents: Column[];
  /** `resolvedFks.length > 0` 의 편의 플래그 (템플릿 가독성용). */
  hasFk: boolean;

  // Thymeleaf helpers (pre-computed to avoid triple-brace issues)
  voName: string;
  thVO: string;

  idPrefix: string;

  date: string;
  author: string;
  version: string;

  /**
   * 호환성 매트릭스(`templates/stacks.json`)에서 해석된 스택 메타데이터.
   * pom.xml 등 템플릿이 `{{stack.springBoot}}`, `{{stack.java}}` 형태로 참조한다.
   */
  stack: StackEntry;
  /**
   * 프로젝트에 존재하는(또는 추가될) 전체 엔티티 목록.
   *
   * - `egov_scaffold_project` 첫 호출에서는 primary 엔티티 1개 → `[{ ... isPrimary: true }]`.
   * - `egov_add_entity` 호출 시 (`autoApplyMenu=true`) 에는 기존 Egov*Controller.java 들에서
   *   탐색한 모든 엔티티 + 새 엔티티 가 합쳐진 목록이 들어간다.
   *
   * `isPrimary` 는 root URL(`/`) 을 담당하는 엔티티 표시 — nav fragment 에서 `/` 진입 시
   * 그 엔티티의 메뉴를 활성으로 강조하는 데 쓴다.
   *
   * nav fragment 템플릿이 이 목록을 순회해 메뉴 링크를 생성하므로 항상 채워져 있어야 한다.
   */
  entities: { entityName: string; entityNameLower: string; isPrimary: boolean }[];

  /**
   * PK 채번 방식 분기용 boolean (Handlebars 가 enum 직접 비교를 어색하게 다뤄 두 boolean 으로 분리).
   *
   * - `idGenerationAuto`:   EgovTableIdGnrServiceImpl 자동 채번 모드 (기본). Service 의
   *                        `getNextStringId()` 호출, IDS row INSERT, EgovConfig*IdGeneration.java
   *                        Bean 모두 emit 된다.
   * - `idGenerationManual`: 사용자가 PK 직접 입력 모드 (코드 마스터 테이블용). 위 산출물 모두 생략.
   *
   * `egov_scaffold_project` 는 항상 auto (= 기본). `egov_add_entity` 만 사용자 옵션으로 override.
   */
  idGenerationAuto: boolean;
  idGenerationManual: boolean;
}

/**
 * 템플릿 디렉터리의 절대 경로를 반환한다. `EGOVFRAME_SCAFFOLD_TEMPLATE_PATH`
 * 환경변수가 설정되어 있으면 그 값을 우선 사용한다. egov_add_entity 등 다른
 * 도구도 동일한 해석을 쓸 수 있도록 export 한다.
 */
export function getScaffoldTemplatePath(): string {
  if (process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH) {
    return process.env.EGOVFRAME_SCAFFOLD_TEMPLATE_PATH;
  }
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    // build/utils/scaffold → project root: 세 단계 위로
    const projectRoot = path.resolve(__dirname, "../../..");
    return path.join(projectRoot, "templates");
  } catch {
    return path.join(process.cwd(), "templates");
  }
}

/**
 * resolvedFks 를 부모 엔티티 entityName 기준으로 dedupe.
 * 같은 부모 (예: USER) 를 두 컬럼이 모두 참조하면 콤보 쿼리는 하나만 만들면 되기 때문.
 */
function dedupeByParentEntityName(cols: Column[]): Column[] {
  const seen = new Set<string>();
  const out: Column[] = [];
  for (const c of cols) {
    const key = c.fkParent?.entityName;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function extractRawTableName(ddl: string): string {
  const match = ddl.match(/CREATE\s+(?:MEMORY\s+)?TABLE\s+[`"']?(\w+)[`"']?/i);
  return match ? match[1].toUpperCase() : "UNKNOWN";
}

/**
 * Handlebars 헬퍼를 전역에 등록한다. 멱등이므로 여러 번 호출해도 안전하다.
 * egov_add_entity 도 같은 헬퍼들을 필요로 한다.
 */
export function registerScaffoldHelpers() {
  Handlebars.registerHelper("eq", function (a: any, b: any) { return a === b; });
  // 메시지 번들 값 출력용. 스택이 번들을 ISO-8859-1 로 읽으면(WAR 4.3, stack.messageUnicodeEscape)
  // 비ASCII 를 \uXXXX 로 이스케이프한다. SafeString 으로 돌려 Handlebars 의 HTML 이스케이프를 막는다.
  Handlebars.registerHelper("msg", function (value: unknown, options: Handlebars.HelperOptions) {
    const root = options?.data?.root as { stack?: { messageUnicodeEscape?: boolean } } | undefined;
    const unicodeEscape = root?.stack?.messageUnicodeEscape === true;
    return new Handlebars.SafeString(escapePropertiesValue(value == null ? "" : String(value), unicodeEscape));
  });
  Handlebars.registerHelper("concat", function (...args: any[]) { return args.slice(0, -1).join(""); });
  Handlebars.registerHelper("lowercase", function (str: string) { return typeof str === "string" ? str.toLowerCase() : ""; });
  Handlebars.registerHelper("uppercase", function (str: string) { return typeof str === "string" ? str.toUpperCase() : ""; });
  Handlebars.registerHelper("simpleJavaType", function (fullType: string) { if (!fullType) return fullType; return fullType.split(".").pop() || fullType; });
  Handlebars.registerHelper("add", function (a: any, b: any) { return (Number(a) || 0) + (Number(b) || 0); });
  Handlebars.registerHelper("empty", function (value: any) { return value === null || value === ""; });
  Handlebars.registerHelper("error", function (message: string) { console.error(message); return new Handlebars.SafeString(`<span class="error">${message}</span>`); });
  Handlebars.registerHelper("setVar", function (varName: string, varValue: any, options: any) { options.data.root[varName] = varValue; });
  Handlebars.registerHelper("thExpr", function (...args: any[]) {
    const parts = args.slice(0, -1);
    return new Handlebars.SafeString("${" + parts.join("") + "}");
  });
  // SQL 의 display 표현식 생성 — 부모 테이블의 표시 컬럼들을 alias prefix 와 함께
  // 묶는다.
  //   - 단일 컬럼: `alias.col` 만 반환
  //   - 다중 컬럼: `CONCAT(alias.c1, ' ', alias.c2, ...)` — Oracle 11g+ / MySQL / MariaDB /
  //     PostgreSQL 9.1+ / HSQL 모두 호환되는 함수 형태. 과거의 `||` 연결자는 MySQL/MariaDB
  //     에서 동작하지 않아 방언 호환을 위해 CONCAT 으로 단일화한다.
  Handlebars.registerHelper("joinSqlDisplay", function (cols: any, alias: any) {
    const arr = Array.isArray(cols) ? cols : [];
    const a = String(alias);
    if (arr.length === 0) return new Handlebars.SafeString(`'${a}'`); // fallback (should not happen)
    if (arr.length === 1) return new Handlebars.SafeString(`${a}.${arr[0]}`);
    const parts: string[] = [];
    arr.forEach((c: string, i: number) => {
      if (i > 0) parts.push("' '");
      parts.push(`${a}.${c}`);
    });
    return new Handlebars.SafeString(`CONCAT(${parts.join(", ")})`);
  });
  // 방언별 컬럼 타입 문자열 (예: dataType=VARCHAR, maxLength=36, dialect=oracle → "VARCHAR2(36)")
  // 길이 의미 있는 타입(VARCHAR/CHAR/NUMBER 등) 에만 (LEN) 을 붙이고, CLOB/TEXT/DATE 등은 길이 없이 반환.
  // 네 번째 인자 scale 은 DECIMAL(P,S) 의 소수 자릿수 — 생략하면 Handlebars options 객체가 들어오므로 0 으로 본다.
  Handlebars.registerHelper("dialectType", function (rawType: any, maxLength: any, dialect: any, scale: any) {
    const scaleValue = typeof scale === "object" ? 0 : Number(scale) || 0;
    return new Handlebars.SafeString(
      dialectFullType(String(rawType ?? ""), Number(maxLength) || 0, String(dialect) as Dialect, scaleValue),
    );
  });
}

/**
 * `ScaffoldContext` 를 빌드한다. egov_add_entity 도 동일한 컨텍스트로 엔티티
 * 파일들을 렌더링하기 위해 export 한다.
 */
export function buildContext(params: ScaffoldParams): ScaffoldContext {
  const { projectName, packageName, entityName, ddl, description, projectType, stackVersion } = params;

  const parsed = parseDDL(ddl);
  const rawTableName = extractRawTableName(ddl);
  const stack = resolveStack(projectType, stackVersion);

  const parts = packageName.split(".");
  const entityModule = parts[parts.length - 1];
  const basePackage = parts.slice(0, -1).join(".");
  const packagePath = packageName.replace(/\./g, "/");
  const basePackagePath = basePackage.replace(/\./g, "/");
  const groupId = basePackage;

  const entityNameLower = entityName.charAt(0).toLowerCase() + entityName.slice(1);
  const entityNameUpper = rawTableName;

  const nonPkAttributes = parsed.attributes.filter((a) => !a.isPrimaryKey);
  const requiredStringAttributes = nonPkAttributes.filter((a) => a.javaType === "java.lang.String" && a.isNotNull);
  // 검색 dropdown 노출 컬럼:
  //   PK 제외 + java.lang.String + Y/N flag 제외 (CHAR(1)+_YN). FK 는 포함 유지 —
  //   List Mapper.xml 이 FK 컬럼을 부모 display 컬럼과 LIKE 매칭하도록 처리 중이므로
  //   사용자에게는 'Department' 이름 검색이 자연스럽게 동작한다.
  //   ※ 과거에는 `.slice(0, 2)` 로 임의 2개만 노출했었으나, 일반 String 컬럼이 많을 때
  //     사용자가 검색 의도와 다른 두 컬럼만 보게 되는 문제가 있어 제거.
  const searchableAttributes = parsed.attributes.filter(
    (a) =>
      !a.isPrimaryKey &&
      a.javaType === "java.lang.String" &&
      !a.isYnFlag,
  );

  const idPrefix = entityNameUpper + "-";

  // Compute unique Java imports needed by entity attributes.
  // java.lang.* types are auto-imported and primitives don't need imports.
  const imports = Array.from(
    new Set(
      parsed.attributes
        .map((a) => a.javaType)
        .filter((t) => t && t.includes(".") && !t.startsWith("java.lang."))
    )
  ).sort();

  const ctx: ScaffoldContext = {
    projectName,
    groupId,
    artifactId: projectName,
    description: description || `eGovFrame ${stackVersion === "5.1" ? "5.1" : "4.3"} ${entityName} Project`,
    projectType,
    stackVersion,
    isPrimaryEntity: params.isPrimaryEntity ?? true,
    entities:
      params.entities ?? [
        // 기본값: 현재 호출의 단일 엔티티. primary 여부는 호출의 isPrimaryEntity 플래그를 따른다.
        // (egov_scaffold_project 첫 호출 → true, egov_add_entity → false 명시.
        //  add_entity 가 nav fragment 를 재생성할 때는 params.entities 를 직접 넘기므로 이 경로 미사용.)
        { entityName, entityNameLower, isPrimary: params.isPrimaryEntity ?? true },
      ],

    packageName, packagePath, basePackage, basePackagePath, entityModule,
    entityName, entityNameLower, entityNameUpper,

    tableName: rawTableName,
    attributes: parsed.attributes,
    pkAttributes: parsed.pkAttributes,
    tableComment: parsed.tableComment,
    entityLabel: entityName,
    hasTableLabel: false,
    ddlParserUsed: parsed.parserUsed,
    ddlWarnings: parsed.warnings,
    nonPkAttributes,
    searchableAttributes,
    hasCompositePk: parsed.pkAttributes.length > 1,
    hasDateAttr: parsed.attributes.some((a) => a.isDate),
    requiredStringAttributes,
    hasRequiredStringAttr: requiredStringAttributes.length > 0,
    imports,
    // FK 해석은 egov_add_entity 가 discoverParentEntity 로 후속 채움.
    // egov_scaffold_project (첫 스캐폴드) 에서는 부모가 아직 없으므로 빈 배열로 시작.
    fkAttributes: parsed.attributes.filter((a) => !!a.fk),
    resolvedFks: parsed.attributes.filter((a) => !!a.fkParent),
    uniqueFkParents: dedupeByParentEntityName(parsed.attributes.filter((a) => !!a.fkParent)),
    hasFk: parsed.attributes.some((a) => !!a.fkParent),
    hasTrailingTableClauses:
      (parsed.pkAttributes.length > 1) || parsed.attributes.some((a) => !!a.fk),

    voName: entityNameLower + "VO",
    thVO: "${" + entityNameLower + "VO}",

    idPrefix,

    date: new Date().toISOString().split("T")[0],
    author: "eGovFrame",
    version: "1.0.0",

    stack,

    // egov_add_entity 의 idGeneration 옵션 (auto|manual) 이 활용하는 ctx 변수들의 기본값.
    // egov_scaffold_project 첫 호출은 항상 auto 와 동일하게 동작해야 한다 (기존 골든 호환).
    // egov_add_entity 는 호출 후 ctx 를 동적으로 override 해 manual 모드를 지원한다.
    idGenerationAuto: true,
    idGenerationManual: false,
  };
  applyLabels(ctx);
  return ctx;
}

/**
 * 메시지 번들용 라벨을 채운다. 멱등이며, `fkParent` 가 나중에 채워지는 `egov_add_entity` 는
 * FK 해석 뒤에 다시 호출해야 한다.
 *
 * - 컬럼: 코멘트 규칙 통과값 → `fkParent.entityName` → `pcName`
 * - 엔티티: 테이블 코멘트 규칙 통과값 → `entityName`
 */
export function applyLabels(ctx: ScaffoldContext): void {
  for (const col of ctx.attributes) {
    col.label = deriveLabelFromComment(col.comment) ?? col.fkParent?.entityName ?? col.pcName;
  }
  const tableLabel = deriveLabelFromComment(ctx.tableComment);
  ctx.entityLabel = tableLabel ?? ctx.entityName;
  ctx.hasTableLabel = tableLabel !== null;
}

/**
 * 파일 매니페스트는 `templates/manifests/<stack>.json` 에서 선언적으로 관리한다.
 * 라우팅은 `templates/stacks.json` 의 `stack.manifest` 한 곳이 단일 출처이며,
 * 새 파일 추가 시 매니페스트 JSON 한 줄만 추가하면 코드 수정 없이 반영된다.
 */
function getFileManifest(ctx: ScaffoldContext): ResolvedFileMapping[] {
  return resolveManifest(ctx.stack.manifest, ctx as unknown as Record<string, unknown>);
}

export async function generateScaffoldProject(params: ScaffoldParams): Promise<string> {
  registerScaffoldHelpers();

  const ctx = buildContext(params);
  if (params.withAttachment) {
    applyAttachmentContext(ctx, { attachmentFieldName: "atchFileId", maxAttachmentCount: 0 });
  }
  const templateBasePath = getScaffoldTemplatePath();
  const projectDir = path.join(params.outputPath, params.projectName);

  // 기존 프로젝트 덮어쓰기 방지 — 같은 이름의 폴더가 있고 비어 있지 않으면 어떤 파일도 쓰지 않고 거부한다.
  // (egov_add_entity 의 충돌 거부와 같은 보호. 사용자가 수정한 파일이 무경고로 사라지는 것을 막는다.)
  if (await fs.pathExists(projectDir)) {
    const entries = (await fs.readdir(projectDir)).filter((e) => e !== ".DS_Store");
    if (entries.length > 0) {
      throw retryAfterAction(
        `outputPath 아래에 '${params.projectName}' 폴더가 이미 존재하고 비어 있지 않습니다 (${entries.length}개 항목). ` +
          `기존 내용을 보호하기 위해 어떤 파일도 작성하지 않았습니다. ` +
          `다른 projectName 을 지정하거나 기존 폴더를 비운(또는 옮긴) 뒤 다시 호출하세요. ` +
          `기존 프로젝트에 기능을 추가하려면 egov_add_entity / egov_add_query_view / egov_add_attach_file_infrastructure 를 사용하세요.`,
      );
    }
  }

  await fs.ensureDir(projectDir);

  const generatedFiles: string[] = [];
  const manifest = getFileManifest(ctx);
  // Handlebars 로 렌더링된(=템플릿에서 그대로 복사되지 않은) 파일만 자체 검증 대상으로 모은다.
  const renderedManifestFiles: { relPath: string; content: string }[] = [];

  for (const mapping of manifest) {
    try {
      const templatePath = path.join(templateBasePath, mapping.template);
      const fullOutputPath = assertInsideProject(projectDir, path.join(projectDir, mapping.output));

      if (!(await fs.pathExists(templatePath))) {
        console.error(`Template not found: ${templatePath}`);
        continue;
      }

      const templateContent = await fs.readFile(templatePath, "utf-8");
      const compiled = Handlebars.compile(templateContent);
      // dialect 가 매핑에 채워져 있으면 방언별 fan-out 항목 — 템플릿이 `{{dialect}}` 분기에 사용.
      const renderCtx = mapping.dialect ? { ...ctx, dialect: mapping.dialect } : ctx;
      const rendered = compiled(renderCtx);

      await fs.ensureDir(path.dirname(fullOutputPath));
      await writeFile(fullOutputPath, rendered, "utf-8");
      generatedFiles.push(mapping.output);
      renderedManifestFiles.push({ relPath: mapping.output, content: rendered });
    } catch (error) {
      console.error(`Failed to generate ${mapping.output}:`, error);
      throw new Error(`Failed to generate ${mapping.output}: ${error}`);
    }
  }

  // 생성 결과 자체 검증 — egov_add_entity/egov_add_query_view/egov_add_attach_file_infrastructure
  // 와 달리 이 함수는 렌더링과 동시에 파일을 디스크에 쓰므로(render-then-write 분리가 침습적),
  // "쓰기 전" 이 아니라 "쓰기 후, 성공 반환 전" 검증으로 대체한다. 실패 시 이 시점까지 쓰여진
  // 파일은 롤백하지 않고, 그 사실을 에러 메시지에 명시해 호출자가 정리 방법을 알 수 있게 한다.
  const validationIssues = validateRenderedFiles(renderedManifestFiles);
  if (validationIssues.length > 0) {
    throw nonRetryable(
      `생성 결과 자체 검증 실패 — 생성기 내부 문제일 수 있습니다.\n${validationIssues.map((v) => `  - ${v}`).join("\n")}\n\n` +
        `⚠️  egov_scaffold_project 는 파일을 렌더링과 동시에 디스크에 쓰므로, 이 실패 시점까지 이미 일부 파일이 ` +
        `'${projectDir}' 에 작성된 상태입니다 (롤백되지 않음). 해당 디렉터리를 직접 정리한 뒤 다시 시도하세요.`,
    );
  }

  // Static assets copy — 디렉터리명은 호환성 매트릭스의 stack.staticAssets 에서 가져온다.
  // (세 스택 모두 KRDS 자산 static50 을 쓴다. 화면 템플릿이 이 자산 경로를 참조한다.)
  const staticDirName = ctx.stack.staticAssets;
  const staticSrcDir = path.join(templateBasePath, staticDirName);
  if (await fs.pathExists(staticSrcDir)) {
    if (ctx.projectType === "war") {
      // WAR: static assets go under src/main/webapp/
      const staticDestDir = path.join(projectDir, "src/main/webapp");
      await fs.copy(staticSrcDir, staticDestDir, { filter: osJunkCopyFilter });
      generatedFiles.push("src/main/webapp/ (CSS, JS, images)");
    } else {
      // Boot: static assets go under src/main/resources/static/
      const staticDestDir = path.join(projectDir, "src/main/resources/static");
      await fs.copy(staticSrcDir, staticDestDir, { filter: osJunkCopyFilter });
      generatedFiles.push("src/main/resources/static/ (CSS, JS, images)");
    }
  }

  // WAR-specific static files (validator-rules.xml, MANIFEST.MF)
  if (ctx.projectType === "war") {
    const warStaticDir = path.join(templateBasePath, "war", "static-files");
    if (await fs.pathExists(warStaticDir)) {
      const validatorRulesSrc = path.join(warStaticDir, "validator-rules.xml");
      if (await fs.pathExists(validatorRulesSrc)) {
        const validatorRulesDest = path.join(projectDir, "src/main/webapp/WEB-INF/config/egovframework/validator/validator-rules.xml");
        await fs.ensureDir(path.dirname(validatorRulesDest));
        await fs.copy(validatorRulesSrc, validatorRulesDest, { filter: osJunkCopyFilter });
        generatedFiles.push("src/main/webapp/WEB-INF/config/egovframework/validator/validator-rules.xml");
      }
      const manifestSrc = path.join(warStaticDir, "MANIFEST.MF");
      if (await fs.pathExists(manifestSrc)) {
        const manifestDest = path.join(projectDir, "src/main/webapp/META-INF/MANIFEST.MF");
        await fs.ensureDir(path.dirname(manifestDest));
        await fs.copy(manifestSrc, manifestDest, { filter: osJunkCopyFilter });
        generatedFiles.push("src/main/webapp/META-INF/MANIFEST.MF");
      }
    }
  }

  // 프레임워크 라벨도 매트릭스에서 가져온다. 버전 업그레이드 시 stacks.json 만 갱신하면 된다.
  const frameworkVersion = ctx.stack.frameworkLabel;

  return JSON.stringify({
    success: true,
    projectDir,
    projectType: ctx.projectType,
    stackVersion: ctx.stackVersion,
    frameworkVersion,
    entityName: ctx.entityName,
    tableName: ctx.tableName,
    ddlParserUsed: ctx.ddlParserUsed,
    ddlWarnings: ctx.ddlWarnings,
    fileCount: generatedFiles.length,
    files: generatedFiles,
    selfValidatedFileCount: renderedManifestFiles.length,
  }, null, 2);
}
