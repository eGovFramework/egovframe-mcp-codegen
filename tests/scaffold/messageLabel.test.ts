/**
 * messageLabel 단위 테스트
 *
 * DDL COMMENT 를 화면 라벨로 쓸 때의 규칙(콤마 → 폴백, 괄호 앞부분만, 10자 초과 → 폴백)과
 * properties 값 이스케이프를 고정한다.
 */
import { describe, it, expect } from "vitest";
import {
  deriveLabelFromComment,
  escapeNonAscii,
  escapePropertiesValue,
} from "../../src/utils/scaffold/messageLabel.js";

describe("deriveLabelFromComment", () => {
  it("일반 논리명은 그대로", () => expect(deriveLabelFromComment("공지사항제목")).toBe("공지사항제목"));
  it("양끝 공백 trim", () => expect(deriveLabelFromComment("  제목 ")).toBe("제목"));
  it("괄호 밖에 콤마가 있으면 폴백(null)", () => expect(deriveLabelFromComment("제목, 부제")).toBeNull());
  it("괄호 밖에 / ; : 가 있으면 설명문으로 보고 폴백", () => {
    for (const v of ["등록일/수정일", "상태: 대기", "제목;부제"]) expect(deriveLabelFromComment(v)).toBeNull();
  });
  it("괄호 안의 콤마·/ 는 폴백 조건이 아니다 (괄호 앞부분만 취한다)", () => {
    expect(deriveLabelFromComment("제목(a, b)")).toBe("제목");
    expect(deriveLabelFromComment("사용여부(Y/N)")).toBe("사용여부");
  });
  it("괄호 뒤라도 괄호 밖에 콤마가 있으면 폴백", () => expect(deriveLabelFromComment("제목(a, b), 부제")).toBeNull());
  it("괄호 앞부분만 취한다", () => expect(deriveLabelFromComment("사용여부(Y/N)")).toBe("사용여부"));
  it("전각 괄호도 괄호로 본다", () => expect(deriveLabelFromComment("사용여부（Y/N）")).toBe("사용여부"));
  it("괄호 앞이 공백뿐이면 폴백", () => expect(deriveLabelFromComment(" (설명)")).toBeNull());
  it("10글자는 통과", () => expect(deriveLabelFromComment("가나다라마바사아자차")).toBe("가나다라마바사아자차"));
  it("11글자는 폴백", () => expect(deriveLabelFromComment("가나다라마바사아자차카")).toBeNull());
  it("괄호 제거 후 10자 이하면 통과", () =>
    expect(deriveLabelFromComment("공지사항제목(이 컬럼은 공지사항의 제목입니다)")).toBe("공지사항제목"));
  it("빈 문자열/공백/null/undefined 는 폴백", () => {
    for (const v of ["", "   ", null, undefined]) expect(deriveLabelFromComment(v)).toBeNull();
  });
});

describe("escapeNonAscii", () => {
  it("비ASCII 문자만 대문자 16진수 \\uXXXX 로 바꾼다", () => expect(escapeNonAscii("a공b")).toBe("a\\uACF5b"));
});

describe("escapePropertiesValue", () => {
  it("unicodeEscape=false 면 한글을 그대로 둔다", () => expect(escapePropertiesValue("공지", false)).toBe("공지"));
  it("unicodeEscape=true 면 \\uXXXX 로 바꾼다", () =>
    expect(escapePropertiesValue("공지", true)).toBe("\\uACF5\\uC9C0"));
  it("백슬래시와 줄바꿈을 이스케이프한다", () =>
    expect(escapePropertiesValue("a\\b\nc\rd", false)).toBe("a\\\\b\\nc\\rd"));
  it("선행 공백은 이스케이프한다", () => expect(escapePropertiesValue(" a", false)).toBe("\\ a"));
  it("= 와 : 는 값 위치에서 그대로 둔다", () => expect(escapePropertiesValue("a=b:c", false)).toBe("a=b:c"));
});
