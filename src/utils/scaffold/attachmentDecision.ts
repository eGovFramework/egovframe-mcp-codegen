/**
 * 첨부파일 포함 여부 결정 — 호출자가 `withAttachment` 를 생략했을 때 MCP Elicitation 으로
 * 사용자에게 직접 확인한다. 질문을 던질 수 없는 상황(미지원 클라이언트, 시간 초과, 호출 오류,
 * 값 없는 accept)에서는 `needsUserDecision` 을 반환해 호출 AI 가 사용자에게 묻고 재호출하게 한다.
 */
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { detectAttachFileInfra, detectProjectStack } from "./projectDetector.js";
import { completionFooter, retryAfterAction } from "./toolMessages.js";

export const ATTACHMENT_ELICIT_TIMEOUT_MS = 120_000;

export type AttachmentDecision =
  | { kind: "value"; value: boolean }
  | { kind: "needsUserDecision" }
  | { kind: "cancelled" };

type ElicitingServer = Pick<Server, "getClientCapabilities" | "elicitInput">;

export async function resolveAttachmentDecision(args: {
  server: ElicitingServer;
  provided: boolean | undefined;
  supported: boolean;
  message: string;
}): Promise<AttachmentDecision> {
  const { server, provided, supported, message } = args;
  if (provided !== undefined) return { kind: "value", value: provided };
  if (!supported) return { kind: "value", value: false };
  if (!server.getClientCapabilities()?.elicitation?.form) {
    return { kind: "needsUserDecision" };
  }

  try {
    const res = await server.elicitInput(
      {
        message,
        requestedSchema: {
          type: "object",
          properties: {
            withAttachment: { type: "boolean", title: "첨부파일 포함" },
          },
          required: ["withAttachment"],
        },
      },
      { timeout: ATTACHMENT_ELICIT_TIMEOUT_MS },
    );
    if (res.action === "cancel") return { kind: "cancelled" };
    if (res.action === "decline") return { kind: "value", value: false };
    const value = res.content?.withAttachment;
    return typeof value === "boolean"
      ? { kind: "value", value }
      : { kind: "needsUserDecision" };
  } catch {
    return { kind: "needsUserDecision" };
  }
}

export function describeScaffoldAttachmentPrompt(args: {
  projectType?: "boot" | "war";
  stackVersion?: "4.3" | "5.0";
}): { supported: boolean; message: string } {
  const projectType = args.projectType ?? "boot";
  const stackVersion = args.stackVersion ?? "5.0";
  return {
    supported: projectType === "boot" && stackVersion === "5.0",
    message: "이 프로젝트에 표준 첨부파일 기능을 포함할까요?",
  };
}

export function describeAddEntityAttachmentPrompt(
  projectPath: string,
  entityName: string,
): { supported: boolean; message: string } {
  const base = `엔티티 '${entityName}'에 표준 첨부파일 기능을 연결할까요?`;
  try {
    const stack = detectProjectStack(projectPath);
    const supported = stack.projectType === "boot" && stack.stackVersion === "5.0";
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
