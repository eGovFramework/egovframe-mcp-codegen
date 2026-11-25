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

// stackVersion 을 명시해 두어야 첨부파일 질문만 단독으로 검증할 수 있다 (생략하면 버전도 함께 묻는다).
function scaffoldArgs(extra: Record<string, unknown> = {}) {
  return {
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: DDL,
    stackVersion: "5.1",
    ...extra,
  };
}

function requestedSchema(handler: ReturnType<typeof vi.fn>): { properties: Record<string, unknown>; required: string[] } {
  const req = handler.mock.calls[0][0] as { params: { requestedSchema: { properties: Record<string, unknown>; required: string[] } } };
  return req.params.requestedSchema;
}

async function parentArtifactId(dir: string): Promise<string | undefined> {
  const pom = await fs.readFile(path.join(dir, "pom.xml"), "utf8");
  return pom.match(/<parent>[\s\S]*?<artifactId>\s*([^<]+?)\s*<\/artifactId>/)?.[1];
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

  it("4.3 Boot 에서 withAttachment 를 생략하면 질문한다", async () => {
    const { client, handler } = await connect({ action: "accept", content: { withAttachment: true } });
    const res = await client.callTool(
      { name: "egov_scaffold_project", arguments: scaffoldArgs({ stackVersion: "4.3" }) },
      undefined,
      TIMEOUT,
    );
    expect(res.isError).toBeFalsy();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(detectAttachFileInfra(projectDir).present).toBe(true);
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

describe("egov_scaffold_project — stackVersion 확인", () => {
  const STACK_ONE_OF = [
    { const: "5.1", title: "표준프레임워크 5.1 (Spring Boot 3, Java 17)" },
    { const: "4.3", title: "표준프레임워크 4.3 (Spring Boot 2.7, Java 8)" },
  ];

  it("Elicitation 미지원: 버전을 사용자에게 물은 뒤 재호출하라는 오류, 파일 없음", async () => {
    const { client } = await connect();
    const res = await client.callTool(
      { name: "egov_scaffold_project", arguments: scaffoldArgs({ stackVersion: undefined, withAttachment: false }) },
      undefined,
      TIMEOUT,
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/stackVersion/);
    expect(text(res)).toMatch(/'4\.3'/);
    expect(text(res)).toMatch(/'5\.1'/);
    expect(text(res)).not.toMatch(/withAttachment/);
    expect(await fs.pathExists(projectDir)).toBe(false);
  });

  it("버전과 첨부 여부를 모두 생략하면 form 하나로 함께 묻고, 답대로 4.3 Boot 를 생성한다", async () => {
    const { client, handler } = await connect({
      action: "accept",
      content: { stackVersion: "4.3", withAttachment: false },
    });
    const res = await client.callTool(
      { name: "egov_scaffold_project", arguments: scaffoldArgs({ stackVersion: undefined }) },
      undefined,
      TIMEOUT,
    );
    expect(res.isError).toBeFalsy();
    expect(handler).toHaveBeenCalledTimes(1);
    const schema = requestedSchema(handler);
    expect(schema.required).toEqual(["stackVersion", "withAttachment"]);
    expect(schema.properties.stackVersion).toEqual({ type: "string", title: "표준프레임워크 버전", oneOf: STACK_ONE_OF });
    expect(schema.properties.withAttachment).toEqual({ type: "boolean", title: "첨부파일 포함" });
    expect(await parentArtifactId(projectDir)).toBe("org.egovframe.boot.starter.parent");
    expect(detectAttachFileInfra(projectDir).present).toBe(false);
    expect(text(res)).toMatch(/eGovFrame 4\.3/);
  });

  it("버전만 생략하면 버전만 묻고, 5.1 을 고르면 5.1 Boot 를 생성한다", async () => {
    const { client, handler } = await connect({ action: "accept", content: { stackVersion: "5.1" } });
    const res = await client.callTool(
      { name: "egov_scaffold_project", arguments: scaffoldArgs({ stackVersion: undefined, withAttachment: false }) },
      undefined,
      TIMEOUT,
    );
    expect(res.isError).toBeFalsy();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(requestedSchema(handler).required).toEqual(["stackVersion"]);
    expect(await parentArtifactId(projectDir)).toBe("egovframe-boot-starter-parent");
    expect(text(res)).toMatch(/eGovFrame 5\.1/);
  });

  it("WAR 는 버전을 생략해도 묻지 않고 4.3 WAR 를 생성한다", async () => {
    const { client, handler } = await connect({ action: "accept", content: { stackVersion: "5.1" } });
    const res = await client.callTool(
      { name: "egov_scaffold_project", arguments: scaffoldArgs({ projectType: "war", stackVersion: undefined }) },
      undefined,
      TIMEOUT,
    );
    expect(res.isError).toBeFalsy();
    expect(handler).not.toHaveBeenCalled();
    expect(await parentArtifactId(projectDir)).toBe("org.egovframe.web.config.parent");
  });

  it("버전 질문에 decline 하면 파일 없이 취소로 끝낸다", async () => {
    const { client } = await connect({ action: "decline" });
    const res = await client.callTool(
      { name: "egov_scaffold_project", arguments: scaffoldArgs({ stackVersion: undefined }) },
      undefined,
      TIMEOUT,
    );
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/취소/);
    expect(await fs.pathExists(projectDir)).toBe(false);
  });

  it("구 명칭 '5.0' 은 입력 검증에서 거부되고 질문하지 않는다", async () => {
    const { client, handler } = await connect({ action: "accept", content: { stackVersion: "5.1" } });
    const res = await client.callTool(
      { name: "egov_scaffold_project", arguments: scaffoldArgs({ stackVersion: "5.0", withAttachment: false }) },
      undefined,
      TIMEOUT,
    );
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/stackVersion/);
    expect(text(res)).toMatch(/5\.1/);
    expect(handler).not.toHaveBeenCalled();
    expect(await fs.pathExists(projectDir)).toBe(false);
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
      stackVersion: "5.1",
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
