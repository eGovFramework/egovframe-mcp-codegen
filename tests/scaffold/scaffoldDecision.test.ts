import { describe, expect, it, vi } from "vitest";

import {
  ELICIT_TIMEOUT_MS,
  SCAFFOLD_STACK_OPTIONS,
  resolveScaffoldDecision,
  scaffoldDecisionMessage,
  scaffoldDecisionRequiredError,
} from "../../src/utils/scaffold/scaffoldDecision.js";

type Reply = { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> };

function stub(opts: { reply?: Reply | "reject" | "unsupported" } = {}) {
  const elicitInput = vi.fn(async () => {
    if (opts.reply === "reject") throw new Error("boom");
    if (opts.reply === "unsupported") throw new Error("Client does not support form elicitation.");
    return opts.reply as Reply;
  });
  return { server: { elicitInput } as never, elicitInput };
}

const STACK_FIELD = {
  type: "string",
  title: "표준프레임워크 버전",
  oneOf: [
    { const: "5.1", title: "표준프레임워크 5.1 (Spring Boot 3, Java 17)" },
    { const: "4.3", title: "표준프레임워크 4.3 (Spring Boot 2.7, Java 8)" },
  ],
};
const ATTACH_FIELD = { type: "boolean", title: "첨부파일 포함" };

describe("SCAFFOLD_STACK_OPTIONS", () => {
  it("5.1 을 먼저, 4.3 을 다음에 두고 사용자 요구 제목을 쓴다", () => {
    expect(SCAFFOLD_STACK_OPTIONS).toEqual([
      { value: "5.1", title: "표준프레임워크 5.1 (Spring Boot 3, Java 17)" },
      { value: "4.3", title: "표준프레임워크 4.3 (Spring Boot 2.7, Java 8)" },
    ]);
  });
});

describe("resolveScaffoldDecision — 질문이 필요 없는 경우", () => {
  it("WAR 는 버전과 첨부를 묻지 않고 4.3 / false 로 확정한다", async () => {
    const { server, elicitInput } = stub();
    const r = await resolveScaffoldDecision({
      server,
      projectType: "war",
      stackVersion: undefined,
      withAttachment: undefined,
    });
    expect(r).toEqual({ kind: "value", stackVersion: "4.3", withAttachment: false });
    expect(elicitInput).not.toHaveBeenCalled();
  });

  it("WAR 에서 명시한 값은 그대로 쓴다", async () => {
    const { server } = stub();
    const r = await resolveScaffoldDecision({
      server,
      projectType: "war",
      stackVersion: "4.3",
      withAttachment: false,
    });
    expect(r).toEqual({ kind: "value", stackVersion: "4.3", withAttachment: false });
  });

  it("Boot 에서 두 값이 모두 있으면 묻지 않는다", async () => {
    const { server, elicitInput } = stub();
    const r = await resolveScaffoldDecision({
      server,
      projectType: "boot",
      stackVersion: "5.1",
      withAttachment: true,
    });
    expect(r).toEqual({ kind: "value", stackVersion: "5.1", withAttachment: true });
    expect(elicitInput).not.toHaveBeenCalled();
  });
});

describe("resolveScaffoldDecision — 버전만 없을 때", () => {
  const base = { projectType: "boot" as const, stackVersion: undefined, withAttachment: false };

  it("버전 선택지 하나만 담은 form 으로 묻는다", async () => {
    const { server, elicitInput } = stub({ reply: { action: "accept", content: { stackVersion: "4.3" } } });
    const r = await resolveScaffoldDecision({ server, ...base });
    expect(r).toEqual({ kind: "value", stackVersion: "4.3", withAttachment: false });
    expect(elicitInput).toHaveBeenCalledTimes(1);
    expect(elicitInput.mock.calls[0][0]).toEqual({
      mode: "form",
      message: scaffoldDecisionMessage(["stackVersion"]),
      requestedSchema: {
        type: "object",
        properties: { stackVersion: STACK_FIELD },
        required: ["stackVersion"],
      },
    });
    expect(elicitInput.mock.calls[0][1]).toEqual({ timeout: ELICIT_TIMEOUT_MS });
  });

  it("accept 5.1", async () => {
    const { server } = stub({ reply: { action: "accept", content: { stackVersion: "5.1" } } });
    const r = await resolveScaffoldDecision({ server, ...base });
    expect(r).toEqual({ kind: "value", stackVersion: "5.1", withAttachment: false });
  });

  it("decline 은 버전을 정할 수 없으므로 cancelled", async () => {
    const { server } = stub({ reply: { action: "decline" } });
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({ kind: "cancelled" });
  });

  it("cancel 은 cancelled", async () => {
    const { server } = stub({ reply: { action: "cancel" } });
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({ kind: "cancelled" });
  });

  it.each([
    ["값 없는 accept", { action: "accept" } as Reply],
    ["허용되지 않은 값", { action: "accept", content: { stackVersion: "5.0" } } as Reply],
    ["미지원 클라이언트", "unsupported" as const],
    ["elicitInput 예외", "reject" as const],
  ])("%s → needsUserDecision(stackVersion)", async (_n, reply) => {
    const { server } = stub({ reply });
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({
      kind: "needsUserDecision",
      missing: ["stackVersion"],
    });
  });
});

