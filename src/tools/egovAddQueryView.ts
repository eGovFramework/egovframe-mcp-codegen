/**
 * Tool: egov_add_query_view
 *
 * 이미 생성된 eGovFrame 프로젝트(Boot 5.1 / Boot 4.3 / WAR 4.3)에 다중 테이블
 * JOIN/컬럼 프로젝션 기반 read-only 조회 화면(리포트성 View) 을 추가한다. CRUD 와
 * 달리 등록/수정/삭제 산출물은 만들지 않으며, List 화면 + 페이징 + 검색만 갖춘다.
 * 산출물 목록(템플릿 → 출력 경로)은 스택별로 templates/stacks.json 의 `queryView` 에 정의된다.
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
 * - **충돌 정책**: 일반 entity 와 동일 — 렌더 결과를 기존 산출물과 내용까지 비교한다.
 *   전부 존재 + 내용 동일이면 아무 것도 쓰지 않고 "변경 없음" 성공(멱등), 일부만 존재하거나
 *   내용이 다르면 원자적으로 전체 거부(어떤 파일도 쓰지 않음).
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
import { detectBasePackage, detectProjectStack, usesApacheMapperScan } from "../utils/scaffold/projectDetector.js";
import { assertInsideProject } from "../utils/scaffold/pathGuard.js";
import { FileWriteJournal, withWriteRollback } from "../utils/scaffold/writeRollback.js";
import { resolveStack, type StackEntry } from "../utils/scaffold/stackMatrix.js";
import { completionFooter, nonRetryable, retryAfterAction } from "../utils/scaffold/toolMessages.js";
import { validateRenderedFiles } from "../utils/scaffold/outputValidator.js";
import { escapeNonAscii } from "../utils/scaffold/messageLabel.js";

/** 컬럼 타입 — Java 필드 타입과 화면 렌더링 분기에 모두 사용된다. */
const COLUMN_TYPES = ["String", "Date", "Timestamp", "Number", "Boolean"] as const;
type QueryColumnType = (typeof COLUMN_TYPES)[number];

/** Date/Timestamp format 허용 문자 — 문자·숫자·공백과 일부 구분자만 (표현식/EL 주입 차단). */
const DATE_FORMAT_PATTERN = /^[\p{L}\p{N} \-/.:,]+$/u;

const ColumnSpecSchema = z.object({
  /** SELECT alias — VO 필드명이자 검색·정렬·결과 접근 key */
  alias: z
    .string()
    .min(1, { error: "columns[].alias 가 필요합니다." })
    .regex(/^[a-z][a-zA-Z0-9]*$/, {
      error:
        "columns[].alias 는 camelCase 영문/숫자만 허용합니다 (예: 'studentName').",
    }),
  /** 컬럼 헤더에 노출될 라벨 (예: '학생', 'Student Name') */
  label: z.string().min(1, { error: "columns[].label 이 필요합니다." }),
  /** Java 필드 타입 */
  type: z.enum(COLUMN_TYPES).optional().default("String"),
  /** Date/Timestamp/Number 화면 포맷 (예: 'yyyy-MM-dd', '#,##0.00') */
  format: z.string().optional(),
});

