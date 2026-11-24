/**
 * src/index.ts 도구 등록(raw zod shape) ↔ src/tools/<name>.ts 정제 스키마 동기화 검증.
 *
 * MCP SDK 는 tools/list 의 JSON Schema 를 index.ts 의 raw shape 에서 생성하고, 도구 호출 시
 * 1차 파싱에서 *미선언 키를 제거*한다. 따라서 도구 모듈 스키마에만 있고 registration 에 빠진
 * 필드는 클라이언트가 절대 전달할 수 없다 — autoMergeHsqlSeed 가 registration 에 누락되어
 * 항상 기본값 true 로만 동작하던 회귀가 그 사례. 실제 서버(build/index.js)를 stdio 로 띄워
 * tools/list 응답을 검증한다.
 *
 * 주의: build/index.js 를 실행하므로 빌드가 선행되어야 한다 (`npm test` 는 자동 빌드,
 * `npm run test:unit` 단독 실행 시엔 `npm run build` 먼저).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { z } from "zod";

import { ScaffoldInputSchema } from "../src/tools/egovScaffoldProject.js";
import { AddEntityInputSchema } from "../src/tools/egovAddEntity.js";
import { AddQueryViewInputSchema } from "../src/tools/egovAddQueryView.js";
import { AddAttachFileInfrastructureInputSchema } from "../src/tools/egovAddAttachFileInfrastructure.js";

const SERVER_ENTRY = fileURLToPath(new URL("../build/index.js", import.meta.url));

/** 도구 이름 → 해당 모듈의 정제 zod 스키마 (2차 검증 스키마). */
const TOOL_MODULE_SCHEMAS: Record<string, z.ZodObject<z.ZodRawShape>> = {
  egov_scaffold_project: ScaffoldInputSchema,
  egov_add_entity: AddEntityInputSchema,
  egov_add_query_view: AddQueryViewInputSchema,
  egov_add_attach_file_infrastructure: AddAttachFileInfrastructureInputSchema,
};

describe("도구 등록 inputSchema ↔ 모듈 스키마 동기화", () => {
  let client: Client;
  const listedSchemas = new Map<string, Record<string, unknown>>();

  beforeAll(async () => {
    if (!existsSync(SERVER_ENTRY)) {
      throw new Error(
        "build/index.js 가 없습니다. 이 테스트는 실제 서버를 띄우므로 `npm run build` 를 먼저 실행하세요.",
      );
    }
    client = new Client({ name: "tool-registration-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_ENTRY],
      stderr: "ignore",
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    for (const tool of tools) {
      listedSchemas.set(
        tool.name,
        (tool.inputSchema.properties ?? {}) as Record<string, unknown>,
      );
    }
  });

  afterAll(async () => {
    await client?.close();
  });

  it("4개 도구가 모두 노출된다", () => {
    expect([...listedSchemas.keys()].sort()).toEqual(
      Object.keys(TOOL_MODULE_SCHEMAS).sort(),
    );
  });

  // registration 에서 빠진 키는 클라이언트가 전달해도 SDK 1차 파싱에서 제거되고,
  // registration 에만 있는 키는 모듈 2차 파싱에서 조용히 버려진다 — 양방향 모두 드리프트.
  it.each(Object.entries(TOOL_MODULE_SCHEMAS))(
    "%s 의 tools/list 필드 집합이 모듈 스키마와 일치한다",
    (toolName, moduleSchema) => {
      const listed = Object.keys(listedSchemas.get(toolName) ?? {}).sort();
      const expected = Object.keys(moduleSchema.shape).sort();
      expect(listed).toEqual(expected);
    },
  );

  it("egov_add_attach_file_infrastructure 는 autoMergeHsqlSeed 를 boolean + 설명과 함께 노출한다", () => {
    const props = listedSchemas.get("egov_add_attach_file_infrastructure") ?? {};
    const field = props["autoMergeHsqlSeed"] as
      | { type?: string; description?: string }
      | undefined;
    expect(field).toBeDefined();
    expect(field?.type).toBe("boolean");
    // .describe() 누락 방지 — LLM-facing 설명이 있어야 클라이언트가 옵션 의미를 안다.
    expect(field?.description).toBeTruthy();
  });

  // DDL COMMENT 가 화면 라벨로 쓰인다는 사실은 LLM 이 DDL 을 작성/정리할 때 알아야 하므로 설명문에 있어야 한다.
  it.each(["egov_scaffold_project", "egov_add_entity"])(
    "%s 의 ddl 설명문이 COMMENT 라벨 반영 규칙을 안내한다",
    (toolName) => {
      const props = listedSchemas.get(toolName) ?? {};
      const field = props["ddl"] as { description?: string } | undefined;
      expect(field?.description).toMatch(/COMMENT/);
      expect(field?.description).toMatch(/10자/);
    },
  );
});
