/**
 * 첨부파일 포함 여부 결정 (egov_add_entity) — 호출자가 `withAttachment` 를 생략했을 때 MCP
 * Elicitation 으로 사용자에게 직접 확인한다. 질문을 던질 수 없는 상황(미지원 클라이언트, 시간
 * 초과, 호출 오류, 값 없는 accept)에서는 `needsUserDecision` 을 반환해 호출 AI 가 사용자에게
 * 묻고 재호출하게 한다.
 *
 * egov_scaffold_project 는 `stackVersion` 과 함께 묻기 위해 `scaffoldDecision.ts` 를 사용한다.
 */
import { detectAttachFileInfra, detectProjectStack } from "./projectDetector.js";
import { ELICIT_TIMEOUT_MS, elicitForm, type ElicitingServer } from "./elicitForm.js";
import { completionFooter, retryAfterAction } from "./toolMessages.js";

export const ATTACHMENT_ELICIT_TIMEOUT_MS = ELICIT_TIMEOUT_MS;

export type AttachmentDecision =
  | { kind: "value"; value: boolean }
  | { kind: "needsUserDecision" }
  | { kind: "cancelled" };

export async function resolveAttachmentDecision(args: {
  server: ElicitingServer;
  provided: boolean | undefined;
  supported: boolean;
  message: string;
  /** 도구 호출 취소 신호 — 취소/중단되면 질문을 걷어 내고 파일을 생성하지 않는다. */
  signal?: AbortSignal;
}): Promise<AttachmentDecision> {
  const { server, provided, supported, message, signal } = args;
  if (provided !== undefined) return { kind: "value", value: provided };
  if (!supported) return { kind: "value", value: false };

  const res = await elicitForm({
    server,
    message,
    fields: [{ name: "withAttachment", kind: "boolean", title: "첨부파일 포함" }],
    signal,
  });
  if (res.kind === "cancelled") return { kind: "cancelled" };
  if (res.kind === "declined") return { kind: "value", value: false };
  if (res.kind === "unavailable") return { kind: "needsUserDecision" };
  const value = res.values.withAttachment;
  return typeof value === "boolean" ? { kind: "value", value } : { kind: "needsUserDecision" };
}

export function describeAddEntityAttachmentPrompt(
  projectPath: string,
  entityName: string,
): { supported: boolean; message: string } {
  const base = `엔티티 '${entityName}'에 표준 첨부파일 기능을 연결할까요?`;
  try {
    const stack = detectProjectStack(projectPath);
    const supported = stack.projectType === "boot";
    if (!supported) return { supported: false, message: base };
    const present = detectAttachFileInfra(projectPath).present;
    return {
      supported: true,
      message: present
        ? base
        : `${base} 프로젝트에 첨부파일 인프라가 없어 함께 설치됩니다.`,
    };
  } catch {
    return { supported: false, message: base };
  }
}

export function attachmentDecisionRequiredError(): Error {
  return retryAfterAction(
    "첨부파일 포함 여부를 사용자에게 확인하지 못해 아무 파일도 생성하지 않았습니다. " +
      "사용자에게 첨부파일 기능을 포함할지 물은 뒤 withAttachment 를 true 또는 false 로 지정해 " +
      "나머지 인자는 그대로 다시 호출하세요.",
  );
}

export function attachmentCancelledMessage(): string {
  return `사용자가 취소하여 아무 파일도 생성하지 않았습니다.${completionFooter()}`;
}
