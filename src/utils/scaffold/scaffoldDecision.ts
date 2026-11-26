/**
 * egov_scaffold_project 의 생략 인자 결정 — `stackVersion`(필요하면 `projectType` 까지) 과
 * `withAttachment` 를 호출자가 생략했을 때 MCP Elicitation form 으로 사용자에게 묻는다.
 *
 * - WAR 는 4.3 만 지원하고 첨부파일을 지원하지 않으므로 질문 없이 확정한다.
 * - 스택 질문의 선택지는 "5.1 Boot / 4.3 Boot / 4.3 WAR" 다. 호출자가 `projectType='boot'` 를
 *   명시했거나 `withAttachment=true` 를 요구했으면 WAR 는 모순이므로 Boot 두 개만 보인다.
 * - WAR 가 선택지에 있을 때는 스택을 먼저 묻고, Boot 를 고른 경우에만 첨부 여부를 이어서 묻는다
 *   (WAR 를 고르면 첨부 질문으로 넘어가지 않는다). WAR 가 선택지에 없으면 두 항목을 form 하나에
 *   담아 한 번만 묻는다.
 * - 질문을 던질 수 없는 상황(미지원 클라이언트, 시간 초과, 호출 오류, 값 없는 accept)에서는
 *   `needsUserDecision` 과 함께 답을 받지 못한 항목을 돌려줘, 호출 AI 가 사용자에게 묻고
 *   그 인자만 채워 재호출하게 한다.
 */
import type { StackVersion } from "./stackMatrix.js";
import { ELICIT_TIMEOUT_MS, elicitForm, type ElicitingServer, type FormField } from "./elicitForm.js";
import { completionFooter, retryAfterAction } from "./toolMessages.js";

export { ELICIT_TIMEOUT_MS };

export type ScaffoldProjectType = "boot" | "war";

/** 스택 질문의 선택지 값. projectType 과 stackVersion 을 함께 담는다. */
export type StackChoice = "boot-5.1" | "boot-4.3" | "war-4.3";

export interface StackOption {
  readonly value: StackChoice;
  readonly projectType: ScaffoldProjectType;
  readonly stackVersion: StackVersion;
  readonly title: string;
}

export const SCAFFOLD_STACK_OPTIONS: ReadonlyArray<StackOption> = [
  { value: "boot-5.1", projectType: "boot", stackVersion: "5.1", title: "표준프레임워크 5.1 (Spring Boot 3, Java 17)" },
  { value: "boot-4.3", projectType: "boot", stackVersion: "4.3", title: "표준프레임워크 4.3 (Spring Boot 2.7, Java 8)" },
  { value: "war-4.3", projectType: "war", stackVersion: "4.3", title: "표준프레임워크 4.3 WAR (Spring 5.3, Java 8, JSP + Tomcat)" },
];

/** Elicitation form 에서 스택 선택지를 담는 필드 이름. */
export const STACK_FIELD_NAME = "stack";

/** 재호출 안내에서 지명하는 도구 인자. */
export type ScaffoldQuestion = "projectType" | "stackVersion" | "withAttachment";

export type ScaffoldDecision =
  | { kind: "value"; projectType: ScaffoldProjectType; stackVersion: StackVersion; withAttachment: boolean }
  | { kind: "needsUserDecision"; missing: ScaffoldQuestion[] }
  | { kind: "cancelled" };

function stackField(options: ReadonlyArray<StackOption>): FormField {
  return { name: STACK_FIELD_NAME, kind: "select", title: "표준프레임워크 버전", options };
}

const ATTACH_FIELD: FormField = { name: "withAttachment", kind: "boolean", title: "첨부파일 포함" };

