import { describe, it, expect } from "vitest";
import { dialectFullType } from "../../src/utils/scaffold/dialectTypes.js";

describe("dialectFullType — Oracle 매핑", () => {
  it.each([
    ["VARCHAR", 36, "VARCHAR2(36)"],
    ["VARCHAR2", 200, "VARCHAR2(200)"],
    ["INT", 0, "NUMBER(10)"],
    ["BIGINT", 0, "NUMBER(19)"],
    ["DECIMAL", 10, "NUMBER(10)"],
    ["NUMBER", 0, "NUMBER"],
    ["TEXT", 0, "CLOB"],
    ["CLOB", 0, "CLOB"],
    ["DATETIME", 0, "TIMESTAMP"],
    ["TIMESTAMP", 0, "TIMESTAMP"],
    ["DATE", 0, "DATE"],
    ["BOOLEAN", 0, "NUMBER(1)"],
  ])("%s(maxLength=%i) → %s", (raw, len, expected) => {
    expect(dialectFullType(raw, len, "oracle")).toBe(expected);
  });
});

describe("dialectFullType — MySQL/MariaDB 매핑", () => {
  it.each([
    ["VARCHAR", 36, "VARCHAR(36)"],
    ["VARCHAR2", 100, "VARCHAR(100)"],
    ["NUMBER", 10, "DECIMAL(10)"],
    ["NUMBER", 0, "DECIMAL"],
    ["CLOB", 0, "TEXT"],
    ["TEXT", 0, "TEXT"],
    ["DATETIME", 0, "DATETIME"],
    ["TIMESTAMP", 0, "TIMESTAMP"],
    ["BOOLEAN", 0, "TINYINT(1)"],
    ["INT", 0, "INT"],
    ["BIGINT", 0, "BIGINT"],
  ])("%s(maxLength=%i) → %s", (raw, len, expected) => {
    expect(dialectFullType(raw, len, "mysql")).toBe(expected);
  });
});

describe("dialectFullType — PostgreSQL 매핑", () => {
  it.each([
    ["VARCHAR", 36, "VARCHAR(36)"],
    ["VARCHAR2", 100, "VARCHAR(100)"],
    ["NUMBER", 10, "NUMERIC(10)"],
    ["NUMBER", 0, "NUMERIC"],
    ["CLOB", 0, "TEXT"],
    ["TEXT", 0, "TEXT"],
    ["DATETIME", 0, "TIMESTAMP"],
    ["TIMESTAMP", 0, "TIMESTAMP"],
    ["INT", 0, "INTEGER"],
    ["INTEGER", 0, "INTEGER"],
    ["BIGINT", 0, "BIGINT"],
    ["TINYINT", 0, "SMALLINT"],
    ["BOOLEAN", 0, "BOOLEAN"],
    ["BLOB", 0, "BYTEA"],
    ["DOUBLE", 0, "DOUBLE PRECISION"],
  ])("%s(maxLength=%i) → %s", (raw, len, expected) => {
    expect(dialectFullType(raw, len, "postgres")).toBe(expected);
  });
});

describe("dialectFullType — Tibero/Altibase/Goldilocks (Oracle 호환 alias)", () => {
  it.each(["tibero", "altibase", "goldilocks"] as const)(
    "%s 는 Oracle 매핑과 동일하게 동작한다",
    (dialect) => {
      // 대표 케이스 4개만 — Oracle 매핑은 위에서 이미 검증됨
      expect(dialectFullType("VARCHAR", 36, dialect)).toBe("VARCHAR2(36)");
      expect(dialectFullType("INT", 0, dialect)).toBe("NUMBER(10)");
      expect(dialectFullType("TEXT", 0, dialect)).toBe("CLOB");
      expect(dialectFullType("DATETIME", 0, dialect)).toBe("TIMESTAMP");
    },
  );
});

