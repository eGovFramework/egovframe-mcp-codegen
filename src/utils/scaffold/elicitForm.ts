/**
 * MCP Elicitation(form 모드) 공용 헬퍼.
 *
 * 도구가 생략된 인자를 사용자에게 직접 물을 때 쓴다. 질문 항목(boolean / 단일 선택)을 받아
 * `requestedSchema` 를 만들고, 응답을 항목별로 검증해 돌려준다. 질문을 던질 수 없는 상황
 * (form capability 가 없는 클라이언트, 시간 초과, 호출 오류)은 `unavailable` 로 통일해,
 * 호출 측이 "AI 가 사용자에게 묻고 다시 호출" 경로로 넘길 수 있게 한다.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export const ELICIT_TIMEOUT_MS = 60_000;

// elicitInput 은 저수준 Server 에만 있다. deprecated 인 Server 를 직접 참조하지 않도록 McpServer.server 로 인덱싱한다.
export type ElicitingServer = Pick<McpServer["server"], "elicitInput">;

export type FormField =
  | { name: string; kind: "boolean"; title: string }
  | {
      name: string;
      kind: "select";
      title: string;
      options: ReadonlyArray<{ readonly value: string; readonly title: string }>;
    };

export type FormResult =
  /** 사용자가 accept. `values` 에는 항목별로 검증을 통과한 값만 들어 있다 (빠진 항목은 키 없음). */
  | { kind: "accepted"; values: Record<string, boolean | string> }
  | { kind: "declined" }
  | { kind: "cancelled" }
  /** 질문을 던질 수 없었다 — 미지원 클라이언트, 시간 초과, 호출 오류. */
  | { kind: "unavailable" };

function fieldSchema(field: FormField): Record<string, unknown> {
  if (field.kind === "boolean") return { type: "boolean", title: field.title };
  return {
    type: "string",
    title: field.title,
    oneOf: field.options.map((o) => ({ const: o.value, title: o.title })),
  };
}

function readField(field: FormField, raw: unknown): boolean | string | undefined {
  if (field.kind === "boolean") return typeof raw === "boolean" ? raw : undefined;
  return typeof raw === "string" && field.options.some((o) => o.value === raw) ? raw : undefined;
}

export async function elicitForm(args: {
  server: ElicitingServer;
  message: string;
  fields: FormField[];
  /** 도구 호출 취소 신호 — 취소/중단되면 질문을 걷어 내고 아무 것도 생성하지 않는다. */
  signal?: AbortSignal;
}): Promise<FormResult> {
  const { server, message, fields, signal } = args;
  const properties: Record<string, unknown> = {};
  for (const f of fields) properties[f.name] = fieldSchema(f);

  // form capability 가 없는 클라이언트에는 SDK 가 요청을 보내기 전에 예외를 던지며, 아래 catch 에서 처리한다.
  try {
    const res = await server.elicitInput(
      {
        mode: "form",
        message,
        requestedSchema: {
          type: "object",
          properties,
          required: fields.map((f) => f.name),
        },
      } as Parameters<ElicitingServer["elicitInput"]>[0],
      { timeout: ELICIT_TIMEOUT_MS, ...(signal ? { signal } : {}) },
    );
    // 사용자가 늦게 답했더라도 호출이 이미 취소되었다면 아무 것도 생성하지 않는다.
    if (signal?.aborted) return { kind: "cancelled" };
    if (res.action === "cancel") return { kind: "cancelled" };
    if (res.action === "decline") return { kind: "declined" };
    const content = (res.content ?? {}) as Record<string, unknown>;
    const values: Record<string, boolean | string> = {};
    for (const f of fields) {
      const v = readField(f, content[f.name]);
      if (v !== undefined) values[f.name] = v;
    }
    return { kind: "accepted", values };
  } catch {
    if (signal?.aborted) return { kind: "cancelled" };
    return { kind: "unavailable" };
  }
}