export const AddQueryViewInputSchema = z
  .object({
    projectPath: z.string().min(1, { error: "projectPath 가 필요합니다." }),
    packageName: z
      .string()
      .min(1)
      .regex(/^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/, {
        error:
          "packageName 은 Java 패키지 규약을 따라야 합니다 (예: 'egovframework.example.academic.report').",
      }),
    viewName: z
      .string()
      .min(1)
      .regex(/^[A-Z][a-zA-Z0-9]*$/, {
        error: "viewName 은 PascalCase 여야 합니다 (예: 'StudentEnrollmentReport').",
      }),
    /** SELECT 본문. LIMIT/OFFSET/외부 WHERE 검색절은 도구가 wrapping 으로 추가하므로 포함하지 말 것. */
    sql: z
      .string()
      .min(1)
      .refine((s) => /^\s*SELECT\b/i.test(s), {
        error: "sql 은 SELECT 문이어야 합니다.",
      }),
    columns: z
      .array(ColumnSpecSchema)
      .min(1, { error: "columns 는 최소 1개 필요합니다." }),
    /** 검색 dropdown 에 노출될 컬럼 alias 들. 빈 배열이면 검색 UI 자체를 숨긴다. */
    searchable: z.array(z.string()).optional().default([]),
    /** 출력 컬럼 alias 기준의 ORDER BY 절. 기본 첫 컬럼 DESC. */
    defaultOrderBy: z.string().optional(),
    description: z.string().optional().default(""),
    autoApplyMenu: z.boolean().optional().default(true),
    autoApplyMessages: z.boolean().optional().default(true),
  })
  .superRefine((val, ctx) => {
    // sql 은 mapper XML 의 CDATA 섹션에 렌더되므로 CDATA 종료 시퀀스는 산출물을 깨뜨린다.
    if (val.sql.includes("]]>")) {
      ctx.addIssue({
        code: "custom",
        path: ["sql"],
        message: "sql 에 ']]>' 시퀀스를 포함할 수 없습니다 (mapper XML 의 CDATA 섹션을 종료시킴).",
      });
    }

    const aliases = new Set(val.columns.map((c) => c.alias));

    // Number format 은 화면의 #numbers.formatDecimal 인자로 변환되므로 변환 가능한 형식만 허용한다.
    val.columns.forEach((c, i) => {
      if (c.type === "Number" && c.format !== undefined && !parseNumberFormat(c.format)) {
        ctx.addIssue({
          code: "custom",
          path: ["columns", i, "format"],
          message: `columns[${i}].format '${c.format}' 은 지원하지 않는 Number 형식입니다. '#,##0.00', '#,##0', '0.00' 처럼 0, #, 콤마, 소수점만 사용하세요.`,
        });
      }
    });

    // label 은 메시지 번들(properties)의 값으로 기록되므로, 줄을 나누거나 이스케이프로 해석되어
    // 번들을 깨뜨릴 수 있는 제어문자와 백슬래시를 차단한다.
    val.columns.forEach((c, i) => {
      if (/[\u0000-\u001f\u007f\u2028\u2029\\]/.test(c.label)) {
        ctx.addIssue({
          code: "custom",
          path: ["columns", i, "label"],
          message: `columns[${i}].label 에는 줄바꿈 등 제어문자와 백슬래시(\\)를 사용할 수 없습니다.`,
        });
      }
    });

    // Date/Timestamp format 은 화면 템플릿의 표현식(Thymeleaf #dates.format 인자, JSP fmt:formatDate 의
    // pattern 속성) 안에 그대로 들어가므로, 표현식을 깨뜨리거나 EL 로 평가될 수 있는 문자($, {, }, 따옴표 등)를 차단한다.
    val.columns.forEach((c, i) => {
      if (
        (c.type === "Date" || c.type === "Timestamp") &&
        c.format !== undefined &&
        !DATE_FORMAT_PATTERN.test(c.format)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["columns", i, "format"],
          message: `columns[${i}].format '${c.format}' 은 지원하지 않는 날짜 형식입니다. 'yyyy-MM-dd', 'yyyy/MM/dd HH:mm' 처럼 문자, 숫자, 공백과 - / . : , 만 사용하세요.`,
        });
      }
    });

    // searchable 은 columns 에 선언된 alias 만 허용 — 오타를 조용히 무시하지 않는다.
    for (const s of val.searchable) {
      if (!aliases.has(s)) {
        ctx.addIssue({
          code: "custom",
          path: ["searchable"],
          message: `searchable 의 '${s}' 는 columns 에 선언되지 않은 alias 입니다 (선언된 alias: ${[...aliases].join(", ")}).`,
        });
      }
    }

    // defaultOrderBy 는 'alias [ASC|DESC]' 콤마 나열만 허용 — 생성된 SQL 로 임의 식이 흘러가는 것을 차단.
    if (val.defaultOrderBy?.trim()) {
      for (const part of val.defaultOrderBy.split(",").map((p) => p.trim())) {
        const m = /^([a-z][a-zA-Z0-9]*)(\s+(?:ASC|DESC|asc|desc))?$/.exec(part);
        if (!m) {
          ctx.addIssue({
            code: "custom",
            path: ["defaultOrderBy"],
            message: `defaultOrderBy 의 '${part}' 가 올바르지 않습니다. 'alias [ASC|DESC]' 를 콤마로 나열하세요 (예: 'studentName DESC, deptName').`,
          });
        } else if (!aliases.has(m[1])) {
          ctx.addIssue({
            code: "custom",
            path: ["defaultOrderBy"],
            message: `defaultOrderBy 의 '${m[1]}' 는 columns 에 선언되지 않은 alias 입니다.`,
          });
        }
      }
    }
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

