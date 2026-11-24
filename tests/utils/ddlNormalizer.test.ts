/**
 * Unit tests for `src/utils/ddlNormalizer.ts`
 *
 * 정규화 결과는 `parseDDL` 의 입력으로 그대로 들어가므로
 *   1) 의미가 보존되는지(파서 결과가 동일한지)
 *   2) 케이스/공백/인용부호 변환이 의도대로 적용되는지
 *   3) 진단(report) 가 적절히 발행되는지
 * 세 축으로 검증한다.
 */
import { describe, it, expect } from "vitest";
import {
  formatNormalizationReport,
  normalizeDdl,
  repairEscapeSequences,
} from "../../src/utils/ddlNormalizer.js";
import { parseDDL } from "../../src/utils/scaffold/ddlParser.js";

// 이미 표준 형태인 DDL (eGovFrame 권장 = SNAKE_CASE UPPER + 데이터 타입 UPPER)
const SNAKE_DDL = `CREATE TABLE BOARD (
  BOARD_ID VARCHAR(36) NOT NULL,
  TITLE VARCHAR(200),
  PRIMARY KEY (BOARD_ID)
)`;

describe("normalizeDdl — 의미 보존", () => {
  it("이미 표준에 가까운 DDL은 파서 결과를 바꾸지 않는다", () => {
    const before = parseDDL(SNAKE_DDL);
    const { normalizedDdl, report } = normalizeDdl(SNAKE_DDL);
    const after = parseDDL(normalizedDdl);
    expect(after.tableName).toBe(before.tableName);
    expect(after.attributes.map((a) => a.columnName)).toEqual(
      before.attributes.map((a) => a.columnName),
    );
    expect(after.pkAttributes.map((a) => a.columnName)).toEqual(
      before.pkAttributes.map((a) => a.columnName),
    );
    // 보고서는 변경 없음
    expect(report.changes).toHaveLength(0);
    expect(report.issues).toHaveLength(0);
  });

  it("케이스/공백/인용부호 정규화 후에도 컬럼·PK 동일하게 파싱된다", () => {
    const messy = `CREATE   TABLE   board (
        "Board_Id"    varchar(36)   NOT NULL  ,
        Title    Varchar(200) ,
        PRIMARY KEY ("Board_Id")
      )`;
    const { normalizedDdl } = normalizeDdl(messy);
    const after = parseDDL(normalizedDdl);
    expect(after.tableName).toBe("Board");
    expect(
      after.attributes.map((a) => a.columnName).sort((a, b) => a.localeCompare(b)),
    ).toEqual(["BOARD_ID", "TITLE"]);
    expect(after.pkAttributes.map((a) => a.columnName)).toEqual(["BOARD_ID"]);
  });
});

