/**
 * 4.3 Boot pom.xml 의 공식 eGovFrame Boot 부모 전환 테스트.
 *
 * boot43 스택은 spring-boot-starter-parent 2.7.18 을 직접 상속하는 대신 공식 부모
 * org.egovframe.boot:org.egovframe.boot.starter.parent:4.3.2 를 상속한다. 이 부모는
 * Boot 2.7.18 을 상속하면서 실행환경 루트 BOM(org.egovframe.rte.root 4.3.2) 을 import 하고,
 * Boot 관리 버전(commons-lang3 3.20.0, log4j2 2.25.5, commons-dbcp2 2.13.0, lombok 1.18.36,
 * DB 드라이버 등)을 실행환경 기준으로 재정의한다. 따라서 생성 pom 은 실행환경 모듈 버전과
 * 그 재정의를 다시 선언하지 않아야 한다.
 *
 * 단, SLF4J 1.7 바인딩(log4j-slf4j-impl)은 부모가 추가해 주지 않으므로 pom 이 직접 선언한다.
 * 부모는 slf4j-api 1.7.36 을 유지하는데 실행환경 fdl.logging 은 SLF4J 2 바인딩만 가져오기 때문이다.
 *
 * 의존성 구성은 공식 eGovFrame 4.3.2 Boot simple-backend 템플릿 pom 을 따른다:
 * - 공유 spring-boot-starter 에서 spring-boot-starter-logging 을 전역 1회 제외
 * - psl.dataaccess 에서 slf4j 2.x 바인딩(log4j-slf4j2-impl)과 javaee-api (내장 Tomcat 의 javax 클래스를 가려
 *   HV000183 EL 초기화 실패를 일으킴) 제외
 * - log4j-core / log4j-slf4j-impl / jcl-over-slf4j / log4j-over-slf4j / commons-lang3 를 버전 없이 명시
 * - JDK 9+ 로 빌드할 때 Java 8 API 만 허용하는 java8-api-check 프로필
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

async function generatePom(stackVersion: "4.3" | "5.1"): Promise<string> {
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

describe("boot43 pom.xml — 공식 eGovFrame Boot 4.3.2 부모 상속", () => {
  it("parent 가 org.egovframe.boot:org.egovframe.boot.starter.parent:4.3.2 이다", async () => {
    const pom = await generatePom("4.3");
    const parent = pom.match(/<parent>([\s\S]*?)<\/parent>/)?.[1] ?? "";
    expect(parent).toContain("<groupId>org.egovframe.boot</groupId>");
    expect(parent).toContain("<artifactId>org.egovframe.boot.starter.parent</artifactId>");
    expect(parent).toContain("<version>4.3.2</version>");
    // 주석에는 부모가 Boot 2.7.18 을 상속한다는 설명이 남으므로 주석을 제거한 뒤 확인한다.
    expect(stripComments(pom)).not.toContain("spring-boot-starter-parent");
  });

  it("실행환경 모듈 4종을 버전 없이 선언한다 (부모의 실행환경 BOM 이 관리)", async () => {
    const pom = stripComments(await generatePom("4.3"));
    for (const artifact of [
      "org.egovframe.rte.ptl.mvc",
      "org.egovframe.rte.psl.dataaccess",
      "org.egovframe.rte.fdl.idgnr",
      "org.egovframe.rte.fdl.property",
    ]) {
      const dep = pom.match(
        new RegExp(`<dependency>(?:(?!</dependency>)[\\s\\S])*<artifactId>${artifact.replace(/\./g, "\\.")}</artifactId>[\\s\\S]*?</dependency>`),
      )?.[0];
      expect(dep, `${artifact} 의존성이 없습니다`).toBeDefined();
      expect(dep, `${artifact} 에 <version> 이 남아 있습니다`).not.toMatch(/<version>/);
    }
    expect(pom).not.toContain("org.egovframe.rte.version");
  });

  it("Boot 관리 버전 재정의(commons-lang3 / log4j2)를 선언하지 않는다 — 부모가 재정의한다", async () => {
    const pom = stripComments(await generatePom("4.3"));
    expect(pom).not.toContain("commons-lang3.version");
    expect(pom).not.toContain("log4j2.version");
  });

  it("부모가 관리하는 commons-dbcp2 / lombok / MySQL·MariaDB·PostgreSQL 드라이버에 버전을 핀하지 않는다", async () => {
    const pom = await generatePom("4.3");
    const stripped = stripComments(pom);
    for (const artifact of ["commons-dbcp2", "lombok"]) {
      const dep = stripped.match(
        new RegExp(`<dependency>(?:(?!</dependency>)[\\s\\S])*<artifactId>${artifact}</artifactId>[\\s\\S]*?</dependency>`),
      )?.[0];
      expect(dep, `${artifact} 의존성이 없습니다`).toBeDefined();
      expect(dep, `${artifact} 에 <version> 이 남아 있습니다`).not.toMatch(/<version>/);
    }
    // 주석 처리된 드라이버 가이드도 부모 관리 버전을 덮어쓰지 않도록 <version> 을 두지 않는다.
    for (const artifact of ["mysql-connector-j", "mariadb-java-client", "postgresql"]) {
      const block = pom.match(
        new RegExp(`<dependency>(?:(?!</dependency>)[\\s\\S])*<artifactId>${artifact}</artifactId>[\\s\\S]*?</dependency>`),
      )?.[0];
      expect(block, `${artifact} 가이드 블록이 없습니다`).toBeDefined();
      expect(block, `${artifact} 가이드에 <version> 이 남아 있습니다`).not.toMatch(/<version>/);
    }
  });

  it("hsqldb / hibernate-entitymanager 도 버전 없이 선언한다 (Boot 2.7.18 관리값 2.5.2 / 5.6.15.Final)", async () => {
    const pom = stripComments(await generatePom("4.3"));
    const hsqldb = depBlock(pom, "hsqldb");
    expect(hsqldb).toBeDefined();
    // 부모가 상속하는 Boot 관리값(2.5.2, JRE 8 호환)을 쓴다. 이전의 2.7.3 jdk8 직접 핀은 제거했다.
    expect(hsqldb).not.toMatch(/<version>/);
    expect(hsqldb).not.toMatch(/<classifier>/);
    const hibernate = depBlock(pom, "hibernate-entitymanager");
    expect(hibernate).toBeDefined();
    expect(hibernate).not.toMatch(/<version>/);
  });

  it("실행환경·Boot 가 관리하는 활성 의존성에는 <version> 이 하나도 없다 (가이드 주석의 ojdbc11 제외)", async () => {
    const pom = stripComments(await generatePom("4.3"));
    const deps = pom.match(/<dependencies>([\s\S]*?)<\/dependencies>/)?.[1] ?? "";
    expect(deps).not.toMatch(/<version>/);
  });

  it("SLF4J 1.7 바인딩(log4j-slf4j-impl)을 포함한 로깅 의존성을 버전 없이 명시한다 (부모가 추가해 주지 않음)", async () => {
    const pom = stripComments(await generatePom("4.3"));
    for (const artifact of ["log4j-core", "log4j-slf4j-impl", "jcl-over-slf4j", "log4j-over-slf4j", "commons-lang3"]) {
      const dep = depBlock(pom, artifact);
      expect(dep, `${artifact} 의존성이 없습니다`).toBeDefined();
      // 버전은 부모(log4j2.version / commons-lang3.version) 가 관리하므로 직접 핀하지 않는다.
      expect(dep, `${artifact} 에 <version> 이 남아 있습니다`).not.toMatch(/<version>/);
    }
  });

  it("공유 spring-boot-starter 에서 spring-boot-starter-logging 을 전역 1회 제외한다 (Log4j2 사용)", async () => {
    const pom = stripComments(await generatePom("4.3"));
    const starter = depBlock(pom, "spring-boot-starter");
    expect(starter).toBeDefined();
    expect(starter).toContain("<artifactId>spring-boot-starter-logging</artifactId>");
    expect(pom).not.toContain("spring-boot-starter-log4j2");
  });

  it("psl.dataaccess 에서 slf4j 2.x 바인딩(log4j-slf4j2-impl)과 javaee-api 를 제외한다", async () => {
    const pom = stripComments(await generatePom("4.3"));
    const dataaccess = depBlock(pom, "org.egovframe.rte.psl.dataaccess");
    expect(dataaccess).toBeDefined();
    const exclusions = dataaccess!.match(/<exclusions>([\s\S]*?)<\/exclusions>/)?.[1] ?? "";
    expect(exclusions).toContain("<artifactId>log4j-slf4j2-impl</artifactId>");
    expect(exclusions).toContain("<groupId>javax</groupId>");
    expect(exclusions).toContain("<artifactId>javaee-api</artifactId>");
  });

  it("JDK 9+ 로 빌드할 때 Java 8 API 만 허용하는 java8-api-check 프로필을 둔다", async () => {
    const pom = stripComments(await generatePom("4.3"));
    const profile = pom.match(/<profile>([\s\S]*?)<\/profile>/)?.[1] ?? "";
    expect(profile).toContain("<id>java8-api-check</id>");
    expect(profile).toContain("<jdk>[9,)</jdk>");
    expect(profile).toContain("<maven.compiler.release>8</maven.compiler.release>");
  });

  it("devtools 는 Boot BOM 이 관리하는 이름 spring-boot-devtools 로 선언한다 (spring-boot-starter-devtools 는 존재하지 않음)", async () => {
    const pom = stripComments(await generatePom("4.3"));
    const dep = depBlock(pom, "spring-boot-devtools");
    expect(dep).toBeDefined();
    expect(dep).toContain("<optional>true</optional>");
    expect(dep).not.toMatch(/<version>/);
    expect(pom).not.toContain("spring-boot-starter-devtools");
  });

  it("boot50 pom.xml 은 영향받지 않는다 (egovframe-boot-starter-parent, 재정의 없음)", async () => {
    const pom = stripComments(await generatePom("5.1"));
    expect(pom).toContain("<artifactId>egovframe-boot-starter-parent</artifactId>");
    expect(pom).not.toContain("org.egovframe.boot.starter.parent");
    expect(pom).not.toContain("commons-lang3.version");
    expect(pom).not.toContain("log4j2.version");
  });
});
