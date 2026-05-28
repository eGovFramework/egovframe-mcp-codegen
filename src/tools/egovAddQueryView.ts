/**
 * Tool: egov_add_query_view
 *
 * 이미 생성된 eGovFrame 프로젝트에 다중 테이블 JOIN/컬럼 프로젝션 기반 read-only
 * 조회 화면(리포트성 View) 을 추가한다. CRUD 와 달리 등록/수정/삭제 산출물은
 * 만들지 않으며, List 화면 + 페이징 + 검색만 갖춘다.
 *
 * 설계 결정
 * ----------
 * - **입력 형식**: 하이브리드 — 사용자가 raw SELECT SQL 을 작성하고, 도구는 컬럼
 *   메타데이터(alias, label, type, format) 만 별도로 받아 화면 렌더링에 사용한다.
 *   도구가 SQL 을 파싱할 필요가 없어 자유도와 명시성 양쪽을 모두 챙긴다.
 * - **SQL wrapping**: 사용자의 SQL 을 derived table 로 감싸 페이징/검색을 외부에서
 *   안전하게 적용한다. defaultOrderBy 는 출력 컬럼 alias 기준으로 작성한다 (내부 테이블
 *   alias `s.`, `o.` 등이 아님).
 * - **메뉴 통합**: autoApplyMenu 기본 true. 일반 entity 와 동일한 nav fragment 에
 *   포함되어 사용자가 따로 손대지 않아도 메뉴에 나타난다.
 * - **충돌 정책**: 일반 entity 와 동일 — 기존 산출물 중 하나라도 있으면 전체 거부.
 */

import path from "node:path";
import fs from "fs-extra";
import { writeFile } from "node:fs/promises";
import Handlebars from "handlebars";
import { z } from "zod";

import {
  getScaffoldTemplatePath,
  registerScaffoldHelpers,
} from "../utils/scaffold/scaffoldGenerator.js";
import { detectProjectStack } from "../utils/scaffold/projectDetector.js";
import { resolveStack } from "../utils/scaffold/stackMatrix.js";

/** 컬럼 타입 — Java 필드 타입과 화면 렌더링 분기에 모두 사용된다. */
const COLUMN_TYPES = ["String", "Date", "Timestamp", "Number", "Boolean"] as const;
type QueryColumnType = (typeof COLUMN_TYPES)[number];

const ColumnSpecSchema = z.object({
  /** SELECT alias — VO 필드명이자 검색·정렬·결과 접근 key */
  alias: z
    .string()
    .min(1, "columns[].alias 가 필요합니다.")
    .regex(
      /^[a-z][a-zA-Z0-9]*$/,
      "columns[].alias 는 camelCase 영문/숫자만 허용합니다 (예: 'studentName').",
    ),
  /** 컬럼 헤더에 노출될 라벨 (예: '학생', 'Student Name') */
  label: z.string().min(1, "columns[].label 이 필요합니다."),
  /** Java 필드 타입 */
  type: z.enum(COLUMN_TYPES).optional().default("String"),
  /** Date/Timestamp/Number 화면 포맷 (예: 'yyyy-MM-dd', '#,##0.00') */
  format: z.string().optional(),
});

export const AddQueryViewInputSchema = z.object({
  projectPath: z.string().min(1, "projectPath 가 필요합니다."),
  packageName: z
    .string()
    .min(1)
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/,
      "packageName 은 Java 패키지 규약을 따라야 합니다 (예: 'egovframework.example.academic.report').",
    ),
  viewName: z
    .string()
    .min(1)
    .regex(
      /^[A-Z][a-zA-Z0-9]*$/,
      "viewName 은 PascalCase 여야 합니다 (예: 'StudentEnrollmentReport').",
    ),
  /** SELECT 본문. LIMIT/OFFSET/외부 WHERE 검색절은 도구가 wrapping 으로 추가하므로 포함하지 말 것. */
  sql: z
    .string()
    .min(1)
    .refine(
      (s) => /^\s*SELECT\b/i.test(s),
      "sql 은 SELECT 문이어야 합니다.",
    ),
  columns: z.array(ColumnSpecSchema).min(1, "columns 는 최소 1개 필요합니다."),
  /** 검색 dropdown 에 노출될 컬럼 alias 들. 빈 배열이면 검색 UI 자체를 숨긴다. */
  searchable: z.array(z.string()).optional().default([]),
  /** 출력 컬럼 alias 기준의 ORDER BY 절. 기본 첫 컬럼 DESC. */
  defaultOrderBy: z.string().optional(),
  description: z.string().optional().default(""),
  autoApplyMenu: z.boolean().optional().default(true),
  autoApplyMessages: z.boolean().optional().default(true),
});

