/**
 * Input validation tests for egov_scaffold_project
 *
 * - Zod 스키마가 모순 조합과 잘못된 형식을 잡는지 확인
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ScaffoldInputSchema,
  egovScaffoldProject,
} from "../../src/tools/egovScaffoldProject.js";

const VALID_DDL = `CREATE TABLE board (
  board_id VARCHAR(36) NOT NULL,
  title VARCHAR(200),
  PRIMARY KEY (board_id)
)`;

const baseParams = {
  projectName: "test-board",
  packageName: "egovframework.example.board",
  entityName: "Board",
  ddl: VALID_DDL,
};

describe("ScaffoldInputSchema", () => {
  it("정상 입력은 통과한다", () => {
    const r = ScaffoldInputSchema.safeParse({
      ...baseParams,
      outputPath: "/tmp/x",
    });
    expect(r.success).toBe(true);
  });

  it("WAR + 5.1 조합은 거부한다", () => {
    const r = ScaffoldInputSchema.safeParse({
      ...baseParams,
      outputPath: "/tmp/x",
      projectType: "war",
      stackVersion: "5.1",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0].message).toMatch(/war.*4\.3|4\.3.*war/i);
    }
  });

  it("WAR + 4.3 조합은 허용한다", () => {
    const r = ScaffoldInputSchema.safeParse({
      ...baseParams,
      outputPath: "/tmp/x",
      projectType: "war",
      stackVersion: "4.3",
    });
    expect(r.success).toBe(true);
  });

  it("entityName 이 PascalCase 가 아니면 거부한다", () => {
    const r = ScaffoldInputSchema.safeParse({
      ...baseParams,
      entityName: "board", // 소문자 시작
      outputPath: "/tmp/x",
    });
    expect(r.success).toBe(false);
  });

  it("packageName 이 점 구분이 아니면 거부한다", () => {
    const r = ScaffoldInputSchema.safeParse({
      ...baseParams,
      packageName: "noDots",
      outputPath: "/tmp/x",
    });
    expect(r.success).toBe(false);
  });

  it("projectName 이 대문자/공백을 포함하면 거부한다", () => {
    const r = ScaffoldInputSchema.safeParse({
      ...baseParams,
      projectName: "MyApp",
      outputPath: "/tmp/x",
    });
    expect(r.success).toBe(false);
  });

  it("ddl 이 CREATE TABLE 이 아니면 거부한다", () => {
    const r = ScaffoldInputSchema.safeParse({
      ...baseParams,
      ddl: "DROP TABLE board;",
      outputPath: "/tmp/x",
    });
    expect(r.success).toBe(false);
  });

  it("기본값이 적용된다 (projectType=boot, stackVersion=5.1)", () => {
    const r = ScaffoldInputSchema.parse({
      ...baseParams,
      outputPath: "/tmp/x",
    });
    expect(r.projectType).toBe("boot");
    expect(r.stackVersion).toBe("5.1");
    expect(r.description).toBe("");
  });

  it("WAR 에서 stackVersion 을 생략하면 4.3 으로 채운다", () => {
    const r = ScaffoldInputSchema.parse({
      ...baseParams,
      outputPath: "/tmp/x",
      projectType: "war",
    });
    expect(r.stackVersion).toBe("4.3");
  });

  it("구 명칭 '5.0' 은 거부한다", () => {
    const r = ScaffoldInputSchema.safeParse({
      ...baseParams,
      outputPath: "/tmp/x",
      stackVersion: "5.0",
    });
    expect(r.success).toBe(false);
  });
});

describe("egovScaffoldProject — 동작", () => {
  it("정상 호출 시 성공 메시지를 돌려준다", async () => {
    const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-ok-"));
    try {
      const out = await egovScaffoldProject({
        ...baseParams,
        outputPath: tmpOut,
      });
      expect(out).toContain("✅");
    } finally {
      fs.rmSync(tmpOut, { recursive: true, force: true });
    }
  });

  it("잘못된 입력은 Zod 에러를 친절한 메시지로 던진다", async () => {
    await expect(
      egovScaffoldProject({
        ...baseParams,
        outputPath: "/tmp/x",
        projectType: "war",
        stackVersion: "5.1",
      }),
    ).rejects.toThrow(/war.*4\.3|4\.3.*war/i);
  });
});