describe("normalizeDdl — 변환 규칙", () => {
  it("식별자에서 백틱과 큰따옴표를 제거한다", () => {
    const ddl = "CREATE TABLE board (`board_id` VARCHAR(36) PRIMARY KEY)";
    const { normalizedDdl, report } = normalizeDdl(ddl);
    expect(normalizedDdl).not.toContain("`");
    expect(report.changes.some((c) => c.kind === "identifier_quote")).toBe(true);
  });

  it("데이터 타입을 대문자로 정규화한다", () => {
    const ddl = `CREATE TABLE board (board_id varchar(36) NOT NULL, PRIMARY KEY (board_id))`;
    const { normalizedDdl, report } = normalizeDdl(ddl);
    expect(normalizedDdl).toContain("VARCHAR");
    expect(report.changes.some((c) => c.kind === "data_type_case")).toBe(true);
  });

  it("소문자가 섞인 식별자를 UPPER 로 변환한다 (eGovFrame 표준)", () => {
    const ddl = `CREATE TABLE board (BoardId VARCHAR(36) NOT NULL, PRIMARY KEY (BoardId))`;
    const { normalizedDdl, report } = normalizeDdl(ddl);
    expect(normalizedDdl).toContain("BOARDID");
    expect(normalizedDdl).not.toContain("BoardId");
    // 컬럼 본문 + PRIMARY KEY 제약 두 군데
    expect(
      report.changes.filter((c) => c.kind === "identifier_case").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("SNAKE_CASE 가 아닌 카멜 식별자에 대해 mixed_case_identifier 경고를 낸다", () => {
    const ddl = `CREATE TABLE board (BoardId VARCHAR(36) NOT NULL, PRIMARY KEY (BoardId))`;
    const { report } = normalizeDdl(ddl);
    const warn = report.issues.find((i) => i.kind === "mixed_case_identifier");
    expect(warn).toBeDefined();
    expect(warn?.suggestion).toBe("BOARD_ID");
  });

  it("사전에 없는 데이터 타입은 unknown_data_type 경고로 보고된다", () => {
    const ddl = `CREATE TABLE board (board_id JSONB NOT NULL, PRIMARY KEY (board_id))`;
    const { report } = normalizeDdl(ddl);
    const warn = report.issues.find((i) => i.kind === "unknown_data_type");
    expect(warn).toBeDefined();
    expect(warn?.token).toBe("JSONB");
  });

  it("CREATE MEMORY TABLE (HSQLDB) 도 처리한다", () => {
    const ddl = `CREATE MEMORY TABLE Board ("BoardId" VARCHAR(36) NOT NULL, PRIMARY KEY ("BoardId"))`;
    const { normalizedDdl } = normalizeDdl(ddl);
    expect(normalizedDdl).toMatch(/CREATE\s+MEMORY\s+TABLE/i);
    const parsed = parseDDL(normalizedDdl);
    expect(parsed.tableName).toBe("Board");
    expect(parsed.attributes[0].columnName).toBe("BOARDID");
  });

  it("괄호 안 콤마(예: VARCHAR(10,2))가 split 되지 않는다", () => {
    const ddl = `CREATE TABLE t (price DECIMAL(10,2) NOT NULL, PRIMARY KEY (price))`;
    const { normalizedDdl } = normalizeDdl(ddl);
    const parsed = parseDDL(normalizedDdl);
    expect(parsed.attributes).toHaveLength(1);
    expect(parsed.attributes[0].dataType).toBe("DECIMAL");
  });
});

describe("repairEscapeSequences — 리터럴 escape 교정", () => {
  it("리터럴 \\n / \\t 를 실제 제어문자로 되돌리고 change 로 보고한다", () => {
    // TS 소스의 "\\n" = 런타임 문자열의 백슬래시+n (이중 escape 가 만들어낸 깨진 텍스트)
    const { ddl, changes } = repairEscapeSequences("a\\nb\\tc");
    expect(ddl).toBe("a\nb\tc");
    expect(ddl).not.toContain("\\");
    expect(changes.map((c) => c.kind)).toEqual([
      "escape_sequence",
      "escape_sequence",
    ]);
  });

  it("quad-escape (\\\\n) 처럼 백슬래시가 여러 개여도 흡수한다", () => {
    // 런타임 문자열: 백슬래시 2개 + n
    const { ddl, changes } = repairEscapeSequences("a\\\\nb");
    expect(ddl).toBe("a\nb");
    expect(changes).toHaveLength(1);
  });

  it("정상 텍스트(백슬래시 없음)는 건드리지 않는다", () => {
    const { ddl, changes } = repairEscapeSequences("MBR_NO VARCHAR(20)");
    expect(ddl).toBe("MBR_NO VARCHAR(20)");
    expect(changes).toHaveLength(0);
  });
});

describe("normalizeDdl — 이중 escape 된 DDL 복구", () => {
  // 모델이 줄바꿈을 `\\n` 으로 이중 escape 한 경우 (문서의 MEMBER 케이스 재현).
  // TS 소스의 "\\n" 은 런타임에서 백슬래시+n 두 글자가 된다.
  const BROKEN_MEMBER =
    "CREATE MEMORY TABLE MEMBER (\\n" +
    "  MBR_NO VARCHAR(20) NOT NULL,\\n" +
    "  MBR_NM VARCHAR(100) NOT NULL,\\n" +
    "  MBR_EML_ADDR VARCHAR(320),\\n" +
    "  MBR_JOIN_DT DATETIME,\\n" +
    "  PRIMARY KEY (MBR_NO)\\n" +
    ")";

  it("정규화 결과에 리터럴 \\n 텍스트가 남지 않는다", () => {
    const { normalizedDdl } = normalizeDdl(BROKEN_MEMBER);
    expect(normalizedDdl).not.toContain("\\");
  });

  it("교정 후 컬럼·PK 가 올바르게 파싱된다 (\\n 이 컬럼명으로 오인되지 않음)", () => {
    const { normalizedDdl } = normalizeDdl(BROKEN_MEMBER);
    const parsed = parseDDL(normalizedDdl);
    // parseDDL 은 테이블명을 PascalCase 로 정규화한다 (MEMBER → Member). escape 교정과 무관.
    expect(parsed.tableName).toBe("Member");
    expect(parsed.attributes.map((a) => a.columnName)).toEqual([
      "MBR_NO",
      "MBR_NM",
      "MBR_EML_ADDR",
      "MBR_JOIN_DT",
    ]);
    expect(parsed.pkAttributes.map((a) => a.columnName)).toEqual(["MBR_NO"]);
  });

  it("escape_sequence change 가 report 에 기록된다", () => {
    const { report } = normalizeDdl(BROKEN_MEMBER);
    const escapeChanges = report.changes.filter(
      (c) => c.kind === "escape_sequence",
    );
    expect(escapeChanges.length).toBeGreaterThanOrEqual(1);
    const summary = formatNormalizationReport(report);
    expect(summary).toMatch(/escape_sequence/);
  });

  it("정상 DDL 에는 escape_sequence change 가 생기지 않는다 (오탐 방지)", () => {
    const { report } = normalizeDdl(SNAKE_DDL);
    expect(report.changes.some((c) => c.kind === "escape_sequence")).toBe(false);
  });
});

describe("normalizeDdl — 보호적 동작", () => {
  it("CREATE TABLE 형태가 아니면 원본 그대로 반환한다", () => {
    const broken = "INSERT INTO foo VALUES (1)";
    const { normalizedDdl, report } = normalizeDdl(broken);
    expect(normalizedDdl).toBe(broken);
    expect(report.tableName).toBe("");
  });

  it("normalizeIdentifierCase=false 면 lower-case 변환을 건너뛴다", () => {
    const ddl = `CREATE TABLE board (BoardId VARCHAR(36) PRIMARY KEY)`;
    const { normalizedDdl } = normalizeDdl(ddl, { normalizeIdentifierCase: false });
    expect(normalizedDdl).toContain("BoardId");
  });

  it("normalizeDataTypeCase=false 면 upper-case 변환을 건너뛴다", () => {
    const ddl = `CREATE TABLE board (board_id varchar(36) PRIMARY KEY)`;
    const { normalizedDdl } = normalizeDdl(ddl, { normalizeDataTypeCase: false });
    expect(normalizedDdl).toContain("varchar");
  });
});

describe("formatNormalizationReport", () => {
  it("변경/이슈가 없으면 빈 문자열을 반환한다", () => {
    const out = formatNormalizationReport({
      tableName: "board",
      changes: [],
      issues: [],
    });
    expect(out).toBe("");
  });

  it("변경과 경고를 사람이 읽기 좋은 텍스트로 요약한다", () => {
    const ddl = `CREATE TABLE board ("BoardId" varchar(36) NOT NULL, PRIMARY KEY ("BoardId"))`;
    const { report } = normalizeDdl(ddl);
    const out = formatNormalizationReport(report);
    expect(out).toMatch(/적용된 정규화 변경/);
    expect(out).toMatch(/표준 미준수 경고/);
  });
});

describe("normalizeDdl — COMMENT 리터럴 보존", () => {
  it("COMMENT 리터럴 안의 콤마에서 줄을 쪼개지 않는다", () => {
    const r = normalizeDdl(`CREATE TABLE T (A INT COMMENT '내용, 본문', B INT)`);
    expect(r.normalizedDdl).toMatch(/COMMENT '내용, 본문'/);
    expect(r.normalizedDdl.split("\n").filter((l) => /^\s*[AB] /.test(l))).toHaveLength(2);
  });
  it("COMMENT 리터럴의 영문 대소문자를 바꾸지 않는다", () => {
    const r = normalizeDdl(`CREATE TABLE t (a INT COMMENT 'Notice Title')`);
    expect(r.normalizedDdl).toMatch(/COMMENT 'Notice Title'/);
  });
});