describe("dialectFullType — CUBRID 매핑", () => {
  it.each([
    ["VARCHAR", 36, "VARCHAR(36)"],
    ["VARCHAR2", 100, "VARCHAR(100)"],
    ["INT", 0, "INTEGER"],
    ["BIGINT", 0, "BIGINT"],
    ["TINYINT", 0, "SMALLINT"],
    ["BOOLEAN", 0, "SMALLINT"],
    ["NUMBER", 10, "NUMERIC(10)"],
    ["TEXT", 0, "STRING"],
    ["CLOB", 0, "STRING"],
    ["DATETIME", 0, "DATETIME"],
    ["TIMESTAMP", 0, "TIMESTAMP"],
    ["DATE", 0, "DATE"],
    ["BLOB", 0, "BLOB"],
  ])("%s(maxLength=%i) → %s", (raw, len, expected) => {
    expect(dialectFullType(raw, len, "cubrid")).toBe(expected);
  });
});

describe("dialectFullType — HSQL 임베디드 시드 매핑", () => {
  // 기대값은 HSQLDB 2.7.2/2.7.3/2.7.4 기본 모드(jdbc:hsqldb:mem — Spring
  // EmbeddedDatabaseBuilder 와 동일)에서 CREATE TABLE 실측으로 확정한 것.
  it.each([
    // 문자 — VARCHAR2/NVARCHAR2/NCHAR 는 기본 모드 미인식
    ["VARCHAR", 36, "VARCHAR(36)"],
    ["VARCHAR2", 100, "VARCHAR(100)"],
    ["NVARCHAR", 50, "VARCHAR(50)"],
    ["NVARCHAR2", 50, "VARCHAR(50)"],
    ["CHAR", 1, "CHAR(1)"],
    ["NCHAR", 1, "CHAR(1)"],
    // 긴 텍스트 — TEXT/CLOB alias 계열은 기본 모드 미인식. LONGVARCHAR 는
    // 기본 설정(sql.longvar_is_lob=false)에서 VARCHAR(16M) 으로 동작한다.
    ["TEXT", 0, "LONGVARCHAR"],
    ["TINYTEXT", 0, "LONGVARCHAR"],
    ["MEDIUMTEXT", 0, "LONGVARCHAR"],
    ["LONGTEXT", 0, "LONGVARCHAR"],
    ["NTEXT", 0, "LONGVARCHAR"],
    ["CLOB", 0, "LONGVARCHAR"],
    ["NCLOB", 0, "LONGVARCHAR"],
    // 숫자 — NUMBER/MEDIUMINT/SERIAL 계열/BOOL 은 기본 모드 미인식
    ["NUMBER", 10, "NUMERIC(10)"],
    ["NUMBER", 0, "NUMERIC"],
    ["MEDIUMINT", 0, "INTEGER"],
    ["SMALLSERIAL", 0, "SMALLINT"],
    ["SERIAL", 0, "INTEGER"],
    ["BIGSERIAL", 0, "BIGINT"],
    ["BOOL", 0, "BOOLEAN"],
    // 열거 — ENUM/SET 미지원. String 필드로 매핑되므로 VARCHAR 로 수용
    ["ENUM", 0, "VARCHAR(255)"],
    ["SET", 0, "VARCHAR(255)"],
    // 바이너리 — BLOB 자체는 지원, PostgreSQL/MySQL alias 는 미지원
    ["BLOB", 0, "BLOB"],
    ["BYTEA", 0, "BLOB"],
    ["LONGBLOB", 0, "BLOB"],
    ["MEDIUMBLOB", 0, "BLOB"],
    // 기본 모드가 그대로 지원하는 타입은 passthrough
    ["INT", 0, "INT"],
    ["BIGINT", 0, "BIGINT"],
    ["TINYINT", 0, "TINYINT"],
    ["DECIMAL", 10, "DECIMAL(10)"],
    ["FLOAT", 0, "FLOAT"],
    ["DOUBLE", 0, "DOUBLE"],
    ["DATE", 0, "DATE"],
    ["TIME", 0, "TIME"],
    ["DATETIME", 0, "DATETIME"],
    ["TIMESTAMP", 0, "TIMESTAMP"],
    ["BOOLEAN", 0, "BOOLEAN"],
    ["BIT", 0, "BIT"],
  ])("%s(maxLength=%i) → %s", (raw, len, expected) => {
    expect(dialectFullType(raw, len, "hsql")).toBe(expected);
  });

  // HSQL 은 MySQL 의 정수 표시 폭 INT(11) 을 문법 오류로 거부한다 (실측:
  // "unexpected token: ("). 정수 타입은 LENGTH_AWARE 가 아니므로 표시 폭이
  // 떼어진 채 렌더링되어야 부팅이 된다.
  it.each([
    ["INT", 11, "INT"],
    ["TINYINT", 4, "TINYINT"],
    ["BIGINT", 20, "BIGINT"],
  ])("MySQL 표시 폭 %s(%i) → %s: 표시 폭 미부착", (raw, len, expected) => {
    expect(dialectFullType(raw, len as number, "hsql")).toBe(expected);
  });

  it("VARCHAR(500 이상) 도 길이 유지 — long-text 판정과 무관하게 타입은 보존", () => {
    expect(dialectFullType("VARCHAR", 4000, "hsql")).toBe("VARCHAR(4000)");
  });

  it("TEXT 에 길이가 딸려 와도 LONGVARCHAR 에 재부착하지 않음", () => {
    expect(dialectFullType("TEXT", 500, "hsql")).toBe("LONGVARCHAR");
  });

  it("ENUM 매핑 결과의 (255) 에 입력 길이를 재부착하지 않음", () => {
    expect(dialectFullType("ENUM", 10, "hsql")).toBe("VARCHAR(255)");
  });
});

