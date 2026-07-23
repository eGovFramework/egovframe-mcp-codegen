/**
 * 도구 호출자(LLM 클라이언트)가 모호한 에러/성공 메시지 때문에 무한 재시도 루프에
 * 빠지는 것을 막기 위한 공통 메시지 헬퍼.
 *
 * 분류 기준
 * ---------
 * - `retryAfterAction`: 사전조건 미충족 등 — 다른 도구를 먼저 호출하거나 산출물(충돌
 *   파일 등)을 정리하면 *같은 인자*로 재시도해 성공할 수 있는 에러에 사용한다.
 * - `nonRetryable`: 입력값(DDL/파라미터) 자체가 잘못돼 발생한 에러 — 인자를 바꾸지
 *   않는 한 재시도해도 항상 같은 이유로 실패한다는 것을 명시해 재시도 루프를 차단한다.
 * - `completionFooter`: 성공 메시지 끝에 붙여 "이 결과로 요청이 끝났다" 는 신호를
 *   줘서 불필요한 추가 도구 호출을 막는다.
 */

export const RETRY_AFTER_ACTION_PREFIX = "[조치 후 재시도 가능]";
export const NON_RETRYABLE_PREFIX = "[재시도 불가 — 입력을 수정해야 합니다]";

const NON_RETRYABLE_RETRY_HINT = "같은 인자로 재호출하면 동일하게 실패합니다.";

/**
 * 사전조건 미충족류 에러에 사용한다. 다른 도구를 먼저 호출하거나 충돌 파일을 정리하는
 * 등 조치를 취하면 *같은 인자*로 재시도해 성공할 수 있음을 알린다.
 *
 * 멱등: `message` 에 이미 프리픽스가 붙어 있으면 중복 부착하지 않는다.
 */
export function retryAfterAction(message: string): Error {
  const text = message.startsWith(RETRY_AFTER_ACTION_PREFIX)
    ? message
    : `${RETRY_AFTER_ACTION_PREFIX} ${message}`;
  return new Error(text);
}

/**
 * 입력값(DDL/파라미터) 자체의 문제로 발생한 에러에 사용한다. 인자를 바꾸지 않고
 * 재호출하면 항상 동일하게 실패한다는 문장을 자동으로 덧붙여, 호출자가 같은 인자로
 * 재시도를 반복하지 않도록 유도한다.
 *
 * 멱등: 프리픽스 또는 안내 문장이 이미 있으면 중복 부착하지 않는다.
 */
export function nonRetryable(message: string): Error {
  let text = message.startsWith(NON_RETRYABLE_PREFIX)
    ? message
    : `${NON_RETRYABLE_PREFIX} ${message}`;
  if (!text.includes(NON_RETRYABLE_RETRY_HINT)) {
    text = `${text} ${NON_RETRYABLE_RETRY_HINT}`;
  }
  return new Error(text);
}

/**
 * 성공 메시지 끝에 부착하는 완료 표식. 도구 호출자가 "이 결과로 요청이 끝났다" 는
 * 것을 명확히 인지하도록 해 불필요한 추가 도구 호출(재시도 루프)을 막는다.
 *
 * `remainingUserSteps` 를 넘기면 도구가 대신 해줄 수 없는, 사용자가 직접 수행해야
 * 하는 후속 작업(예: `mvn clean package`) 목록을 덧붙인다.
 */
export function completionFooter(opts?: { remainingUserSteps?: string[] }): string {
  const lines = ["", "", "🏁 작업 완료 — 이 요청에 대한 추가 도구 호출은 필요하지 않습니다."];
  if (opts?.remainingUserSteps && opts.remainingUserSteps.length > 0) {
    lines.push("", "남은 작업(사용자 수행):", ...opts.remainingUserSteps.map((s) => `  - ${s}`));
  }
  return lines.join("\n");
}