export type AddQueryViewInput = z.infer<typeof AddQueryViewInputSchema>;

function formatZodError(err: z.ZodError): string {
  const lines = err.issues.map((i) => {
    const p = i.path.length ? `${i.path.join(".")}: ` : "";
    return `  - ${p}${i.message}`;
  });
  return `입력 검증 실패:\n${lines.join("\n")}`;
}

const JAVA_TYPE_BY_COLUMN_TYPE: Record<QueryColumnType, string> = {
  String: "java.lang.String",
  Date: "java.sql.Date",
  Timestamp: "java.sql.Timestamp",
  Number: "java.math.BigDecimal",
  Boolean: "java.lang.Boolean",
};

const DEFAULT_FORMAT_BY_COLUMN_TYPE: Partial<Record<QueryColumnType, string>> = {
  Date: "yyyy-MM-dd",
  Timestamp: "yyyy-MM-dd HH:mm:ss",
};

/**
 * 결과를 도구 호출자에게 보고할 데이터 구조 — 본문 메시지를 만들기 위한 중간 표현.
 */
interface RenderResult {
  written: string[];
  menuAttachedTo?: string;
  appendedMessageFiles: string[];
}

export async function egovAddQueryView(rawParams: unknown): Promise<string> {
  const parsed = AddQueryViewInputSchema.safeParse(rawParams);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }
  const params = parsed.data;

  // 1) 스택 감지
  const projectDir = path.resolve(params.projectPath);
  const detected = detectProjectStack(projectDir);

  // 단계 1: boot50 만 지원 — 그 외 스택은 명확한 에러로 거부
  if (!(detected.projectType === "boot" && detected.stackVersion === "5.0")) {
    throw new Error(
      `egov_add_query_view 는 현재 eGovFrame 5.0 Boot 프로젝트만 지원합니다 ` +
        `(감지된 스택: ${detected.reason}). 다른 스택 지원은 향후 작업으로 계획되어 있습니다.`,
    );
  }

  // 2) Context 빌드 — 일반 ScaffoldContext 와 별개로, query view 전용 데이터 구성
  const stack = resolveStack(detected.projectType, detected.stackVersion);
  const parts = params.packageName.split(".");
  const entityModule = parts[parts.length - 1];
  const basePackage = parts.slice(0, -1).join(".");
  const basePackagePath = basePackage.replace(/\./g, "/");
  const packagePath = params.packageName.replace(/\./g, "/");

  const viewName = params.viewName;
  const viewNameLower = viewName.charAt(0).toLowerCase() + viewName.slice(1);

  // 컬럼 메타 보강 — Java 타입, 기본 포맷, isDate/isTimestamp 등 템플릿 분기용 플래그
  const columns = params.columns.map((c) => {
    const t: QueryColumnType = c.type ?? "String";
    return {
      alias: c.alias,
      pcName: c.alias.charAt(0).toUpperCase() + c.alias.slice(1),
      label: c.label,
      type: t,
      javaType: JAVA_TYPE_BY_COLUMN_TYPE[t],
      simpleJavaType: JAVA_TYPE_BY_COLUMN_TYPE[t].split(".").pop()!,
      isString: t === "String",
      isDate: t === "Date",
      isTimestamp: t === "Timestamp",
      isNumber: t === "Number",
      isBoolean: t === "Boolean",
      format: c.format ?? DEFAULT_FORMAT_BY_COLUMN_TYPE[t] ?? null,
    };
  });

  // 검색 가능 컬럼 — searchable alias 들과 columns 의 교집합
  const searchable = columns.filter((c) =>
    params.searchable.includes(c.alias),
  );

  // 기본 정렬 — 미지정 시 첫 컬럼 DESC
  const defaultOrderBy = params.defaultOrderBy?.trim()
    ? params.defaultOrderBy.trim()
    : `${columns[0].alias} DESC`;

  // Java 타입의 unique import 목록 (java.lang.* 제외)
  const imports = Array.from(
    new Set(
      columns
        .map((c) => c.javaType)
        .filter((t) => t.includes(".") && !t.startsWith("java.lang.")),
    ),
  ).sort();

  const ctx = {
    projectName: path.basename(projectDir),
    packageName: params.packageName,
    packagePath,
    basePackage,
    basePackagePath,
    entityModule,
    viewName,
    viewNameLower,
    viewVoName: `${viewNameLower}VO`,
    description: params.description,
    sql: params.sql.trim(),
    columns,
    searchable,
    hasSearchable: searchable.length > 0,
    defaultOrderBy,
    imports,
    hasDateAttr: columns.some((c) => c.isDate || c.isTimestamp),
    stack,
  };

  // 3) 매니페스트 — 단계 1 boot50 만 지원. 향후 stack matrix 로 분리.
  const templateBase = getScaffoldTemplatePath();
  const targets: { template: string; output: string }[] = [
    {
      template: "boot50/java/queryView/QueryViewDefaultVO.hbs",
      output: `src/main/java/${packagePath}/${viewName}DefaultVO.java`,
    },
    {
      template: "boot50/java/queryView/QueryViewVO.hbs",
      output: `src/main/java/${packagePath}/${viewName}VO.java`,
    },
    {
      template: "boot50/java/queryView/QueryViewMapper.hbs",
      output: `src/main/java/${packagePath}/impl/${viewName}Mapper.java`,
    },
    {
      template: "boot50/java/queryView/EgovQueryViewService.hbs",
      output: `src/main/java/${packagePath}/Egov${viewName}Service.java`,
    },
    {
      template: "boot50/java/queryView/EgovQueryViewServiceImpl.hbs",
      output: `src/main/java/${packagePath}/impl/Egov${viewName}ServiceImpl.java`,
    },
    {
      template: "boot50/java/queryView/EgovQueryViewController.hbs",
      output: `src/main/java/${basePackagePath}/${entityModule}/web/Egov${viewName}Controller.java`,
    },
    {
      template: "boot50/resources/queryView-sql.xml.hbs",
      output: `src/main/resources/egovframework/sqlmap/${entityModule}/mappers/Egov${viewName}_${viewName}_SQL.xml`,
    },
    {
      template: "boot50/thymeleaf/queryViewList.html.hbs",
      output: `src/main/resources/templates/thymeleaf/${entityModule}/egov${viewName}List.html`,
    },
  ];

  // 4) 사전 충돌 검사 — 하나라도 있으면 전체 거부
  registerScaffoldHelpers();
  const conflicts: string[] = [];
  for (const t of targets) {
    const abs = path.join(projectDir, t.output);
    if (await fs.pathExists(abs)) conflicts.push(t.output);
  }
  if (conflicts.length > 0) {
    throw new Error(
      `Query view '${viewName}' 추가가 충돌로 거부되었습니다. ` +
        `다음 파일이 이미 존재합니다 (${conflicts.length}개):\n` +
        conflicts.map((f) => `  - ${f}`).join("\n") +
        `\n\n기존 파일을 보존하기 위해 어떤 파일도 작성되지 않았습니다.`,
    );
  }

  // 5) 렌더링 + 쓰기
  const result: RenderResult = { written: [], appendedMessageFiles: [] };
  for (const t of targets) {
    const templateAbs = path.join(templateBase, t.template);
    if (!(await fs.pathExists(templateAbs))) {
      throw new Error(`템플릿을 찾을 수 없습니다: ${templateAbs}`);
    }
    const tmpl = await fs.readFile(templateAbs, "utf-8");
    const rendered = Handlebars.compile(tmpl)(ctx);
    const out = path.join(projectDir, t.output);
    await fs.ensureDir(path.dirname(out));
    await writeFile(out, rendered, "utf-8");
    result.written.push(t.output);
  }

  // 6) 메뉴 자동 통합 — nav fragment 재생성 (autoApplyMenu)
  if (params.autoApplyMenu) {
    try {
      result.menuAttachedTo = await regenerateNavWithQueryView(projectDir, {
        viewName,
        viewNameLower,
      });
    } catch (e) {
      // 메뉴 갱신 실패는 치명적이지 않음 — 본문은 이미 생성됨
      console.error("[egov_add_query_view] menu update skipped:", e);
    }
  }

  // 7) 메시지 키 자동 추가 (autoApplyMessages) — list.{viewLower}, title.{viewLower}.{alias}, nav.{viewLower}
  if (params.autoApplyMessages) {
    const messageKeys = buildMessageKeys(ctx);
    const msgDir = path.join(
      projectDir,
      "src/main/resources/egovframework/message",
    );
    const targetFiles = [
      "message-common.properties",
      "message-common_ko.properties",
      "message-common_en.properties",
    ];
    const allExist = (
      await Promise.all(
        targetFiles.map((f) => fs.pathExists(path.join(msgDir, f))),
      )
    ).every(Boolean);
    if (allExist) {
      for (const f of targetFiles) {
        const abs = path.join(msgDir, f);
        await fs.appendFile(abs, "\n" + messageKeys);
        result.appendedMessageFiles.push(path.relative(projectDir, abs));
      }
    }
  }

  // 8) 결과 메시지
  const lines = [
    `✅ Query view '${viewName}' 추가 완료!`,
    ``,
    `📁 프로젝트: ${projectDir}`,
    `📦 패키지: ${params.packageName}`,
    `🔎 컬럼 ${columns.length}개: ${columns.map((c) => c.alias).join(", ")}`,
    searchable.length > 0
      ? `🔍 검색 가능 컬럼: ${searchable.map((s) => s.alias).join(", ")}`
      : `🔍 검색 비활성 (searchable 비어 있음)`,
    ``,
    `생성된 파일:`,
    ...result.written.map((f) => `  - ${f}`),
  ];
  if (result.menuAttachedTo) {
    lines.push(
      ``,
      `✅ 메뉴 자동 갱신 — ${result.menuAttachedTo} 에 추가됨`,
    );
  }
  if (result.appendedMessageFiles.length > 0) {
    lines.push(
      ``,
      `✅ 메시지 번들 자동 적용 (${result.appendedMessageFiles.length}개 파일):`,
      ...result.appendedMessageFiles.map((f) => `  - ${f}`),
    );
  }

  return lines.join("\n");
}

