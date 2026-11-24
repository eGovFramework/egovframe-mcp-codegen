/**
 * sqlText 단위 테스트 — 따옴표·괄호를 인식하는 SQL 텍스트 분리 유틸.
 */
import { describe, it, expect } from "vitest";
import { splitTopLevel, findMatchingParen, unquoteSqlString } from "../../src/utils/sqlText.js";

describe("splitTopLevel", () => {
  it("따옴표 안의 콤마에서 나누지 않는다", () =>
    expect(splitTopLevel("A INT COMMENT '내용, 본문', B INT", ",")).toEqual([
      "A INT COMMENT '내용, 본문'",
      " B INT",
    ]));
  it("괄호 안의 콤마에서 나누지 않는다", () =>
    expect(splitTopLevel("A DECIMAL(10,2), B INT", ",")).toEqual(["A DECIMAL(10,2)", " B INT"]));
  it("'' 이스케이프를 따옴표 종료로 보지 않는다", () =>
    expect(splitTopLevel("A INT COMMENT 'it''s, ok', B INT", ",")).toHaveLength(2));
  it("큰따옴표와 백틱 안의 콤마도 보호한다", () =>
    expect(splitTopLevel('A INT COMMENT "x, y", `b,c` INT', ",")).toHaveLength(2));
  it("세미콜론으로 문장을 나눈다", () =>
    expect(
      splitTopLevel("CREATE TABLE t (a INT); COMMENT ON COLUMN t.a IS 'x;y';", ";"),
    ).toEqual(["CREATE TABLE t (a INT)", " COMMENT ON COLUMN t.a IS 'x;y'"]));
  it("빈 조각은 버린다", () => expect(splitTopLevel("a,,b, ", ",")).toEqual(["a", "b"]));
});

describe("findMatchingParen", () => {
  it("따옴표 안의 괄호를 무시한다", () => {
    const s = "(a INT COMMENT ')') COMMENT='공지(사항)'";
    expect(findMatchingParen(s, 0)).toBe(18);
  });
  it("중첩 괄호의 짝을 찾는다", () => expect(findMatchingParen("(a(b)c)", 0)).toBe(6));
  it("짝이 없으면 -1", () => expect(findMatchingParen("(a", 0)).toBe(-1));
});

describe("unquoteSqlString", () => {
  it("'' 를 ' 로 복원한다", () => expect(unquoteSqlString("'it''s'")).toBe("it's"));
  it("큰따옴표도 벗긴다", () => expect(unquoteSqlString('"공지"')).toBe("공지"));
  it("따옴표가 없으면 trim 만 한다", () => expect(unquoteSqlString("  x ")).toBe("x"));
});
