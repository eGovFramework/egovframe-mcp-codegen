/**
 * 4.3 Boot pom.xml 의 Spring Boot 2.7.18 관리 버전 재정의 테스트.
 *
 * 실행환경 4.3.2 는 commons-lang3 3.20.0 (org.apache.commons.lang3.Strings) 과 log4j2 2.25.5 를
 * 기준으로 빌드되었지만, spring-boot-starter-parent 2.7.18 은 commons-lang3 3.12.0 / log4j2 2.17.2 로
 * 고정한다. 공식 org.egovframe.boot.starter.parent 4.3.2 가 하는 것과 같은 속성 재정의가 없으면
 * 요청 시점에 NoClassDefFoundError 가 나고, SLF4J 1.7 바인딩(log4j-slf4j-impl)이 없으면 로깅이 NOP 가 된다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "boot43-pom-"));
});

afterEach(async () => {
  await fs.remove(tmpRoot);
});

async function generatePom(stackVersion: "4.3" | "5.0"): Promise<string> {
  await generateScaffoldProject({
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: "CREATE TABLE BOARD (ID VARCHAR(20) NOT NULL PRIMARY KEY, TITLE VARCHAR(200))",
    description: "",
    projectType: "boot",
    stackVersion,
  });
  return fs.readFile(path.join(tmpRoot, "board-app", "pom.xml"), "utf-8");
}

describe("boot43 pom.xml — 실행환경 4.3.2 와 Spring Boot 2.7.18 관리 버전 정합", () => {
  it("commons-lang3 를 실행환경 4.3.2 루트 POM 과 같은 3.20.0 으로 재정의한다", async () => {
    const pom = await generatePom("4.3");
    expect(pom).toContain("<commons-lang3.version>3.20.0</commons-lang3.version>");
  });

  it("log4j2 를 실행환경 4.3.2 루트 POM 과 같은 2.25.5 로 재정의한다", async () => {
    const pom = await generatePom("4.3");
    expect(pom).toContain("<log4j2.version>2.25.5</log4j2.version>");
  });

  it("SLF4J 1.7 바인딩(log4j-slf4j-impl)을 명시해 로깅이 NOP 로 떨어지지 않게 한다", async () => {
    const pom = await generatePom("4.3");
    expect(pom).toContain("<artifactId>log4j-slf4j-impl</artifactId>");
  });

  it("boot50 pom.xml 은 공식 Boot 부모가 버전을 관리하므로 재정의를 넣지 않는다", async () => {
    const pom = await generatePom("5.0");
    expect(pom).not.toContain("commons-lang3.version");
    expect(pom).not.toContain("log4j2.version");
  });
});
