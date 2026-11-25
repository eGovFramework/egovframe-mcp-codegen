/**
 * attachFileInstaller — 계획(plan, 쓰기 없음)과 적용(apply, 저널 공유) 분리 동작 테스트
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import {
  applyAttachFileInfra,
  defaultAttachFileInstallOptions,
  planAttachFileInfra,
  summarizeAttachFileInstall,
} from "../../src/utils/scaffold/attachFileInstaller.js";
import { FileWriteJournal } from "../../src/utils/scaffold/writeRollback.js";
import { detectAttachFileInfra } from "../../src/utils/scaffold/projectDetector.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const BOARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;

let tmpRoot: string;
let projectDir: string;
let seedPath: string;
let attachConfigPath: string;

async function listAllFiles(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const name of await fs.readdir(dir)) {
      const abs = path.join(dir, name);
      const st = await fs.stat(abs);
      if (st.isDirectory()) await walk(abs);
      else out[path.relative(root, abs)] = await fs.readFile(abs, "utf-8");
    }
  };
  await walk(root);
  return out;
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-attach-installer-"));
  await generateScaffoldProject({
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: BOARD_DDL,
    description: "",
    projectType: "boot",
    stackVersion: "5.1",
  });
  projectDir = path.join(tmpRoot, "board-app");
  seedPath = path.join(projectDir, "src/main/resources/db/boarddb.sql");
  attachConfigPath = path.join(
    projectDir,
    "src/main/java/egovframework/example/config/EgovConfigAttachFile.java",
  );
});

afterEach(async () => {
  await fs.remove(tmpRoot);
});

describe("attachFileInstaller", () => {
  it("plan 은 파일을 쓰지 않는다", async () => {
    const before = await listAllFiles(projectDir);
    await planAttachFileInfra(defaultAttachFileInstallOptions(projectDir));
    expect(await listAllFiles(projectDir)).toEqual(before);
  });

  it("apply 후 인프라가 감지된다", async () => {
    const plan = await planAttachFileInfra(defaultAttachFileInstallOptions(projectDir));
    const result = await applyAttachFileInfra(plan, new FileWriteJournal());
    expect(detectAttachFileInfra(projectDir).present).toBe(true);
    const summary = summarizeAttachFileInstall(plan, result).join("\n");
    expect(summary).toContain("생성된 파일");
  });

  it("요약에 생성한 인프라 파일을 빠짐없이 나열한다", async () => {
    const plan = await planAttachFileInfra(defaultAttachFileInstallOptions(projectDir));
    const result = await applyAttachFileInfra(plan, new FileWriteJournal());
    expect(result.filesCreated.length).toBeGreaterThan(0);
    const summary = summarizeAttachFileInstall(plan, result);
    for (const file of result.filesCreated) {
      expect(summary).toContain(`  - ${file}`);
    }
  });

  it("저널 롤백으로 설치 전 상태가 복원된다", async () => {
    const seedBefore = await fs.readFile(seedPath, "utf-8");
    const journal = new FileWriteJournal();
    await applyAttachFileInfra(
      await planAttachFileInfra(defaultAttachFileInstallOptions(projectDir)),
      journal,
    );
    await journal.rollback();
    expect(detectAttachFileInfra(projectDir).present).toBe(false);
    expect(await fs.readFile(seedPath, "utf-8")).toBe(seedBefore);
  });

  it("다른 내용의 인프라 파일이 있으면 plan 이 거부한다", async () => {
    await fs.outputFile(attachConfigPath, "// different");
    await expect(
      planAttachFileInfra(defaultAttachFileInstallOptions(projectDir)),
    ).rejects.toThrow(/파일 충돌/);
  });
});
