/**
 * egov_scaffold_project 의 생략 인자 결정 — `stackVersion` 과 `withAttachment` 를 호출자가
 * 생략했을 때 MCP Elicitation form 하나로 사용자에게 함께 묻는다.
 *
 * - WAR 는 4.3 만 지원하고 첨부파일을 지원하지 않으므로 질문 없이 확정한다.
 * - Boot 에서 두 값이 모두 없으면 form 하나에 두 항목을 담아 한 번만 묻는다.
 * - 질문을 던질 수 없는 상황(미지원 클라이언트, 시간 초과, 호출 오류, 값 없는 accept)에서는
 *   `needsUserDecision` 과 함께 답을 받지 못한 항목을 돌려줘, 호출 AI 가 사용자에게 묻고
 *   그 인자만 채워 재호출하게 한다.
 */
import type { StackVersion } from "./stackMatrix.js";
import { ELICIT_TIMEOUT_MS, elicitForm, type ElicitingServer, type FormField } from "./elicitForm.js";
import { completionFooter, retryAfterAction } from "./toolMessages.js";

export { ELICIT_TIMEOUT_MS };

export const SCAFFOLD_STACK_OPTIONS: ReadonlyArray<{ readonly value: StackVersion; readonly title: string }> = [
  { value: "5.1", title: "표준프레임워크 5.1 (Spring Boot 3, Java 17)" },
  { value: "4.3", title: "표준프레임워크 4.3 (Spring Boot 2.7, Java 8)" },
];

export type ScaffoldQuestion = "stackVersion" | "withAttachment";

export type ScaffoldDecision =
  | { kind: "value"; stackVersion: StackVersion; withAttachment: boolean }
  | { kind: "needsUserDecision"; missing: ScaffoldQuestion[] }
  | { kind: "cancelled" };

const FIELDS: Record<ScaffoldQuestion, FormField> = {
  stackVersion: {
    name: "stackVersion",
    kind: "select",
    title: "표준프레임워크 버전",
    options: SCAFFOLD_STACK_OPTIONS,
  },
  withAttachment: { name: "withAttachment", kind: "boolean", title: "첨부파일 포함" },
};

export function scaffoldDecisionMessage(missing: ScaffoldQuestion[]): string {
  const askStack = missing.includes("stackVersion");
  const askAttach = missing.includes("withAttachment");
  if (askStack && askAttach) {
    return "이 프로젝트의 표준프레임워크 버전과 표준 첨부파일 기능 포함 여부를 선택해 주세요.";
  }
  if (askStack) return "이 프로젝트를 어떤 표준프레임워크 버전으로 생성할까요?";
  return "이 프로젝트에 표준 첨부파일 기능을 포함할까요?";
}

export async function resolveScaffoldDecision(args: {
  server: ElicitingServer;
  projectType: "boot" | "war";
  stackVersion: StackVersion | undefined;
  withAttachment: boolean | undefined;
  signal?: AbortSignal;
}): Promise<ScaffoldDecision> {
  const { server, projectType, signal } = args;

  // WAR 는 4.3 전용이고 첨부파일을 지원하지 않는다 — 물을 것이 없다.
  if (projectType === "war") {
    return { kind: "value", stackVersion: args.stackVersion ?? "4.3", withAttachment: args.withAttachment ?? false };
  }

  const missing: ScaffoldQuestion[] = [];
  if (args.stackVersion === undefined) missing.push("stackVersion");
  if (args.withAttachment === undefined) missing.push("withAttachment");
  if (missing.length === 0) {
    return { kind: "value", stackVersion: args.stackVersion!, withAttachment: args.withAttachment! };
  }

  const res = await elicitForm({
    server,
    message: scaffoldDecisionMessage(missing),
    fields: missing.map((q) => FIELDS[q]),
    signal,
  });

  if (res.kind === "cancelled") return { kind: "cancelled" };
  if (res.kind === "unavailable") return { kind: "needsUserDecision", missing };
  if (res.kind === "declined") {
    // 버전은 거절로 정할 수 없다 → 아무 파일도 생성하지 않는다. 첨부 여부만 물었다면 거절 = 첨부 없음.
    if (missing.includes("stackVersion")) return { kind: "cancelled" };
    return { kind: "value", stackVersion: args.stackVersion!, withAttachment: false };
  }

  const stackVersion = (res.values.stackVersion as StackVersion | undefined) ?? args.stackVersion;
  const withAttachment = (res.values.withAttachment as boolean | undefined) ?? args.withAttachment;
  if (stackVersion !== undefined && withAttachment !== undefined) {
    return { kind: "value", stackVersion, withAttachment };
  }
  const unanswered: ScaffoldQuestion[] = [];
  if (stackVersion === undefined) unanswered.push("stackVersion");
  if (withAttachment === undefined) unanswered.push("withAttachment");
  return { kind: "needsUserDecision", missing: unanswered };
}

export function scaffoldDecisionRequiredError(missing: ScaffoldQuestion[]): Error {
  const askStack = missing.includes("stackVersion");
  const askAttach = missing.includes("withAttachment");
  const subject =
    askStack && askAttach
      ? "표준프레임워크 버전과 첨부파일 포함 여부를"
      : askStack
        ? "표준프레임워크 버전을"
        : "첨부파일 포함 여부를";
  const actions: string[] = [];
  if (askStack) actions.push("표준프레임워크 4.3 인지 5.1 인지 물은 뒤 stackVersion 을 '4.3' 또는 '5.1' 로 지정");
  if (askAttach) actions.push("첨부파일 기능을 포함할지 물은 뒤 withAttachment 를 true 또는 false 로 지정");
  return retryAfterAction(
    `${subject} 사용자에게 확인하지 못해 아무 파일도 생성하지 않았습니다. ` +
      `사용자에게 ${actions.join("하고, ")}해 나머지 인자는 그대로 다시 호출하세요.`,
  );
}

export function scaffoldCancelledMessage(): string {
  return `사용자가 취소하여 아무 파일도 생성하지 않았습니다.${completionFooter()}`;
}
