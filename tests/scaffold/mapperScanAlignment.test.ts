/**
 * 매퍼 스캔 설정의 annotationClass 와 생성된 매퍼의 어노테이션이 일치하는지 검증한다.
 *
 * 스캔 대상 어노테이션과 매퍼의 어노테이션이 다르면 컴파일은 통과하지만 매퍼가 빈으로
 * 등록되지 않아 애플리케이션이 기동되지 않는다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { egovAddAttachFileInfrastructure } from "../../src/tools/egovAddAttachFileInfrastructure.js";
import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const BOARD_DDL = "CREATE TABLE BOARD (ID VARCHAR(16) NOT NULL PRIMARY KEY, TITLE VARCHAR(200))";
const MEMBER_DDL = "CREATE TABLE MEMBER (ID VARCHAR(16) NOT NULL PRIMARY KEY, EMAIL VARCHAR(100))";

const JAVA_ROOT = "src/main/java/egovframework/example";
const BOOT_SCAN_CONFIG = `${JAVA_ROOT}/config/EgovConfigMapper.java`;
const WAR_SCAN_CONFIG = "src/main/resources/egovframework/spring/context-mapper.xml";
const BOARD_MAPPER = `${JAVA_ROOT}/board/service/impl/BoardMapper.java`;
const MEMBER_MAPPER = `${JAVA_ROOT}/member/service/impl/MemberMapper.java`;
const FILE_MAPPER = `${JAVA_ROOT}/cmm/service/impl/FileManageMapper.java`;

let tmpRoot: string;
let projectDir: string;

const read = (relPath: string): Promise<string> =>
  fs.readFile(path.join(projectDir, relPath), "utf-8");

/** Java 소스에서 단순 이름의 import 를 찾아 FQCN 으로 바꾼다. */
function importedFqcn(source: string, simpleName: string): string {
  const match = new RegExp(`^import\\s+([\\w.]+\\.${simpleName})\\s*;`, "m").exec(source);
  expect(match, `import of ${simpleName}`).not.toBeNull();
  return match![1];
}

async function scanAnnotation(projectType: "boot" | "war"): Promise<string> {
  if (projectType === "war") {
    const xml = await read(WAR_SCAN_CONFIG);
    const match = /<property\s+name="annotationClass"\s+value="([\w.]+)"/.exec(xml);
    expect(match, "annotationClass property").not.toBeNull();
    return match![1];
  }
  const config = await read(BOOT_SCAN_CONFIG);
  const match = /@MapperScan\(\s*annotationClass\s*=\s*(\w+)\.class/.exec(config);
  expect(match, "@MapperScan annotationClass").not.toBeNull();
  return importedFqcn(config, match![1]);
}

async function mapperAnnotation(relPath: string): Promise<string> {
  const source = await read(relPath);
  const match = /^@(\w+)(?:\([^)]*\))?\s*\r?\n\s*public interface /m.exec(source);
  expect(match, `mapper annotation in ${relPath}`).not.toBeNull();
  return importedFqcn(source, match![1]);
}

async function scaffold(projectType: "boot" | "war", stackVersion: "5.1" | "4.3"): Promise<void> {
  await generateScaffoldProject({
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: BOARD_DDL,
    description: "",
    projectType,
    stackVersion,
  });
}

const addMember = () =>
  egovAddEntity({
    projectPath: projectDir,
    packageName: "egovframework.example.member",
    entityName: "Member",
    ddl: MEMBER_DDL,
    withAttachment: false,
  });

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-mapper-scan-"));
  projectDir = path.join(tmpRoot, "board-app");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

describe.each([
  ["5.1 Boot", "boot", "5.1", "org.egovframe.rte.psl.dataaccess.mapper.EgovMapper"],
  ["4.3 Boot", "boot", "4.3", "org.egovframe.rte.psl.dataaccess.mapper.Mapper"],
  ["4.3 WAR", "war", "4.3", "org.egovframe.rte.psl.dataaccess.mapper.Mapper"],
] as const)("%s 매퍼 스캔 설정", (_label, projectType, stackVersion, expected) => {
  it("annotationClass 가 표준 어노테이션이고 첫 엔티티 매퍼와 일치한다", async () => {
    await scaffold(projectType, stackVersion);
    expect(await scanAnnotation(projectType)).toBe(expected);
    expect(await mapperAnnotation(BOARD_MAPPER)).toBe(expected);
  });

  it("egov_add_entity 로 추가한 매퍼도 annotationClass 와 일치한다", async () => {
    await scaffold(projectType, stackVersion);
    await addMember();
    expect(await mapperAnnotation(MEMBER_MAPPER)).toBe(await scanAnnotation(projectType));
  });
});

describe.each([
  ["5.1 Boot", "5.1"],
  ["4.3 Boot", "4.3"],
] as const)("%s 첨부파일 인프라 매퍼", (_label, stackVersion) => {
  it("FileManageMapper 가 annotationClass 와 일치한다", async () => {
    await scaffold("boot", stackVersion);
    await egovAddAttachFileInfrastructure({ projectPath: projectDir });
    expect(await mapperAnnotation(FILE_MAPPER)).toBe(await scanAnnotation("boot"));
  });
});

describe("MyBatis @Mapper 로 스캔하는 기존 4.3 Boot 프로젝트", () => {
  it("새 매퍼는 프로젝트의 annotationClass 를 따른다", async () => {
    await scaffold("boot", "4.3");
    const configPath = path.join(projectDir, BOOT_SCAN_CONFIG);
    const config = await fs.readFile(configPath, "utf-8");
    await fs.writeFile(
      configPath,
      config.replace(
        "import org.egovframe.rte.psl.dataaccess.mapper.Mapper;",
        "import org.apache.ibatis.annotations.Mapper;",
      ),
    );
    await addMember();
    await egovAddAttachFileInfrastructure({ projectPath: projectDir });
    const scan = await scanAnnotation("boot");
    expect(scan).toBe("org.apache.ibatis.annotations.Mapper");
    expect(await mapperAnnotation(MEMBER_MAPPER)).toBe(scan);
    expect(await mapperAnnotation(FILE_MAPPER)).toBe(scan);
  });
});
