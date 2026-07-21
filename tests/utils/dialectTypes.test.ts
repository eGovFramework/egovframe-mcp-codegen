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
