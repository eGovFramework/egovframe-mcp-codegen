/**
 * egov_add_attach_file_infrastructure — HSQL 임베디드 시드 머지 동작 테스트
 *
 * 흐름:
 *   1) autoMergeHsqlSeed 미지정 (기본 true) + 시드 1개          → 시드 끝에 자동 append
 *   2) autoMergeHsqlSeed=false                                   → 시드 손대지 않음 + 별도 파일도 안 만듦
 *   3) 시드 0개 (db/ 비움)                                       → fallback: db/attach-file.sql 별도 파일 + 사유
 *   4) 시드 2개 (수동으로 두 번째 시드 추가)                       → fallback: 별도 파일
 *   5) 이미 머지된 시드 (재호출)                                   → 멱등 skip
 *   6) 운영 DB DDL 7개 dialect 폴더는 항상 생성됨 (기존 동작 보존)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddAttachFileInfrastructure } from "../../src/tools/egovAddAttachFileInfrastructure.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const BOARD_DDL = `CREATE TABLE BOARD (
  ID VARCHAR(16) NOT NULL PRIMARY KEY,
  TITLE VARCHAR(200)
)`;

let tmpRoot: string;
let projectDir: string;

async function scaffoldBoardApp() {
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
  return path.join(tmpRoot, "board-app");
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-add-attach-"));
  projectDir = await scaffoldBoardApp();
});

afterEach(async () => {
  await fs.remove(tmpRoot);
});

describe("egov_add_attach_file_infrastructure — HSQL 시드 머지", () => {
  it("[기본] autoMergeHsqlSeed 미지정 + 시드 1개 → 시드 끝에 COMTNFILE/COMTNFILEDETAIL/COMTECOPSEQ append", async () => {
    const seedAbs = path.join(projectDir, "src/main/resources/db/boarddb.sql");
    const seedBefore = await fs.readFile(seedAbs, "utf-8");

    const out = await egovAddAttachFileInfrastructure({
      projectPath: projectDir,
      // autoMergeHsqlSeed 미지정 — 기본 true 적용 기대
    });

    const seedAfter = await fs.readFile(seedAbs, "utf-8");
    expect(seedAfter.length).toBeGreaterThan(seedBefore.length);
    // 보존: 시드 처음 부분은 변하지 않음
    expect(seedAfter.startsWith(seedBefore)).toBe(true);
    // 세 테이블 + FILE_ID 시퀀스 row 가 추가되어 있어야 한다
    expect(seedAfter).toMatch(/CREATE\s+MEMORY\s+TABLE\s+COMTNFILE\b/i);
    expect(seedAfter).toMatch(/CREATE\s+MEMORY\s+TABLE\s+COMTNFILEDETAIL\b/i);
    expect(seedAfter).toMatch(/CREATE\s+MEMORY\s+TABLE\s+COMTECOPSEQ\b/i);
    expect(seedAfter).toMatch(/INSERT\s+INTO\s+COMTECOPSEQ.*'FILE_ID'/i);
    // HSQL 호환 타입 확인 — MEDIUMTEXT(MySQL 전용) 가 누설되지 않아야 함
    expect(seedAfter).not.toMatch(/MEDIUMTEXT/i);
    expect(seedAfter).toMatch(/LONGVARCHAR/i);

    // 별도 fallback 파일은 생성되지 않아야 한다
    const fallbackFile = path.join(projectDir, "src/main/resources/db/attach-file.sql");
    expect(await fs.pathExists(fallbackFile)).toBe(false);

    // 출력 메시지 확인
    expect(out).toMatch(/HSQL 임베디드 시드 자동 머지/);
    expect(out).toMatch(/boarddb\.sql/);
  });

  it("[명시 false] autoMergeHsqlSeed=false 면 시드도 fallback 파일도 만들지 않는다", async () => {
    const seedAbs = path.join(projectDir, "src/main/resources/db/boarddb.sql");
    const seedBefore = await fs.readFile(seedAbs, "utf-8");

    const out = await egovAddAttachFileInfrastructure({
      projectPath: projectDir,
      autoMergeHsqlSeed: false,
    });

    expect(await fs.readFile(seedAbs, "utf-8")).toEqual(seedBefore);

    const fallbackFile = path.join(projectDir, "src/main/resources/db/attach-file.sql");
    expect(await fs.pathExists(fallbackFile)).toBe(false);

    expect(out).toMatch(/HSQL 시드 머지 건너뜀/);
    expect(out).toMatch(/autoMergeHsqlSeed=false/);
  });

  it("[fallback: 시드 0개] db/ 디렉터리에 .sql 파일이 없으면 db/attach-file.sql 별도 생성", async () => {
    // 시드 파일 삭제 — db/ 디렉터리는 비움 (디렉터리는 유지)
    const seedAbs = path.join(projectDir, "src/main/resources/db/boarddb.sql");
    await fs.remove(seedAbs);

    const out = await egovAddAttachFileInfrastructure({
      projectPath: projectDir,
    });

    const fallbackFile = path.join(projectDir, "src/main/resources/db/attach-file.sql");
    expect(await fs.pathExists(fallbackFile)).toBe(true);
    const content = await fs.readFile(fallbackFile, "utf-8");
    expect(content).toMatch(/CREATE\s+MEMORY\s+TABLE\s+COMTNFILE\b/i);
    expect(content).toMatch(/CREATE\s+MEMORY\s+TABLE\s+COMTNFILEDETAIL\b/i);
    expect(content).toMatch(/INSERT\s+INTO\s+COMTECOPSEQ.*'FILE_ID'/i);

    expect(out).toMatch(/HSQL 시드 \(fallback\)/);
    expect(out).toMatch(/사용자 시드 SQL 파일이 발견되지 않아/);
  });

  it("[fallback: 시드 2개] db/ 에 사용자 시드가 2개면 어디에 머지할지 결정 불가 → 별도 파일", async () => {
    // 두 번째 사용자 시드를 수동으로 만든다 (add-*-tables.sql 패턴은 제외 대상이므로 일반 시드 이름 사용)
    const extraSeedAbs = path.join(projectDir, "src/main/resources/db/anotherdb.sql");
    await fs.writeFile(extraSeedAbs, "-- another seed\n", "utf-8");

    const out = await egovAddAttachFileInfrastructure({
      projectPath: projectDir,
    });

    // 원래 시드는 손대지 않는다
    const originalSeed = await fs.readFile(
      path.join(projectDir, "src/main/resources/db/boarddb.sql"),
      "utf-8",
    );
    expect(originalSeed).not.toMatch(/COMTNFILE/);

    const fallbackFile = path.join(projectDir, "src/main/resources/db/attach-file.sql");
    expect(await fs.pathExists(fallbackFile)).toBe(true);

    expect(out).toMatch(/HSQL 시드 \(fallback\)/);
    expect(out).toMatch(/2개/);
  });

  it("[멱등] 시드에 이미 COMTNFILE 정의가 있으면 재호출 시 머지 skip", async () => {
    // 1차 호출 — 시드에 머지
    await egovAddAttachFileInfrastructure({ projectPath: projectDir });

    const seedAbs = path.join(projectDir, "src/main/resources/db/boarddb.sql");
    const seedAfterFirst = await fs.readFile(seedAbs, "utf-8");

    // 2차 호출 — 매니페스트 산출물은 skipIfPresent 로 멱등 skip, 시드는 alreadyMerged
    const out = await egovAddAttachFileInfrastructure({ projectPath: projectDir });
    const seedAfterSecond = await fs.readFile(seedAbs, "utf-8");

    // 시드 내용이 두 번째 호출 후에도 변하지 않아야 한다 (COMTNFILE 가 두 번 들어가지 않음)
    expect(seedAfterSecond).toEqual(seedAfterFirst);
    expect(out).toMatch(/HSQL 시드 머지 skip/);
    expect(out).toMatch(/이미 COMTNFILE 정의가 존재/);
  });

  it("[운영 DB DDL 보존] 7개 dialect 폴더의 attach-file.sql 은 시드 머지 여부와 무관하게 생성됨", async () => {
    await egovAddAttachFileInfrastructure({ projectPath: projectDir });

    const dialects = ["oracle", "tibero", "altibase", "cubrid", "goldilocks", "mysql", "postgres"];
    for (const d of dialects) {
      const dialectDdl = path.join(
        projectDir,
        `src/main/resources/db/migrations/${d}/attach-file.sql`,
      );
      expect(await fs.pathExists(dialectDdl)).toBe(true);
      const content = await fs.readFile(dialectDdl, "utf-8");
      expect(content).toMatch(/CREATE\s+TABLE\s+COMTNFILE\b/i);
    }
  });
});