export function scaffoldDecisionMessage(missing: ReadonlyArray<"stackVersion" | "withAttachment">): string {
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
  /** 호출자가 명시한 projectType. 생략(undefined)이면 스택 질문에 4.3 WAR 선택지가 함께 보인다. */
  projectType: ScaffoldProjectType | undefined;
  stackVersion: StackVersion | undefined;
  withAttachment: boolean | undefined;
  signal?: AbortSignal;
}): Promise<ScaffoldDecision> {
  const { server, signal } = args;

  // WAR 는 4.3 전용이고 첨부파일을 지원하지 않는다 — 물을 것이 없다.
  if (args.projectType === "war") {
    return {
      kind: "value",
      projectType: "war",
      stackVersion: args.stackVersion ?? "4.3",
      withAttachment: args.withAttachment ?? false,
    };
  }

  const askStack = args.stackVersion === undefined;
  const askAttach = args.withAttachment === undefined;
  if (!askStack && !askAttach) {
    return { kind: "value", projectType: "boot", stackVersion: args.stackVersion!, withAttachment: args.withAttachment! };
  }

  // 호출자가 Boot 를 명시했거나 첨부파일을 요구했으면 WAR 는 모순이므로 선택지에서 뺀다.
  const warPossible = args.projectType === undefined && args.withAttachment !== true;
  const options = warPossible ? SCAFFOLD_STACK_OPTIONS : SCAFFOLD_STACK_OPTIONS.filter((o) => o.projectType === "boot");
  const stackArgs: ScaffoldQuestion[] = warPossible ? ["projectType", "stackVersion"] : ["stackVersion"];

  if (askStack && warPossible) {
    // WAR 를 고를 수 있으면 스택을 먼저 묻는다. WAR 면 첨부 질문 없이 끝낸다.
    const res = await elicitForm({ server, message: scaffoldDecisionMessage(["stackVersion"]), fields: [stackField(options)], signal });
    if (res.kind === "cancelled" || res.kind === "declined") return { kind: "cancelled" };
    const chosen = res.kind === "accepted" ? findOption(options, res.values[STACK_FIELD_NAME]) : undefined;
    if (chosen === undefined) {
      return { kind: "needsUserDecision", missing: [...stackArgs, ...(askAttach ? (["withAttachment"] as const) : [])] };
    }
    if (chosen.projectType === "war") {
      return { kind: "value", projectType: "war", stackVersion: chosen.stackVersion, withAttachment: false };
    }
    if (!askAttach) {
      return { kind: "value", projectType: "boot", stackVersion: chosen.stackVersion, withAttachment: args.withAttachment! };
    }
    return askAttachmentOnly({ server, signal, stackVersion: chosen.stackVersion });
  }

  if (!askStack) {
    return askAttachmentOnly({ server, signal, stackVersion: args.stackVersion! });
  }

  // Boot 로 정해져 있다 — 생략된 항목을 form 하나에 담아 한 번만 묻는다.
  const missing: Array<"stackVersion" | "withAttachment"> = ["stackVersion", ...(askAttach ? (["withAttachment"] as const) : [])];
  const fields: FormField[] = [stackField(options), ...(askAttach ? [ATTACH_FIELD] : [])];
  const res = await elicitForm({ server, message: scaffoldDecisionMessage(missing), fields, signal });

  if (res.kind === "cancelled") return { kind: "cancelled" };
  if (res.kind === "unavailable") return { kind: "needsUserDecision", missing };
  // 버전은 거절로 정할 수 없다 → 아무 파일도 생성하지 않는다.
  if (res.kind === "declined") return { kind: "cancelled" };

  const chosen = findOption(options, res.values[STACK_FIELD_NAME]);
  const withAttachment = (res.values.withAttachment as boolean | undefined) ?? args.withAttachment;
  if (chosen !== undefined && withAttachment !== undefined) {
    return { kind: "value", projectType: "boot", stackVersion: chosen.stackVersion, withAttachment };
  }
  const unanswered: ScaffoldQuestion[] = [];
  if (chosen === undefined) unanswered.push("stackVersion");
  if (withAttachment === undefined) unanswered.push("withAttachment");
  return { kind: "needsUserDecision", missing: unanswered };
}

function findOption(options: ReadonlyArray<StackOption>, raw: unknown): StackOption | undefined {
  return options.find((o) => o.value === raw);
}

/** Boot 로 정해진 뒤 첨부 여부만 묻는다. decline 은 첨부 없음으로 본다. */
async function askAttachmentOnly(args: {
  server: ElicitingServer;
  signal?: AbortSignal;
  stackVersion: StackVersion;
}): Promise<ScaffoldDecision> {
  const res = await elicitForm({
    server: args.server,
    message: scaffoldDecisionMessage(["withAttachment"]),
    fields: [ATTACH_FIELD],
    signal: args.signal,
  });
  if (res.kind === "cancelled") return { kind: "cancelled" };
  if (res.kind === "unavailable") return { kind: "needsUserDecision", missing: ["withAttachment"] };
  if (res.kind === "declined") {
    return { kind: "value", projectType: "boot", stackVersion: args.stackVersion, withAttachment: false };
  }
  const withAttachment = res.values.withAttachment as boolean | undefined;
  if (withAttachment === undefined) return { kind: "needsUserDecision", missing: ["withAttachment"] };
  return { kind: "value", projectType: "boot", stackVersion: args.stackVersion, withAttachment };
}

export function scaffoldDecisionRequiredError(missing: ScaffoldQuestion[]): Error {
  const askType = missing.includes("projectType");
  const askStack = missing.includes("stackVersion");
  const askAttach = missing.includes("withAttachment");
  const parts: string[] = [];
  if (askStack) parts.push(askType ? "프로젝트 유형과 표준프레임워크 버전" : "표준프레임워크 버전");
  if (askAttach) parts.push("첨부파일 포함 여부");
  const subject = parts.join("과 ") + (askAttach ? "를" : "을");
  const actions: string[] = [];
  if (askStack) {
    actions.push(
      askType
        ? "표준프레임워크 5.1 Boot, 4.3 Boot, 4.3 WAR 중 어느 것인지 물은 뒤 projectType 을 'boot' 또는 'war' 로, stackVersion 을 '4.3' 또는 '5.1' 로 지정"
        : "표준프레임워크 4.3 인지 5.1 인지 물은 뒤 stackVersion 을 '4.3' 또는 '5.1' 로 지정",
    );
  }
  if (askAttach) actions.push("첨부파일 기능을 포함할지 물은 뒤 withAttachment 를 true 또는 false 로 지정");
  return retryAfterAction(
    `${subject} 사용자에게 확인하지 못해 아무 파일도 생성하지 않았습니다. ` +
      `사용자에게 ${actions.join("하고, ")}해 나머지 인자는 그대로 다시 호출하세요.`,
  );
}

export function scaffoldCancelledMessage(): string {
  return `사용자가 취소하여 아무 파일도 생성하지 않았습니다.${completionFooter()}`;
}
