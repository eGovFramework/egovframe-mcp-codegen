/**
 * 첨부파일 포함 여부 Elicitation — 실제 서버(build/index.js)를 stdio 로 띄워 검증한다.
 * 빌드가 선행되어야 한다 (`npm test` 는 자동 빌드, 단독 실행 시 `npm run build` 먼저).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import { generateScaffoldProject } from "../src/utils/scaffold/scaffoldGenerator.js";
import { detectAttachFileInfra } from "../src/utils/scaffold/projectDetector.js";

const SERVER_ENTRY = fileURLToPath(new URL("../build/index.js", import.meta.url));
const TIMEOUT = { timeout: 120_000 };

const DDL = `CREATE TABLE BOARD (
  ID VARCHAR(20) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;
const ARTICLE_DDL = `CREATE TABLE ARTICLE (
  ID VARCHAR(20) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;

type Reply = { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> };

let tmpRoot: string;
let projectDir: string;
const clients: Client[] = [];

function text(res: unknown): string {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content.map((c) => c.text ?? "").join("\n");
}

async function connect(reply?: Reply, impl?: (req: unknown) => Promise<Reply>) {
  const handler = vi.fn(impl ?? (async (_req: unknown) => reply as Reply));
  const client = new Client(
    { name: "elicitation-test", version: "1.0.0" },
    { capabilities: reply ? { elicitation: {} } : {} },
  );
  if (reply) client.setRequestHandler(ElicitRequestSchema, handler as never);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    stderr: "ignore",
  });
  await client.connect(transport);
  clients.push(client);
  return { client, handler };
}

function scaffoldArgs(extra: Record<string, unknown> = {}) {
  return {
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: DDL,
    ...extra,
  };
}

function entityArgs(extra: Record<string, unknown> = {}) {
  return {
    projectPath: projectDir,
    packageName: "egovframework.example.article",
    entityName: "Article",
    ddl: ARTICLE_DDL,
    ...extra,
  };
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "elicit-it-"));
  projectDir = path.join(tmpRoot, "board-app");
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  await fs.remove(tmpRoot);
});

describe("egov_scaffold_project — withAttachment 확인", () => {
  it("Elicitation 미지원: 파일 없이 재호출을 요청한다", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "egov_scaffold_project", arguments: scaffoldArgs() }, undefined, TIMEOUT);
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/withAttachment/);
    expect(await fs.pathExists(projectDir)).toBe(false);
  });

  it("accept true: 인프라까지 설치한다", async () => {
    const { client, handler } = await connect({ action: "accept", content: { withAttachment: true } });
    const res = await client.callTool({ name: "egov_scaffold_project", arguments: scaffoldArgs() }, undefined, TIMEOUT);
    expect(res.isError).toBeFalsy();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(detectAttachFileInfra(projectDir).present).toBe(true);
  });

  it("decline: 첨부파일 없이 생성한다", async () => {
    const { client } = await connect({ action: "decline" });
    const res = await client.callTool({ name: "egov_scaffold_project", arguments: scaffoldArgs() }, undefined, TIMEOUT);
    expect(res.isError).toBeFalsy();
    expect(await fs.pathExists(projectDir)).toBe(true);
    expect(detectAttachFileInfra(projectDir).present).toBe(false);
  });

  it("cancel: 파일 없이 정상 응답한다", async () => {
    const { client } = await connect({ action: "cancel" });
    const res = await client.callTool({ name: "egov_scaffold_project", arguments: scaffoldArgs() }, undefined, TIMEOUT);
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/취소/);
    expect(await fs.pathExists(projectDir)).toBe(false);
  });

  it("인자를 명시하면 질문하지 않는다", async () => {
    const { client, handler } = await connect({ action: "accept", content: { withAttachment: true } });
    const res = await client.callTool(
      { name: "egov_scaffold_project", arguments: scaffoldArgs({ withAttachment: false }) },
      undefined,
      TIMEOUT,
    );
    expect(res.isError).toBeFalsy();
    expect(handler).not.toHaveBeenCalled();
    expect(detectAttachFileInfra(projectDir).present).toBe(false);
  });

  it("호출이 취소되면 늦게 답해도 파일을 생성하지 않는다", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let asked!: () => void;
    const askedP = new Promise<void>((r) => (asked = r));
    const { client } = await connect({ action: "accept" }, async () => {
      asked();
      await gate;
      return { action: "accept", content: { withAttachment: true } };
    });
    const ac = new AbortController();
    const call = client
      .callTool({ name: "egov_scaffold_project", arguments: scaffoldArgs() }, undefined, {
        ...TIMEOUT,
        signal: ac.signal,
      })
      .catch((e) => e as Error);
    await askedP;
    ac.abort();
    expect(await call).toBeInstanceOf(Error);
    release();
    await new Promise((r) => setTimeout(r, 1000));
    expect(await fs.pathExists(projectDir)).toBe(false);
  });

  it("입력이 유효하지 않으면 질문하지 않고 오류를 돌려준다", async () => {
    const { client, handler } = await connect({ action: "accept", content: { withAttachment: true } });
    const res = await client.callTool(
      { name: "egov_scaffold_project", arguments: scaffoldArgs({ projectName: "../evil name" }) },
      undefined,
      TIMEOUT,
    );
    expect(res.isError).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    expect(await fs.pathExists(projectDir)).toBe(false);
  });

  it("지원하지 않는 스택(WAR 4.3)은 질문 없이 첨부파일 없이 생성한다", async () => {
    const { client, handler } = await connect({ action: "accept", content: { withAttachment: true } });
    const res = await client.callTool(
      { name: "egov_scaffold_project", arguments: scaffoldArgs({ projectType: "war", stackVersion: "4.3" }) },
      undefined,
      TIMEOUT,
    );
    expect(res.isError).toBeFalsy();
    expect(handler).not.toHaveBeenCalled();
    expect(await fs.pathExists(projectDir)).toBe(true);
  });
});

describe("egov_add_entity — withAttachment 확인", () => {
  beforeEach(async () => {
    await generateScaffoldProject({
      projectName: "board-app",
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: DDL,
      description: "",
      projectType: "boot",
      stackVersion: "5.0",
    });
  });

  it("인프라 없음 문구로 질문하고, accept true 후 인프라가 설치된다", async () => {
    const { client, handler } = await connect({ action: "accept", content: { withAttachment: true } });
    const res = await client.callTool({ name: "egov_add_entity", arguments: entityArgs() }, undefined, TIMEOUT);
    expect(res.isError).toBeFalsy();
    expect(handler).toHaveBeenCalledTimes(1);
    const params = (handler.mock.calls[0][0] as { params: { message: string } }).params;
    expect(params.message).toContain("함께 설치");
    expect(params.message).toContain("'Article'");
    expect(detectAttachFileInfra(projectDir).present).toBe(true);
  });

  it("Elicitation 미지원: 엔티티 파일 없이 재호출을 요청한다", async () => {
    const { client } = await connect();
    const res = await client.callTool({ name: "egov_add_entity", arguments: entityArgs() }, undefined, TIMEOUT);
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/withAttachment/);
    expect(detectAttachFileInfra(projectDir).present).toBe(false);
  });
});
