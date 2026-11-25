/**
 * 4.3 war pom.xml 의 공식 eGovFrame 웹 부모 전환 테스트.
 *
 * war43 스택은 부모 없이 모든 의존성에 버전을 직접 쓰던 구조에서 공식 웹(Spring Boot 미사용) 부모
 * org.egovframe.web:org.egovframe.web.config.parent:4.3.2 를 상속하는 구조로 바뀌었다. 이 부모는
 * 실행환경 루트 BOM(org.egovframe.rte.root 4.3.2) 을 import 하고, 루트 BOM 이 관리하지 않는
 * Servlet/JSP API·JSON-B·JUnit 과 compiler/war 플러그인 버전을 관리한다 (java.version=1.8).
 *
 * 따라서 생성 pom 의 활성 의존성에는 <version> 이 하나도 없어야 하고, hsqldb 는 실행환경 BOM 이
 * jdk8 classifier 와 함께 관리하므로 classifier 만 적는다 (공식 4.3.2 common-components 템플릿과 같은 방식).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "war43-pom-"));
});

afterEach(async () => {
  await fs.remove(tmpRoot);
});

async function generatePom(): Promise<string> {
  await generateScaffoldProject({
    projectName: "board-web",
    packageName: "egovframework.example.board",
    outputPath: tmpRoot,
    entityName: "Board",
    ddl: "CREATE TABLE BOARD (ID VARCHAR(20) NOT NULL PRIMARY KEY, TITLE VARCHAR(200))",
    description: "",
    projectType: "war",
    stackVersion: "4.3",
  });
  return fs.readFile(path.join(tmpRoot, "board-web", "pom.xml"), "utf-8");
}

/** XML 주석을 제거한다 — 주석 안의 가이드 문구가 단언을 오염시키지 않게. */
function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, "");
}

/** artifactId 가 정확히 일치하는 <dependency> 블록 하나를 돌려준다 (없으면 undefined). */
function depBlock(xml: string, artifactId: string): string | undefined {
  const escaped = artifactId.replace(/\./g, "\\.");
  return xml.match(
    new RegExp(`<dependency>(?:(?!</dependency>)[\\s\\S])*<artifactId>${escaped}</artifactId>[\\s\\S]*?</dependency>`),
  )?.[0];
}

describe("war43 pom.xml — 공식 eGovFrame 웹 부모 4.3.2 상속", () => {
  it("parent 가 org.egovframe.web:org.egovframe.web.config.parent:4.3.2 이고 packaging 은 war 를 유지한다", async () => {
    const pom = await generatePom();
    const parent = pom.match(/<parent>([\s\S]*?)<\/parent>/)?.[1] ?? "";
    expect(parent).toContain("<groupId>org.egovframe.web</groupId>");
    expect(parent).toContain("<artifactId>org.egovframe.web.config.parent</artifactId>");
    expect(parent).toContain("<version>4.3.2</version>");
    // projectDetector 는 <packaging>war</packaging> 으로 war/4.3 을 감지한다.
    expect(pom).toContain("<packaging>war</packaging>");
  });

  it("실행환경 버전 속성과 Spring 버전 속성을 더 이상 선언하지 않는다 (부모가 관리)", async () => {
    const pom = stripComments(await generatePom());
    expect(pom).not.toContain("org.egovframe.rte.version");
    expect(pom).not.toContain("spring.maven.artifact.version");
  });

  it("활성 의존성에는 <version> 이 하나도 없다 (가이드 주석의 ojdbc8 제외)", async () => {
    const pom = stripComments(await generatePom());
    const deps = pom.match(/<dependencies>([\s\S]*?)<\/dependencies>/)?.[1] ?? "";
    expect(deps).not.toMatch(/<version>/);
    for (const artifact of [
      "org.egovframe.rte.ptl.mvc",
      "org.egovframe.rte.psl.dataaccess",
      "org.egovframe.rte.fdl.idgnr",
      "org.egovframe.rte.fdl.property",
      "javax.servlet-api",
      "jstl-api",
      "taglibs-standard-impl",
      "antlr",
      "hsqldb",
      "commons-dbcp2",
      "yasson",
      "javax.json",
      "lombok",
      "spring-test",
      "junit-jupiter-api",
    ]) {
      expect(depBlock(pom, artifact), `${artifact} 의존성이 없습니다`).toBeDefined();
    }
  });

  it("hsqldb 는 버전 없이 jdk8 classifier 만 적는다 (실행환경 BOM 이 2.7.x jdk8 로 관리)", async () => {
    const pom = stripComments(await generatePom());
    const dep = depBlock(pom, "hsqldb");
    expect(dep).toBeDefined();
    expect(dep).toContain("<classifier>jdk8</classifier>");
    expect(dep).not.toMatch(/<version>/);
  });

  it("servlet-api 는 provided, jstl-api 는 구버전 servlet-api/jsp-api 를 제외한다", async () => {
    const pom = stripComments(await generatePom());
    expect(depBlock(pom, "javax.servlet-api")).toContain("<scope>provided</scope>");
    const jstl = depBlock(pom, "jstl-api") ?? "";
    const exclusions = jstl.match(/<exclusions>([\s\S]*?)<\/exclusions>/)?.[1] ?? "";
    expect(exclusions).toContain("<artifactId>servlet-api</artifactId>");
    expect(exclusions).toContain("<artifactId>jsp-api</artifactId>");
  });

  it("드라이버 가이드는 부모가 관리하는 MySQL(mysql-connector-j)·MariaDB·PostgreSQL 에 <version> 을 두지 않는다", async () => {
    const pom = await generatePom();
    for (const artifact of ["mysql-connector-j", "mariadb-java-client", "postgresql"]) {
      const block = depBlock(pom, artifact);
      expect(block, `${artifact} 가이드 블록이 없습니다`).toBeDefined();
      expect(block, `${artifact} 가이드에 <version> 이 남아 있습니다`).not.toMatch(/<version>/);
    }
    expect(pom).not.toContain("mysql-connector-java");
  });

  it("compiler/war 플러그인 버전과 설정을 직접 선언하지 않는다 (부모의 pluginManagement 가 관리)", async () => {
    const pom = stripComments(await generatePom());
    expect(pom).not.toContain("maven-compiler-plugin");
    expect(pom).not.toContain("maven-war-plugin");
  });
});
