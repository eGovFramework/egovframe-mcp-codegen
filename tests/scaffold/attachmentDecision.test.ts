import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import {
  ATTACHMENT_ELICIT_TIMEOUT_MS,
  describeAddEntityAttachmentPrompt,
  describeScaffoldAttachmentPrompt,
  resolveAttachmentDecision,
} from "../../src/utils/scaffold/attachmentDecision.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";
import { egovAddAttachFileInfrastructure } from "../../src/tools/egovAddAttachFileInfrastructure.js";

type Reply = { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> };

function stub(opts: { reply?: Reply | "reject" | "unsupported" }) {
  const elicitInput = vi.fn(async () => {
    if (opts.reply === "reject") throw new Error("boom");
    // SDK 1.29 는 form capability 가 없는 클라이언트에 요청을 보내기 전에 이 예외를 던진다.
    if (opts.reply === "unsupported") throw new Error("Client does not support form elicitation.");
    return opts.reply as Reply;
  });
  return { server: { elicitInput } as never, elicitInput };
}

const cases: Array<{
  name: string;
  provided: boolean | undefined;
  supported: boolean;
  reply?: Reply | "reject" | "unsupported";
  expected: unknown;
  calls: number;
}> = [
  { name: "true 명시", provided: true, supported: true, expected: { kind: "value", value: true }, calls: 0 },
  { name: "false 명시", provided: false, supported: true, expected: { kind: "value", value: false }, calls: 0 },
  { name: "미지원 스택", provided: undefined, supported: false, expected: { kind: "value", value: false }, calls: 0 },
  { name: "미지원 클라이언트 (SDK 예외)", provided: undefined, supported: true, reply: "unsupported", expected: { kind: "needsUserDecision" }, calls: 1 },
  { name: "accept true", provided: undefined, supported: true, reply: { action: "accept", content: { withAttachment: true } }, expected: { kind: "value", value: true }, calls: 1 },
  { name: "accept false", provided: undefined, supported: true, reply: { action: "accept", content: { withAttachment: false } }, expected: { kind: "value", value: false }, calls: 1 },
  { name: "decline", provided: undefined, supported: true, reply: { action: "decline" }, expected: { kind: "value", value: false }, calls: 1 },
  { name: "cancel", provided: undefined, supported: true, reply: { action: "cancel" }, expected: { kind: "cancelled" }, calls: 1 },
  { name: "accept 인데 content 없음", provided: undefined, supported: true, reply: { action: "accept" }, expected: { kind: "needsUserDecision" }, calls: 1 },
  { name: "elicitInput 예외", provided: undefined, supported: true, reply: "reject", expected: { kind: "needsUserDecision" }, calls: 1 },
];

describe("resolveAttachmentDecision", () => {
  it.each(cases)("$name", async (c) => {
    const { server, elicitInput } = stub({ reply: c.reply });
    const result = await resolveAttachmentDecision({
      server,
      provided: c.provided,
      supported: c.supported,
      message: "질문",
    });
    expect(result).toEqual(c.expected);
    expect(elicitInput).toHaveBeenCalledTimes(c.calls);
    if (c.calls > 0) {
      expect(elicitInput.mock.calls[0][1]).toEqual({ timeout: ATTACHMENT_ELICIT_TIMEOUT_MS });
      expect(elicitInput.mock.calls[0][1]).toEqual({ timeout: 120000 });
    }
  });
});

describe("resolveAttachmentDecision — signal", () => {
  it("signal 을 elicitInput 옵션으로 전달한다", async () => {
    const { server, elicitInput } = stub({
      reply: { action: "accept", content: { withAttachment: true } },
    });
    const ac = new AbortController();
    await resolveAttachmentDecision({
      server,
      provided: undefined,
      supported: true,
      message: "질문",
      signal: ac.signal,
    });
    expect(elicitInput.mock.calls[0][1]).toEqual({ timeout: 120000, signal: ac.signal });
  });

  it("질문 중 취소되면 늦은 accept 응답이 와도 cancelled 를 반환한다", async () => {
    const ac = new AbortController();
    const elicitInput = vi.fn(async () => {
      ac.abort();
      return { action: "accept", content: { withAttachment: true } };
    });
    const result = await resolveAttachmentDecision({
      server: { elicitInput } as never,
      provided: undefined,
      supported: true,
      message: "질문",
      signal: ac.signal,
    });
    expect(result).toEqual({ kind: "cancelled" });
  });
});

describe("describeScaffoldAttachmentPrompt", () => {
  it("기본값(5.0 Boot)은 지원, 문구는 설계 문서와 같다", () => {
    expect(describeScaffoldAttachmentPrompt({})).toEqual({
      supported: true,
      message: "이 프로젝트에 표준 첨부파일 기능을 포함할까요?",
    });
  });
  it.each([
    [{ projectType: "war" as const }],
    [{ stackVersion: "4.3" as const }],
    [{ projectType: "war" as const, stackVersion: "4.3" as const }],
  ])("5.0 Boot 외 조합은 미지원: %j", (a) => {
    expect(describeScaffoldAttachmentPrompt(a).supported).toBe(false);
  });
});

describe("describeAddEntityAttachmentPrompt", () => {
  let tmpRoot: string;
  const DDL = `CREATE TABLE BOARD (\n  ID VARCHAR(16) NOT NULL PRIMARY KEY,\n  TITLE VARCHAR(200)\n)`;

  async function scaffold(stackVersion: "5.0" | "4.3") {
    await generateScaffoldProject({
      projectName: "board-app",
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: DDL,
      description: "",
      projectType: "boot",
      stackVersion,
    });
    return path.join(tmpRoot, "board-app");
  }

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "attach-decision-"));
  });
  afterEach(async () => {
    await fs.remove(tmpRoot);
  });

  it("5.0 Boot 인프라 없음: 함께 설치 문구", async () => {
    const dir = await scaffold("5.0");
    expect(describeAddEntityAttachmentPrompt(dir, "Article")).toEqual({
      supported: true,
      message:
        "엔티티 'Article'에 표준 첨부파일 기능을 연결할까요? 프로젝트에 첨부파일 인프라가 없어 함께 설치됩니다.",
    });
  });

  it("5.0 Boot 인프라 있음: 기본 문구", async () => {
    const dir = await scaffold("5.0");
    await egovAddAttachFileInfrastructure({ projectPath: dir });
    expect(describeAddEntityAttachmentPrompt(dir, "Article")).toEqual({
      supported: true,
      message: "엔티티 'Article'에 표준 첨부파일 기능을 연결할까요?",
    });
  });

  it("4.3 Boot 는 미지원", async () => {
    const dir = await scaffold("4.3");
    expect(describeAddEntityAttachmentPrompt(dir, "Article").supported).toBe(false);
  });

  it("비표준 경로는 미지원 (예외를 던지지 않음)", () => {
    expect(describeAddEntityAttachmentPrompt(path.join(tmpRoot, "nope"), "Article").supported).toBe(false);
  });
});
