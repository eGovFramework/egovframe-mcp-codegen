import { describe, expect, it, vi } from "vitest";

import {
  ELICIT_TIMEOUT_MS,
  SCAFFOLD_STACK_OPTIONS,
  STACK_FIELD_NAME,
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

/** 질문을 순서대로 다르게 답하는 stub. */
function sequence(replies: Reply[]) {
  let i = 0;
  const elicitInput = vi.fn(async () => replies[i++]);
  return { server: { elicitInput } as never, elicitInput };
}

const BOOT_51 = { const: "boot-5.1", title: "표준프레임워크 5.1 (Spring Boot 3, Java 17)" };
const BOOT_43 = { const: "boot-4.3", title: "표준프레임워크 4.3 (Spring Boot 2.7, Java 8)" };
const WAR_43 = { const: "war-4.3", title: "표준프레임워크 4.3 WAR (Spring 5.3, Java 8, JSP + Tomcat)" };

const STACK_FIELD_BOOT_ONLY = { type: "string", title: "표준프레임워크 버전", oneOf: [BOOT_51, BOOT_43] };
const STACK_FIELD_ALL = { type: "string", title: "표준프레임워크 버전", oneOf: [BOOT_51, BOOT_43, WAR_43] };
const ATTACH_FIELD = { type: "boolean", title: "첨부파일 포함" };

function form(message: string, properties: Record<string, unknown>) {
  return { mode: "form", message, requestedSchema: { type: "object", properties, required: Object.keys(properties) } };
}

describe("SCAFFOLD_STACK_OPTIONS", () => {
  it("5.1 Boot, 4.3 Boot, 4.3 WAR 순서로 projectType 과 stackVersion 을 함께 담는다", () => {
    expect(STACK_FIELD_NAME).toBe("stack");
    expect(SCAFFOLD_STACK_OPTIONS).toEqual([
      { value: "boot-5.1", projectType: "boot", stackVersion: "5.1", title: "표준프레임워크 5.1 (Spring Boot 3, Java 17)" },
      { value: "boot-4.3", projectType: "boot", stackVersion: "4.3", title: "표준프레임워크 4.3 (Spring Boot 2.7, Java 8)" },
      { value: "war-4.3", projectType: "war", stackVersion: "4.3", title: "표준프레임워크 4.3 WAR (Spring 5.3, Java 8, JSP + Tomcat)" },
    ]);
  });
});

describe("resolveScaffoldDecision — 질문이 필요 없는 경우", () => {
  it("WAR 명시 시 버전과 첨부를 묻지 않고 4.3 / false 로 확정한다", async () => {
    const { server, elicitInput } = stub();
    const r = await resolveScaffoldDecision({ server, projectType: "war", stackVersion: undefined, withAttachment: undefined });
    expect(r).toEqual({ kind: "value", projectType: "war", stackVersion: "4.3", withAttachment: false });
    expect(elicitInput).not.toHaveBeenCalled();
  });

  it("WAR 에서 명시한 값은 그대로 쓴다", async () => {
    const { server } = stub();
    const r = await resolveScaffoldDecision({ server, projectType: "war", stackVersion: "4.3", withAttachment: false });
    expect(r).toEqual({ kind: "value", projectType: "war", stackVersion: "4.3", withAttachment: false });
  });

  it("Boot 에서 두 값이 모두 있으면 묻지 않는다", async () => {
    const { server, elicitInput } = stub();
    const r = await resolveScaffoldDecision({ server, projectType: "boot", stackVersion: "5.1", withAttachment: true });
    expect(r).toEqual({ kind: "value", projectType: "boot", stackVersion: "5.1", withAttachment: true });
    expect(elicitInput).not.toHaveBeenCalled();
  });

  it("projectType 을 생략해도 두 값이 모두 있으면 Boot 로 보고 묻지 않는다", async () => {
    const { server, elicitInput } = stub();
    const r = await resolveScaffoldDecision({ server, projectType: undefined, stackVersion: "4.3", withAttachment: false });
    expect(r).toEqual({ kind: "value", projectType: "boot", stackVersion: "4.3", withAttachment: false });
    expect(elicitInput).not.toHaveBeenCalled();
  });
});

describe("resolveScaffoldDecision — projectType 생략: WAR 선택지가 함께 보인다", () => {
  const base = { projectType: undefined, stackVersion: undefined, withAttachment: undefined };

  it("스택을 먼저 묻고, 선택지에 5.1 Boot / 4.3 Boot / 4.3 WAR 가 모두 있다", async () => {
    const { server, elicitInput } = sequence([
      { action: "accept", content: { stack: "boot-5.1" } },
      { action: "accept", content: { withAttachment: true } },
    ]);
    const r = await resolveScaffoldDecision({ server, ...base });
    expect(r).toEqual({ kind: "value", projectType: "boot", stackVersion: "5.1", withAttachment: true });
    expect(elicitInput).toHaveBeenCalledTimes(2);
    expect(elicitInput.mock.calls[0][0]).toEqual(
      form("이 프로젝트를 어떤 표준프레임워크 버전으로 생성할까요?", { stack: STACK_FIELD_ALL }),
    );
    expect(elicitInput.mock.calls[1][0]).toEqual(
      form("이 프로젝트에 표준 첨부파일 기능을 포함할까요?", { withAttachment: ATTACH_FIELD }),
    );
    expect(elicitInput.mock.calls[0][1]).toEqual({ timeout: ELICIT_TIMEOUT_MS });
  });

  it("4.3 WAR 를 고르면 첨부 질문으로 넘어가지 않고 WAR / 4.3 / false 로 확정한다", async () => {
    const { server, elicitInput } = stub({ reply: { action: "accept", content: { stack: "war-4.3" } } });
    const r = await resolveScaffoldDecision({ server, ...base });
    expect(r).toEqual({ kind: "value", projectType: "war", stackVersion: "4.3", withAttachment: false });
    expect(elicitInput).toHaveBeenCalledTimes(1);
  });

  it("4.3 Boot 를 고르고 첨부를 거절하면 첨부 없이 진행한다", async () => {
    const { server } = sequence([{ action: "accept", content: { stack: "boot-4.3" } }, { action: "decline" }]);
    const r = await resolveScaffoldDecision({ server, ...base });
    expect(r).toEqual({ kind: "value", projectType: "boot", stackVersion: "4.3", withAttachment: false });
  });

  it("Boot 를 고른 뒤 첨부 질문이 값 없이 accept 되면 withAttachment 만 needsUserDecision", async () => {
    const { server } = sequence([{ action: "accept", content: { stack: "boot-4.3" } }, { action: "accept" }]);
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({
      kind: "needsUserDecision",
      missing: ["withAttachment"],
    });
  });

  it("Boot 를 고른 뒤 첨부 질문에서 cancel 하면 cancelled", async () => {
    const { server } = sequence([{ action: "accept", content: { stack: "boot-5.1" } }, { action: "cancel" }]);
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({ kind: "cancelled" });
  });

  it("withAttachment 가 주어졌으면 스택만 묻고 끝낸다", async () => {
    const { server, elicitInput } = stub({ reply: { action: "accept", content: { stack: "boot-4.3" } } });
    const r = await resolveScaffoldDecision({ server, ...base, withAttachment: false });
    expect(r).toEqual({ kind: "value", projectType: "boot", stackVersion: "4.3", withAttachment: false });
    expect(elicitInput).toHaveBeenCalledTimes(1);
    expect(elicitInput.mock.calls[0][0]).toEqual(
      form("이 프로젝트를 어떤 표준프레임워크 버전으로 생성할까요?", { stack: STACK_FIELD_ALL }),
    );
  });

  it("withAttachment=true 면 WAR 는 모순이므로 Boot 두 개만 보인다", async () => {
    const { server, elicitInput } = stub({ reply: { action: "accept", content: { stack: "boot-5.1" } } });
    const r = await resolveScaffoldDecision({ server, ...base, withAttachment: true });
    expect(r).toEqual({ kind: "value", projectType: "boot", stackVersion: "5.1", withAttachment: true });
    expect(elicitInput.mock.calls[0][0]).toEqual(
      form("이 프로젝트를 어떤 표준프레임워크 버전으로 생성할까요?", { stack: STACK_FIELD_BOOT_ONLY }),
    );
  });

  it("스택 질문에 decline / cancel 하면 cancelled", async () => {
    for (const action of ["decline", "cancel"] as const) {
      const { server } = stub({ reply: { action } });
      expect(await resolveScaffoldDecision({ server, ...base })).toEqual({ kind: "cancelled" });
    }
  });

  it.each([
    ["값 없는 accept", { action: "accept" } as Reply],
    ["허용되지 않은 값", { action: "accept", content: { stack: "5.1" } } as Reply],
    ["미지원 클라이언트", "unsupported" as const],
    ["elicitInput 예외", "reject" as const],
  ])("%s → projectType·stackVersion·withAttachment 모두 needsUserDecision", async (_n, reply) => {
    const { server } = stub({ reply });
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({
      kind: "needsUserDecision",
      missing: ["projectType", "stackVersion", "withAttachment"],
    });
  });

  it("withAttachment 가 있고 스택 질문을 던질 수 없으면 projectType·stackVersion 만 남긴다", async () => {
    const { server } = stub({ reply: "unsupported" });
    expect(await resolveScaffoldDecision({ server, ...base, withAttachment: false })).toEqual({
      kind: "needsUserDecision",
      missing: ["projectType", "stackVersion"],
    });
  });
});

describe("resolveScaffoldDecision — Boot 명시, 버전만 없을 때", () => {
  const base = { projectType: "boot" as const, stackVersion: undefined, withAttachment: false };

  it("Boot 두 개만 담은 form 으로 묻는다", async () => {
    const { server, elicitInput } = stub({ reply: { action: "accept", content: { stack: "boot-4.3" } } });
    const r = await resolveScaffoldDecision({ server, ...base });
    expect(r).toEqual({ kind: "value", projectType: "boot", stackVersion: "4.3", withAttachment: false });
    expect(elicitInput).toHaveBeenCalledTimes(1);
    expect(elicitInput.mock.calls[0][0]).toEqual(form(scaffoldDecisionMessage(["stackVersion"]), { stack: STACK_FIELD_BOOT_ONLY }));
    expect(elicitInput.mock.calls[0][1]).toEqual({ timeout: ELICIT_TIMEOUT_MS });
  });

  it("accept 5.1", async () => {
    const { server } = stub({ reply: { action: "accept", content: { stack: "boot-5.1" } } });
    const r = await resolveScaffoldDecision({ server, ...base });
    expect(r).toEqual({ kind: "value", projectType: "boot", stackVersion: "5.1", withAttachment: false });
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
    ["허용되지 않은 값", { action: "accept", content: { stack: "5.0" } } as Reply],
    ["Boot 명시 시 WAR 값은 허용되지 않는다", { action: "accept", content: { stack: "war-4.3" } } as Reply],
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
    expect(r).toEqual({ kind: "value", projectType: "boot", stackVersion: "4.3", withAttachment: true });
    expect(elicitInput.mock.calls[0][0]).toEqual(
      form("이 프로젝트에 표준 첨부파일 기능을 포함할까요?", { withAttachment: ATTACH_FIELD }),
    );
  });

  it("decline 은 첨부 없이 진행한다 (기존 동작 유지)", async () => {
    const { server } = stub({ reply: { action: "decline" } });
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({
      kind: "value",
      projectType: "boot",
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

describe("resolveScaffoldDecision — Boot 명시, 둘 다 없을 때", () => {
  const base = { projectType: "boot" as const, stackVersion: undefined, withAttachment: undefined };

  it("form 하나에 두 항목을 담아 한 번만 묻는다", async () => {
    const { server, elicitInput } = stub({
      reply: { action: "accept", content: { stack: "boot-5.1", withAttachment: false } },
    });
    const r = await resolveScaffoldDecision({ server, ...base });
    expect(r).toEqual({ kind: "value", projectType: "boot", stackVersion: "5.1", withAttachment: false });
    expect(elicitInput).toHaveBeenCalledTimes(1);
    expect(elicitInput.mock.calls[0][0]).toEqual(
      form(scaffoldDecisionMessage(["stackVersion", "withAttachment"]), {
        stack: STACK_FIELD_BOOT_ONLY,
        withAttachment: ATTACH_FIELD,
      }),
    );
  });

  it("decline 은 cancelled (버전을 정할 수 없음)", async () => {
    const { server } = stub({ reply: { action: "decline" } });
    expect(await resolveScaffoldDecision({ server, ...base })).toEqual({ kind: "cancelled" });
  });

  it("한 항목만 답하면 답하지 않은 항목만 needsUserDecision 에 남긴다", async () => {
    const { server } = stub({ reply: { action: "accept", content: { stack: "boot-4.3" } } });
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
    const { server, elicitInput } = stub({ reply: { action: "accept", content: { stack: "boot-5.1" } } });
    const ac = new AbortController();
    await resolveScaffoldDecision({ server, projectType: "boot", stackVersion: undefined, withAttachment: false, signal: ac.signal });
    expect(elicitInput.mock.calls[0][1]).toEqual({ timeout: ELICIT_TIMEOUT_MS, signal: ac.signal });
  });

  it("질문 중 취소되면 늦은 accept 가 와도 cancelled", async () => {
    const ac = new AbortController();
    const elicitInput = vi.fn(async () => {
      ac.abort();
      return { action: "accept", content: { stack: "boot-5.1" } };
    });
    const r = await resolveScaffoldDecision({
      server: { elicitInput } as never,
      projectType: undefined,
      stackVersion: undefined,
      withAttachment: undefined,
      signal: ac.signal,
    });
    expect(r).toEqual({ kind: "cancelled" });
    expect(elicitInput).toHaveBeenCalledTimes(1);
  });
});

describe("메시지", () => {
  it("질문 문구는 빠진 항목에 따라 달라진다", () => {
    expect(scaffoldDecisionMessage(["stackVersion"])).toBe("이 프로젝트를 어떤 표준프레임워크 버전으로 생성할까요?");
    expect(scaffoldDecisionMessage(["withAttachment"])).toBe("이 프로젝트에 표준 첨부파일 기능을 포함할까요?");
    expect(scaffoldDecisionMessage(["stackVersion", "withAttachment"])).toBe(
      "이 프로젝트의 표준프레임워크 버전과 표준 첨부파일 기능 포함 여부를 선택해 주세요.",
    );
  });

  it("재호출 안내 오류는 빠진 인자를 모두 지명한다", () => {
    const both = scaffoldDecisionRequiredError(["stackVersion", "withAttachment"]).message;
    expect(both).toMatch(/^\[조치 후 재시도 가능\]/);
    expect(both).toContain("표준프레임워크 버전과 첨부파일 포함 여부를");
    expect(both).toContain("아무 파일도 생성하지 않았습니다");
    expect(both).toContain("stackVersion");
    expect(both).toContain("'4.3'");
    expect(both).toContain("'5.1'");
    expect(both).toContain("withAttachment");
    expect(both).not.toContain("projectType");

    const stackOnly = scaffoldDecisionRequiredError(["stackVersion"]).message;
    expect(stackOnly).toContain("표준프레임워크 버전을");
    expect(stackOnly).toContain("stackVersion");
    expect(stackOnly).not.toContain("withAttachment");

    const attachOnly = scaffoldDecisionRequiredError(["withAttachment"]).message;
    expect(attachOnly).toContain("첨부파일 포함 여부를");
    expect(attachOnly).toContain("withAttachment");
    expect(attachOnly).not.toContain("stackVersion");
  });

  it("projectType 까지 빠졌으면 Boot/WAR 선택지와 projectType 지정을 함께 안내한다", () => {
    const all = scaffoldDecisionRequiredError(["projectType", "stackVersion", "withAttachment"]).message;
    expect(all).toContain("프로젝트 유형과 표준프레임워크 버전과 첨부파일 포함 여부를");
    expect(all).toContain("5.1 Boot, 4.3 Boot, 4.3 WAR");
    expect(all).toContain("projectType 을 'boot' 또는 'war'");
    expect(all).toContain("stackVersion 을 '4.3' 또는 '5.1'");
    expect(all).toContain("withAttachment");

    const typeAndStack = scaffoldDecisionRequiredError(["projectType", "stackVersion"]).message;
    expect(typeAndStack).toContain("프로젝트 유형과 표준프레임워크 버전을");
    expect(typeAndStack).not.toContain("withAttachment");
  });
});