/**
 * Nav fragment 를 재생성해 새 query view 를 포함시킨다.
 * 기존 nav fragment 가 없으면 (graceful degrade), 단순 스킵.
 */
async function regenerateNavWithQueryView(
  projectDir: string,
  newView: { viewName: string; viewNameLower: string },
): Promise<string | undefined> {
  // 기존 entity discovery 와 동일한 방식으로 Egov*Controller.java 들을 스캔.
  // 발견된 모든 controller (CRUD 와 query view 모두) 를 nav 에 포함시킨다.
  const { discoverEntities } = await import(
    "../utils/scaffold/entityDiscovery.js"
  );
  const existing = await discoverEntities(projectDir);
  // 새 view 도 포함 (중복은 자동 제거됨)
  const merged = new Map<string, { entityName: string; entityNameLower: string; isPrimary: boolean }>();
  for (const e of existing) merged.set(e.entityName, e);
  if (!merged.has(newView.viewName)) {
    merged.set(newView.viewName, {
      entityName: newView.viewName,
      entityNameLower: newView.viewNameLower,
      isPrimary: false,
    });
  }
  const entities = Array.from(merged.values()).sort((a, b) =>
    a.entityName.localeCompare(b.entityName),
  );

  // nav.html fragment 가 있어야만 갱신
  const fragmentRel =
    "src/main/resources/templates/thymeleaf/_fragments/nav.html";
  const fragmentAbs = path.join(projectDir, fragmentRel);
  if (!(await fs.pathExists(fragmentAbs))) return undefined;

  // 기존과 동일한 template (boot50 nav.html.hbs) 으로 다시 렌더
  const templateBase = getScaffoldTemplatePath();
  const navTemplateAbs = path.join(
    templateBase,
    "boot50/thymeleaf/_fragments/nav.html.hbs",
  );
  const navTmpl = await fs.readFile(navTemplateAbs, "utf-8");
  const rendered = Handlebars.compile(navTmpl)({ entities });
  await writeFile(fragmentAbs, rendered, "utf-8");
  return fragmentRel;
}

/**
 * Query view 의 메시지 키들을 properties 라인 문자열로 만든다.
 * autoApplyMessages 가 활성일 때 모든 lang properties 파일 끝에 append 된다.
 */
function buildMessageKeys(ctx: {
  viewNameLower: string;
  viewName: string;
  columns: { alias: string; label: string }[];
}): string {
  const lines = [
    `# === query view '${ctx.viewName}' keys (egov_add_query_view 가 append) ===`,
    `list.${ctx.viewNameLower}=${ctx.viewName}`,
    `title.${ctx.viewNameLower}.sample=${ctx.viewName}`,
    `nav.${ctx.viewNameLower}=${ctx.viewName}`,
    ...ctx.columns.map(
      (c) => `title.${ctx.viewNameLower}.${c.alias}=${c.label}`,
    ),
  ];
  return lines.join("\n") + "\n";
}