describe("resolveScaffoldDecision — 첨부 여부만 없을 때", () => {
  const base = { projectType: "boot" as const, stackVersion: "4.3" as const, withAttachment: undefined };

  it("기존 첨부파일 질문 문구와 boolean 필드로 묻는다", async () => {
    const { server, elicitInput } = stub({ reply: { action: "accept", content: { withAttachment: true } } });
    const r = await resolveScaffoldDecision({ server, ...base });
    expect(r).toEqual({ kind: "value", stackVersion: "4.3", withAttachment: true });
    expect(elicitInput.mock.calls[0][0]).toEqual({
      mode: "form",
      message: "이 프로젝트에 표준 첨부파일 기능을 포함할까요?",
      requestedSchema: {
        type: "object",
        properties: { withAttachment: ATTACH_FIELD },
        required: ["withAttachment"],
      },
    });
  });

  it("decline 은 첨부 없이 진행한다 (기존 동작 유지)", async () => {
    const { server } = stub({ reply: { action: "decline" } });
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({
      kind: "value",
      stackVersion: "4.3",
      withAttachment: false,
    });
  });

  it("값 없는 accept → needsUserDecision(withAttachment)", async () => {
    const { server } = stub({ reply: { action: "accept" } });
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({
      kind: "needsUserDecision",
      missing: ["withAttachment"],
    });
  });
});

describe("resolveScaffoldDecision — 둘 다 없을 때", () => {
  const base = { projectType: "boot" as const, stackVersion: undefined, withAttachment: undefined };

  it("form 하나에 두 항목을 담아 한 번만 묻는다", async () => {
    const { server, elicitInput } = stub({
      reply: { action: "accept", content: { stackVersion: "5.1", withAttachment: false } },
    });
    const r = await resolveScaffoldDecision({ server, ...base });
    expect(r).toEqual({ kind: "value", stackVersion: "5.1", withAttachment: false });
    expect(elicitInput).toHaveBeenCalledTimes(1);
    expect(elicitInput.mock.calls[0][0]).toEqual({
      mode: "form",
      message: scaffoldDecisionMessage(["stackVersion", "withAttachment"]),
      requestedSchema: {
        type: "object",
        properties: { stackVersion: STACK_FIELD, withAttachment: ATTACH_FIELD },
        required: ["stackVersion", "withAttachment"],
      },
    });
  });

  it("decline 은 cancelled (버전을 정할 수 없음)", async () => {
    const { server } = stub({ reply: { action: "decline" } });
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({ kind: "cancelled" });
  });

  it("한 항목만 답하면 답하지 않은 항목만 needsUserDecision 에 남긴다", async () => {
    const { server } = stub({ reply: { action: "accept", content: { stackVersion: "4.3" } } });
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({
      kind: "needsUserDecision",
      missing: ["withAttachment"],
    });
  });

  it("미지원 클라이언트는 두 항목 모두 needsUserDecision", async () => {
    const { server } = stub({ reply: "unsupported" });
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({
      kind: "needsUserDecision",
      missing: ["stackVersion", "withAttachment"],
    });
  });
});

describe("resolveScaffoldDecision — signal", () => {
  it("signal 을 elicitInput 옵션으로 전달한다", async () => {
    const { server, elicitInput } = stub({ reply: { action: "accept", content: { stackVersion: "5.1" } } });
    const ac = new AbortController();
    await resolveScaffoldDecision({
      server,
      projectType: "boot",
      stackVersion: undefined,
      withAttachment: false,
      signal: ac.signal,
    });
    expect(elicitInput.mock.calls[0][1]).toEqual({ timeout: ELICIT_TIMEOUT_MS, signal: ac.signal });
  });

  it("질문 중 취소되면 늦은 accept 가 와도 cancelled", async () => {
    const ac = new AbortController();
    const elicitInput = vi.fn(async () => {
      ac.abort();
      return { action: "accept", content: { stackVersion: "5.1" } };
    });
    const r = await resolveScaffoldDecision({
      server: { elicitInput } as never,
      projectType: "boot",
      stackVersion: undefined,
      withAttachment: false,
      signal: ac.signal,
    });
    expect(r).toEqual({ kind: "cancelled" });
  });
});

describe("메시지", () => {
  it("질문 문구는 빠진 항목에 따라 달라진다", () => {
    expect(scaffoldDecisionMessage(["stackVersion"])).toBe(
      "이 프로젝트를 어떤 표준프레임워크 버전으로 생성할까요?",
    );
    expect(scaffoldDecisionMessage(["withAttachment"])).toBe("이 프로젝트에 표준 첨부파일 기능을 포함할까요?");
    expect(scaffoldDecisionMessage(["stackVersion", "withAttachment"])).toBe(
      "이 프로젝트의 표준프레임워크 버전과 표준 첨부파일 기능 포함 여부를 선택해 주세요.",
    );
  });

  it("재호출 안내 오류는 빠진 인자를 모두 지명한다", () => {
    const both = scaffoldDecisionRequiredError(["stackVersion", "withAttachment"]).message;
    expect(both).toMatch(/^\[조치 후 재시도 가능\]/);
    expect(both).toContain("아무 파일도 생성하지 않았습니다");
    expect(both).toContain("stackVersion");
    expect(both).toContain("'4.3'");
    expect(both).toContain("'5.1'");
    expect(both).toContain("withAttachment");

    const stackOnly = scaffoldDecisionRequiredError(["stackVersion"]).message;
    expect(stackOnly).toContain("stackVersion");
    expect(stackOnly).not.toContain("withAttachment");

    const attachOnly = scaffoldDecisionRequiredError(["withAttachment"]).message;
    expect(attachOnly).toContain("withAttachment");
    expect(attachOnly).not.toContain("stackVersion");
  });
});