/**
 * Number 컬럼 format(예: '#,##0.00')을 Thymeleaf `#numbers.formatDecimal` 인자로 바꾼다.
 * 0·#·콤마·소수점만 허용하며, 콤마가 있으면 천 단위 구분, 소수점 뒤 글자 수가 소수 자릿수다
 * (소수 자릿수는 고정 표시). 지원하지 않는 형식이면 null.
 */
export function parseNumberFormat(
  format: string,
): { grouping: "COMMA" | "NONE"; decimals: number } | null {
  const m = /^([#0][#0,]*)(?:\.([#0]+))?$/.exec(format.trim());
  if (!m) return null;
  return { grouping: m[1].includes(",") ? "COMMA" : "NONE", decimals: m[2]?.length ?? 0 };
}

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
    throw nonRetryable(formatZodError(parsed.error));
  }
  const params = parsed.data;

  // 1) 스택 감지
  const projectDir = path.resolve(params.projectPath);
  const detected = detectProjectStack(projectDir);

  // 스택 매트릭스에 query view 정의(queryView)가 없는 스택은 명확한 에러로 거부
  const stack = resolveStack(detected.projectType, detected.stackVersion);
  if (!stack.queryView || stack.queryView.length === 0) {
    throw nonRetryable(
      `egov_add_query_view 는 이 스택(${stack.frameworkLabel}) 을 지원하지 않습니다 ` +
        `(감지된 스택: ${detected.reason}).`,
    );
  }
  const queryViewSpecs = stack.queryView;

  // 2) Context 빌드 — 일반 ScaffoldContext 와 별개로, query view 전용 데이터 구성
  const parts = params.packageName.split(".");
  const entityModule = parts[parts.length - 1];
  let basePackage = parts.slice(0, -1).join(".");
  const packagePath = params.packageName.replace(/\./g, "/");

  // basePackage 자동 보정 — egov_add_entity 와 같은 규칙.
  //   WAR 의 뷰 리졸버 prefix 는 첫 스캐폴드의 basePackage 로 고정되어 있는데(/WEB-INF/jsp/<base>/),
  //   깊은 packageName(예: <base>.w43.report)으로 호출하면 여기서 추출한 basePackage 가 어긋나
  //   JSP 는 <base>/w43/report/ 에 생기고 컨트롤러는 "report/…" 를 돌려줘 404 가 났다.
  //   기존 프로젝트의 공유 클래스(FkComboVO) 위치를 단일 진실원본으로 삼아 맞춘다.
  const detectedBasePackage = detectBasePackage(projectDir);
  let basePackageRebased: { from: string; to: string } | undefined;
  if (detectedBasePackage && detectedBasePackage !== basePackage) {
    basePackageRebased = { from: basePackage, to: detectedBasePackage };
    basePackage = detectedBasePackage;
  }
  const basePackagePath = basePackage.replace(/\./g, "/");

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
      format: c.format?.trim() ?? DEFAULT_FORMAT_BY_COLUMN_TYPE[t] ?? null,
      // Number format → #numbers.formatDecimal(값, 1, 천단위구분, 소수자릿수, 'POINT')
      ...(() => {
        const spec = t === "Number" && c.format ? parseNumberFormat(c.format) : null;
        return { numberGrouping: spec?.grouping ?? "NONE", numberDecimals: spec?.decimals ?? 0 };
      })(),
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
    // Boot 4.3 Mapper 어노테이션 선택용 — 프로젝트의 EgovConfigMapper 스캔 방식을 따른다.
    useApacheMapper: usesApacheMapperScan(projectDir),
  };

  // 3) 산출물 목록 — 스택 매트릭스(stacks.json 의 queryView)에서 읽고, 출력 경로는 Handlebars 로 렌더링.
  const templateBase = getScaffoldTemplatePath();
  const targets = queryViewSpecs.map((spec) => ({
    template: spec.template,
    output: Handlebars.compile(spec.output, { noEscape: true })(ctx),
  }));

  // 4) 렌더링(메모리) — 파일을 쓰기 전에 기존 산출물과 내용을 비교해 멱등 여부를 판단한다.
  //    (add_entity 와 동일 패턴: 렌더와 쓰기를 분리해 "존재 여부" 가 아니라 "내용까지 동일한지"
  //    로 충돌을 판정한다.)
  registerScaffoldHelpers();
  const renderedFiles: { output: string; content: string }[] = [];
  for (const t of targets) {
    const templateAbs = path.join(templateBase, t.template);
    if (!(await fs.pathExists(templateAbs))) {
      throw new Error(`템플릿을 찾을 수 없습니다: ${t.template}`);
    }
    const tmpl = await fs.readFile(templateAbs, "utf-8");
    const content = Handlebars.compile(tmpl)(ctx);
    renderedFiles.push({ output: t.output, content });
  }

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

  // 4-a) 완전 멱등 — 대상 파일이 전부 존재하고 내용까지 렌더 결과와 정확히 동일하면
  //   아무 파일도 쓰지 않고 "변경 없음" 성공으로 종료한다. autoApplyMenu/autoApplyMessages
  //   후속 단계도 실행하지 않는다 — 이미 이전 호출에서 반영되었을 것이므로 nav fragment/메시지
  //   번들에 중복 적용될 위험을 피한다.
  if (
    renderedFiles.length > 0 &&
    existingStatuses.length === fileStatuses.length &&
    existingStatuses.every((s) => s.status === "identical")
  ) {
    // 4-a-메타) columns[].label 등은 렌더 대상 산출물 어디에도 나타나지 않고 오직
    //   메시지 번들 append 블록(buildMessageKeys)에만 반영된다. 산출물이 전부 동일하다는
    //   이유만으로 "변경 없음" 을 반환하면, label 만 바뀐 재호출이 조용히 무시되는 silent
    //   no-op 이 된다. 메시지 번들에 이미 반영된 이전 블록과 새로 계산한 블록을 비교해
    //   다르면(=메타 변경이 있으면) 산출물 동일 여부와 무관하게 충돌로 거부한다.
    const messageConflicts = await findMessageBlockConflicts(projectDir, viewName, ctx);
    if (messageConflicts.length > 0) {
      throw retryAfterAction(
        `Query view '${viewName}' 추가가 충돌로 거부되었습니다. ` +
          `산출물 파일(VO/Mapper/Service/Controller/XML/화면) ${fileStatuses.length}개는 기존 내용과 동일하지만, ` +
          `columns 메타(label 등 — 렌더 대상 파일에는 나타나지 않고 메시지 번들 append 블록에만 반영되는 값)가 ` +
          `이전 호출과 다릅니다.\n` +
          `충돌이 감지된 메시지 번들 파일 (${messageConflicts.length}개):\n${messageConflicts.map((f) => `  - ${f}`).join("\n")}\n\n` +
          `기존 파일을 보존하기 위해 어떤 파일도 작성되지 않았습니다. ` +
          `다른 viewName 으로 호출하거나, 메시지 번들의 기존 title.${viewNameLower}.* 키를 직접 정리한 뒤 다시 시도하세요.`,
      );
    }

    return (
      `ℹ️ Query view '${viewName}' 은(는) 이미 동일한 내용으로 생성되어 있습니다. 변경 사항 없음.\n\n` +
      `📁 프로젝트: ${projectDir}\n` +
      `📦 패키지: ${params.packageName}\n` +
      `📄 대상 파일 수: ${fileStatuses.length} (모두 기존 내용과 동일)\n\n` +
      `대상 파일:\n${fileStatuses.map((s) => `  - ${s.output}`).join("\n")}\n\n` +
      `⏭️  autoApplyMenu / autoApplyMessages 후속 단계는 건너뛰었습니다 ` +
      `(이미 이전 호출에서 반영되었을 것으로 간주해 중복 적용을 방지합니다).` +
      completionFooter()
    );
  }

  // 4-b) 부분 충돌 — 하나라도 존재하면(내용 동일/상이 무관) 원자적으로 거부하고
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
      `Query view '${viewName}' 추가가 충돌로 거부되었습니다. ` +
        `다음 파일이 이미 존재합니다 (${existingStatuses.length}개):\n` +
        sections.join("\n") +
        `\n\n기존 파일을 보존하기 위해 어떤 파일도 작성되지 않았습니다. ` +
        `다른 viewName 으로 호출하거나, 충돌 파일을 직접 정리한 뒤 다시 시도하세요.`,
    );
  }

  // 4-c) 생성 결과 자체 검증 — 디스크에 쓰기 전에 Handlebars 잔존 토큰 / XML 태그 균형을
  //   점검한다. 실패하면 어떤 파일도 쓰지 않고 nonRetryable 로 거부한다.
  const validationIssues = validateRenderedFiles(
    renderedFiles.map((r) => ({ relPath: r.output, content: r.content })),
  );
  if (validationIssues.length > 0) {
    throw nonRetryable(
      `생성 결과 자체 검증 실패 — 생성기 내부 문제일 수 있습니다.\n${validationIssues.map((v) => `  - ${v}`).join("\n")}`,
    );
  }

  // 5) 파일 쓰기 (위 단계에서 대상 파일이 모두 없음을 확인했으므로 전량 신규 생성)
  //    쓰기 시작 후 OS 레벨 중간 실패(권한/디스크 풀) 시 이미 쓰인 파일을 원상 복구한다.
  const result: RenderResult = { written: [], appendedMessageFiles: [] };
  const journal = new FileWriteJournal();
  await withWriteRollback(projectDir, journal, async () => {
    for (const r of renderedFiles) {
      const out = assertInsideProject(projectDir, path.join(projectDir, r.output));
      await journal.recordBeforeWrite(out);
      await fs.ensureDir(path.dirname(out));
      await writeFile(out, r.content, "utf-8");
      result.written.push(r.output);
    }
  });

  // 6) 메뉴 자동 통합 — nav fragment 재생성 (autoApplyMenu)
  if (params.autoApplyMenu) {
    try {
      result.menuAttachedTo = await regenerateNavWithQueryView(projectDir, {
        viewName,
        viewNameLower,
      }, ctx);
    } catch (e) {
      // 메뉴 갱신 실패는 치명적이지 않음 — 본문은 이미 생성됨
      console.error("[egov_add_query_view] menu update skipped:", e);
    }
  }

  // 7) 메시지 키 자동 추가 (autoApplyMessages) — list.{viewLower}, title.{viewLower}.{alias}, nav.{viewLower}
  if (params.autoApplyMessages) {
    const messageKeys = buildMessageKeys(ctx);
    const msgDir = messageBundleDir(projectDir);
    const allExist = (
      await Promise.all(
        MESSAGE_BUNDLE_FILENAMES.map((f) => fs.pathExists(path.join(msgDir, f))),
      )
    ).every(Boolean);
    if (allExist) {
      for (const f of MESSAGE_BUNDLE_FILENAMES) {
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
    ...(basePackageRebased
      ? [
          `🔧 공유 basePackage 자동 보정: ${basePackageRebased.from}  →  ${basePackageRebased.to}`,
          `   (컨트롤러·화면 파일을 기존 프로젝트의 basePackage 아래에 두어 뷰 리졸버 경로와 맞춥니다.)`,
        ]
      : []),
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

  lines.push(``, `✅ 자체 검증 통과 (검사한 파일 ${renderedFiles.length}개)`);

  return lines.join("\n") + completionFooter();
}

/**
 * Nav fragment 를 재생성해 새 query view 를 포함시킨다.
 * 기존 nav fragment 가 없으면 (graceful degrade), 단순 스킵.
 */
async function regenerateNavWithQueryView(
  projectDir: string,
  newView: { viewName: string; viewNameLower: string },
  ctx: Record<string, unknown> & { stack: StackEntry },
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

  // nav fragment 가 있어야만 갱신 — 템플릿/출력 경로는 스택 매트릭스의 navFragment 를 따른다.
  const fragSpec = ctx.stack.navFragment;
  const fragmentAbs = assertInsideProject(projectDir, path.join(projectDir, fragSpec.output));
  if (!(await fs.pathExists(fragmentAbs))) return undefined;

  // egov_add_entity 가 같은 nav 템플릿을 렌더링할 때와 동일한 컨텍스트(스택 컨텍스트 + entities)로 다시 렌더
  const navTemplateAbs = path.join(getScaffoldTemplatePath(), fragSpec.template);
  const navTmpl = await fs.readFile(navTemplateAbs, "utf-8");
  const rendered = Handlebars.compile(navTmpl)({ ...ctx, entities });
  await writeFile(fragmentAbs, rendered, "utf-8");
  return fragSpec.output;
}

/** 메시지 번들(properties) 3종 — locale 별로 동일한 append 블록을 갖는다. */
const MESSAGE_BUNDLE_FILENAMES = [
  "message-common.properties",
  "message-common_ko.properties",
  "message-common_en.properties",
] as const;

function messageBundleDir(projectDir: string): string {
  return path.join(projectDir, "src/main/resources/egovframework/message");
}

/**
 * 특정 query view 의 메시지 append 블록을 여는 마커 라인. `buildMessageKeys` 가 쓰는
 * 블록의 첫 줄이자, `extractMessageBlockForView` 가 기존 파일에서 해당 뷰의 블록을
 * 찾아내는 데 쓰는 고유 식별자다 (viewName 이 블록마다 유일하다는 전제).
 */
function messageBlockMarker(viewName: string): string {
  return `# === query view '${viewName}' keys (egov_add_query_view 가 append) ===`;
}

interface MessageKeyContext {
  viewNameLower: string;
  viewName: string;
  columns: { alias: string; label: string }[];
  stack: Pick<StackEntry, "messageUnicodeEscape">;
}

/**
 * Query view 의 메시지 키들을 properties 라인 문자열로 만든다.
 * autoApplyMessages 가 활성일 때 모든 lang properties 파일 끝에 append 된다.
 */
function buildMessageKeys(ctx: MessageKeyContext): string {
  // 메시지 번들을 ISO-8859-1 로 읽는 스택(WAR 4.3 — messageSource 에 defaultEncoding 없음)은
  // 한글 label 이 깨지므로 properties 표준 \uXXXX 이스케이프로 기록한다.
  const value = (v: string) => (ctx.stack.messageUnicodeEscape ? escapeNonAscii(v) : v);
  const lines = [
    messageBlockMarker(ctx.viewName),
    `list.${ctx.viewNameLower}=${ctx.viewName}`,
    `title.${ctx.viewNameLower}.sample=${ctx.viewName}`,
    `nav.${ctx.viewNameLower}=${ctx.viewName}`,
    ...ctx.columns.map(
      (c) => `title.${ctx.viewNameLower}.${c.alias}=${value(c.label)}`,
    ),
  ];
  return lines.join("\n") + "\n";
}

/**
 * 기존 메시지 번들 파일 내용에서 특정 viewName 의 append 블록만 잘라낸다.
 * 마커를 찾지 못하면(아직 한 번도 append 된 적 없음) `null` 을 반환한다 — 이 경우는
 * "비교할 이전 값이 없음" 을 의미하므로 충돌로 취급하지 않는다.
 */
function extractMessageBlockForView(content: string, viewName: string): string | null {
  const marker = messageBlockMarker(viewName);
  const start = content.indexOf(marker);
  if (start === -1) return null;
  // 다른 query view 의 블록 마커가 뒤에 나오면 그 직전까지만 이 뷰의 블록으로 간주한다.
  const nextMarker = content.indexOf("\n# === query view '", start + marker.length);
  const raw = nextMarker === -1 ? content.slice(start) : content.slice(start, nextMarker);
  return raw.trimEnd();
}

/**
 * columns[].label 등 렌더 대상 산출물 파일에는 나타나지 않고 메시지 번들 append 블록에만
 * 반영되는 메타가 이전 호출과 달라졌는지 확인한다. 메시지 번들 파일이 없거나, 있어도
 * 해당 viewName 의 블록이 아직 append 된 적 없으면(첫 호출 등) 비교할 대상이 없으므로
 * 충돌로 보지 않는다 — 오직 "이전에 append 된 블록과 지금 다시 계산한 블록이 다른"
 * 경우만 충돌 파일 목록에 포함한다.
 */
async function findMessageBlockConflicts(
  projectDir: string,
  viewName: string,
  ctx: MessageKeyContext,
): Promise<string[]> {
  const newBlock = buildMessageKeys(ctx).trimEnd();
  const msgDir = messageBundleDir(projectDir);
  const conflicts: string[] = [];
  for (const f of MESSAGE_BUNDLE_FILENAMES) {
    const abs = path.join(msgDir, f);
    if (!(await fs.pathExists(abs))) continue;
    const content = await fs.readFile(abs, "utf-8");
    const existingBlock = extractMessageBlockForView(content, viewName);
    if (existingBlock !== null && existingBlock !== newBlock) {
      conflicts.push(path.relative(projectDir, abs));
    }
  }
  return conflicts;
}
