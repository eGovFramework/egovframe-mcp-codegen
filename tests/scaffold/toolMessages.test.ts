/**
 * toolMessages 단위 테스트
 *
 * LLM 재시도 루프 방지를 위한 에러 분류 프리픽스(retryAfterAction / nonRetryable)와
 * 성공 메시지의 completionFooter 가 명세대로 부착되는지, 그리고 이중 호출 시
 * 프리픽스/안내 문장이 중복 부착되지 않는지(멱등)를 고정한다.
 */
import { describe, expect, it } from "vitest";

import {
  NON_RETRYABLE_PREFIX,
  RETRY_AFTER_ACTION_PREFIX,
  completionFooter,
  nonRetryable,
  retryAfterAction,
} from "../../src/utils/scaffold/toolMessages.js";

const NON_RETRYABLE_RETRY_HINT = "같은 인자로 재호출하면 동일하게 실패합니다.";

describe("retryAfterAction", () => {
  it("메시지 앞에 [조치 후 재시도 가능] 프리픽스를 부착한다", () => {
    const err = retryAfterAction("첨부파일 인프라가 설치되어 있지 않습니다.");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(
      `${RETRY_AFTER_ACTION_PREFIX} 첨부파일 인프라가 설치되어 있지 않습니다.`,
    );
  });

  it("이미 프리픽스가 붙은 메시지에 다시 적용해도 중복 부착하지 않는다(멱등)", () => {
    const once = retryAfterAction("충돌 파일이 있습니다.");
    const twice = retryAfterAction(once.message);

    expect(twice.message).toBe(once.message);
    // 프리픽스 자체가 두 번 등장하지 않아야 한다.
    expect(twice.message.split(RETRY_AFTER_ACTION_PREFIX).length - 1).toBe(1);
  });
});

describe("nonRetryable", () => {
  it("메시지 앞에 [재시도 불가] 프리픽스를 부착하고, 재시도 무의미 안내 문장을 자동으로 덧붙인다", () => {
    const err = nonRetryable("DDL 파싱 실패.");
    expect(err.message).toBe(
      `${NON_RETRYABLE_PREFIX} DDL 파싱 실패. ${NON_RETRYABLE_RETRY_HINT}`,
    );
  });

  it("이미 프리픽스 + 안내 문장이 모두 있는 메시지를 다시 감싸도 중복 부착하지 않는다(멱등)", () => {
    const once = nonRetryable("입력 검증 실패.");
    const twice = nonRetryable(once.message);

    expect(twice.message).toBe(once.message);
    expect(twice.message.split(NON_RETRYABLE_PREFIX).length - 1).toBe(1);
    expect(twice.message.split(NON_RETRYABLE_RETRY_HINT).length - 1).toBe(1);
  });

  it("프리픽스는 없지만 안내 문장이 이미 포함된 메시지는 문장을 중복 덧붙이지 않는다", () => {
    const preHinted = `커스텀 에러. ${NON_RETRYABLE_RETRY_HINT}`;
    const err = nonRetryable(preHinted);

    expect(err.message).toBe(`${NON_RETRYABLE_PREFIX} ${preHinted}`);
    expect(err.message.split(NON_RETRYABLE_RETRY_HINT).length - 1).toBe(1);
  });

  it("retryAfterAction 과 nonRetryable 의 프리픽스는 서로 다르다", () => {
    expect(RETRY_AFTER_ACTION_PREFIX).not.toBe(NON_RETRYABLE_PREFIX);
  });
});

describe("completionFooter", () => {
  it("옵션 없이 호출하면 완료 배너만 붙는다", () => {
    const footer = completionFooter();
    expect(footer).toBe(
      "\n\n🏁 작업 완료 — 이 요청에 대한 추가 도구 호출은 필요하지 않습니다.",
    );
  });

  it("remainingUserSteps 를 넘기면 '남은 작업' 섹션이 각 항목과 함께 추가된다", () => {
    const footer = completionFooter({
      remainingUserSteps: ["mvn clean package", "DB 마이그레이션 적용"],
    });

    expect(footer).toBe(
      "\n\n🏁 작업 완료 — 이 요청에 대한 추가 도구 호출은 필요하지 않습니다.\n\n" +
        "남은 작업(사용자 수행):\n" +
        "  - mvn clean package\n" +
        "  - DB 마이그레이션 적용",
    );
  });

  it("remainingUserSteps 가 빈 배열이면 '남은 작업' 섹션을 붙이지 않는다", () => {
    const footer = completionFooter({ remainingUserSteps: [] });
    expect(footer).toBe(
      "\n\n🏁 작업 완료 — 이 요청에 대한 추가 도구 호출은 필요하지 않습니다.",
    );
  });

  it("성공 메시지 끝에 그대로 이어붙일 수 있는 형태다 (선행 공백 줄 2개)", () => {
    const base = "✅ 완료!";
    const combined = base + completionFooter();
    expect(combined).toBe(
      "✅ 완료!\n\n🏁 작업 완료 — 이 요청에 대한 추가 도구 호출은 필요하지 않습니다.",
    );
  });
});