describe("dialectFullType — 길이 박힌 매핑과 LENGTH_AWARE 충돌 방지", () => {
  // MySQL 계열 DDL 의 INT(11) 처럼 정수 타입에 표시 폭이 붙어 오면
  // maxLength > 0 으로 전달된다. Oracle 매핑 결과 NUMBER(10) 에 길이를
  // 다시 붙여 NUMBER(10)(11) 같은 비정상 타입이 되면 안 된다.
  it.each([
    ["INT", 11, "oracle", "NUMBER(10)"],
    ["TINYINT", 4, "oracle", "NUMBER(10)"],
    ["SMALLINT", 6, "oracle", "NUMBER(10)"],
    ["BIGINT", 20, "oracle", "NUMBER(19)"],
    ["BOOLEAN", 1, "oracle", "NUMBER(1)"],
    ["INT", 11, "tibero", "NUMBER(10)"],
    ["INT", 11, "altibase", "NUMBER(10)"],
    ["INT", 11, "goldilocks", "NUMBER(10)"],
    ["BOOLEAN", 1, "mysql", "TINYINT(1)"],
  ])("%s(maxLength=%i) → %s: 길이가 이미 박힌 매핑에 (LEN) 재부착 금지", (raw, len, dialect, expected) => {
    expect(dialectFullType(raw, len as number, dialect as Parameters<typeof dialectFullType>[2])).toBe(expected);
  });

  it("길이가 박히지 않은 LENGTH_AWARE 매핑은 여전히 (LEN) 부착", () => {
    expect(dialectFullType("DECIMAL", 10, "oracle")).toBe("NUMBER(10)");
    expect(dialectFullType("VARCHAR", 36, "oracle")).toBe("VARCHAR2(36)");
  });
});

describe("dialectFullType — 엣지 케이스", () => {
  it("소문자 입력도 동일하게 동작 (정규화)", () => {
    expect(dialectFullType("varchar", 36, "oracle")).toBe("VARCHAR2(36)");
  });

  it("maxLength=0 인 VARCHAR 는 길이 미부착", () => {
    expect(dialectFullType("VARCHAR", 0, "mysql")).toBe("VARCHAR");
  });

  it("CLOB/TEXT/DATE 같은 길이 무의미 타입에는 (LEN) 안 붙음", () => {
    expect(dialectFullType("CLOB", 500, "oracle")).toBe("CLOB");
    expect(dialectFullType("DATE", 100, "postgres")).toBe("DATE");
  });

  it("알려지지 않은 타입은 그대로 (대문자) 반환", () => {
    expect(dialectFullType("JSONB", 0, "postgres")).toBe("JSONB");
  });
});
