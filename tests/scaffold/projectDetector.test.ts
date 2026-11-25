/**
 * `src/utils/scaffold/projectDetector.ts` — detectProjectStack 단위·통합 테스트.
 *
 * 감지 규칙
 * - `<packaging>war</packaging>`                                   → war / 4.3
 * - parent.artifactId = egovframe-boot-starter-parent             → boot / 5.1
 * - parent.artifactId = org.egovframe.boot.starter.parent         → boot / 4.3 (공식 부모, 현재 scaffold)
 * - parent.artifactId = spring-boot-starter-parent + org.egovframe.rte → boot / 4.3 (공식 부모 전환 전 scaffold)
 *
 * 마지막 규칙은 공식 부모로 전환하기 전에 생성된 프로젝트에 `egov_add_entity` 가 계속
 * 동작해야 하므로 유지된다. 이 파일은 그 호환성도 실제 도구 호출로 확인한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs-extra";
import * as os from "node:os";
import * as path from "node:path";

import { detectProjectStack } from "../../src/utils/scaffold/projectDetector.js";
import { egovAddEntity } from "../../src/tools/egovAddEntity.js";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "egov-detect-"));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.remove(tmpRoot);
});

async function writePom(xml: string): Promise<string> {
  const dir = path.join(tmpRoot, "proj");
  await fs.ensureDir(dir);
  await fs.writeFile(path.join(dir, "pom.xml"), xml, "utf-8");
  return dir;
}

const bootPom = (parentArtifactId: string, parentGroupId: string, parentVersion: string, body = "") => `<?xml version="1.0"?>
<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>egovframework.example</groupId>
  <artifactId>board-app</artifactId>
  <packaging>jar</packaging>
  <version>1.0.0</version>
  <parent>
    <groupId>${parentGroupId}</groupId>
    <artifactId>${parentArtifactId}</artifactId>
    <version>${parentVersion}</version>
  </parent>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
${body}
  </dependencies>
</project>
`;

const RTE_DEP = `    <dependency>
      <groupId>org.egovframe.rte</groupId>
      <artifactId>org.egovframe.rte.ptl.mvc</artifactId>
      <version>4.3.0</version>
    </dependency>`;

describe("detectProjectStack — 마커별 감지", () => {
  it("공식 부모 org.egovframe.boot.starter.parent → boot / 4.3", async () => {
    const dir = await writePom(bootPom("org.egovframe.boot.starter.parent", "org.egovframe.boot", "4.3.2"));
    const d = detectProjectStack(dir);
    expect(d.projectType).toBe("boot");
    expect(d.stackVersion).toBe("4.3");
    expect(d.reason).toContain("org.egovframe.boot.starter.parent");
  });

  it("공식 부모 감지는 RTE 의존성 유무와 무관하다 (부모가 RTE BOM 을 import)", async () => {
    const dir = await writePom(bootPom("org.egovframe.boot.starter.parent", "org.egovframe.boot", "4.3.2", RTE_DEP));
    expect(detectProjectStack(dir).stackVersion).toBe("4.3");
  });

  it("legacy: spring-boot-starter-parent + org.egovframe.rte 의존성 → boot / 4.3", async () => {
    const dir = await writePom(bootPom("spring-boot-starter-parent", "org.springframework.boot", "2.7.18", RTE_DEP));
    const d = detectProjectStack(dir);
    expect(d.projectType).toBe("boot");
    expect(d.stackVersion).toBe("4.3");
    expect(d.reason).toContain("spring-boot-starter-parent");
  });

  it("spring-boot-starter-parent 만 있고 RTE 의존성이 없으면 거부한다 (일반 Spring Boot 프로젝트)", async () => {
    const dir = await writePom(bootPom("spring-boot-starter-parent", "org.springframework.boot", "2.7.18"));
    expect(() => detectProjectStack(dir)).toThrow(/org\.egovframe\.rte/);
  });

  it("egovframe-boot-starter-parent → boot / 5.1", async () => {
    const dir = await writePom(bootPom("egovframe-boot-starter-parent", "org.egovframe.boot", "5.1.0"));
    const d = detectProjectStack(dir);
    expect(d.projectType).toBe("boot");
    expect(d.stackVersion).toBe("5.1");
  });

  it("<packaging>war</packaging> → war / 4.3", async () => {
    const dir = await writePom(`<project><packaging>war</packaging></project>`);
    const d = detectProjectStack(dir);
    expect(d.projectType).toBe("war");
    expect(d.stackVersion).toBe("4.3");
  });

  it("XML 주석 안의 마커는 무시한다", async () => {
    const dir = await writePom(
      `<project>
  <!-- <parent><artifactId>org.egovframe.boot.starter.parent</artifactId></parent> -->
  <parent><groupId>x</groupId><artifactId>something-else</artifactId><version>1</version></parent>
</project>`,
    );
    expect(() => detectProjectStack(dir)).toThrow(/감지하지 못했습니다/);
  });

  it("감지 실패 메시지는 공식 부모와 legacy 규칙을 모두 안내한다", async () => {
    const dir = await writePom(`<project><parent><groupId>x</groupId><artifactId>other</artifactId><version>1</version></parent></project>`);
    let message = "";
    try {
      detectProjectStack(dir);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("parent.artifactId=egovframe-boot-starter-parent");
    expect(message).toContain("parent.artifactId=org.egovframe.boot.starter.parent");
    expect(message).toContain("parent.artifactId=spring-boot-starter-parent + org.egovframe.rte");
  });

  it("pom.xml 이 없으면 명확한 에러를 낸다", async () => {
    const dir = path.join(tmpRoot, "empty");
    await fs.ensureDir(dir);
    expect(() => detectProjectStack(dir)).toThrow(/pom\.xml 을 찾을 수 없습니다/);
  });
});

describe("detectProjectStack — 실제 scaffold 산출물", () => {
  const BOARD_DDL = `CREATE TABLE BOARD (ID VARCHAR(16) NOT NULL PRIMARY KEY, TITLE VARCHAR(200))`;
  const MEMBER_DDL = `CREATE TABLE MEMBER (ID VARCHAR(16) NOT NULL PRIMARY KEY, EMAIL VARCHAR(100))`;

  async function scaffoldBoot43(): Promise<string> {
    await generateScaffoldProject({
      projectName: "board-app",
      packageName: "egovframework.example.board",
      outputPath: tmpRoot,
      entityName: "Board",
      ddl: BOARD_DDL,
      description: "",
      projectType: "boot",
      stackVersion: "4.3",
    });
    return path.join(tmpRoot, "board-app");
  }

  /**
   * 생성된 pom.xml 을 공식 부모 전환 전 scaffold 가 만들던 형태로 되돌린다:
   * spring-boot-starter-parent 2.7.18 직접 상속 + rte 버전 속성·직접 선언.
   */
  async function downgradeToLegacyPom(projectDir: string): Promise<void> {
    const pomPath = path.join(projectDir, "pom.xml");
    let pom = await fs.readFile(pomPath, "utf-8");
    pom = pom.replace(
      /<parent>[\s\S]*?<\/parent>/,
      `<parent>
		<groupId>org.springframework.boot</groupId>
		<artifactId>spring-boot-starter-parent</artifactId>
		<version>2.7.18</version>
	</parent>`,
    );
    pom = pom.replace(
      "</properties>",
      "\t<org.egovframe.rte.version>4.3.0</org.egovframe.rte.version>\n\t</properties>",
    );
    pom = pom.replace(
      /(<artifactId>org\.egovframe\.rte\.[\w.]+<\/artifactId>)/g,
      "$1\n\t\t\t<version>${org.egovframe.rte.version}</version>",
    );
    await fs.writeFile(pomPath, pom, "utf-8");
  }

  it("현재 scaffold 가 생성한 4.3 Boot 프로젝트는 공식 부모 규칙으로 감지된다", async () => {
    const projectDir = await scaffoldBoot43();
    const d = detectProjectStack(projectDir);
    expect(d.stackVersion).toBe("4.3");
    expect(d.reason).toContain("org.egovframe.boot.starter.parent");
  });

  it("공식 부모 전환 전 scaffold 형태(spring-boot-starter-parent)의 프로젝트도 4.3 Boot 로 감지된다", async () => {
    const projectDir = await scaffoldBoot43();
    await downgradeToLegacyPom(projectDir);
    const pom = await fs.readFile(path.join(projectDir, "pom.xml"), "utf-8");
    expect(pom).toContain("<artifactId>spring-boot-starter-parent</artifactId>");
    expect(pom).not.toContain("org.egovframe.boot.starter.parent");

    const d = detectProjectStack(projectDir);
    expect(d.stackVersion).toBe("4.3");
    expect(d.reason).toContain("spring-boot-starter-parent");
  });

  it("legacy 4.3 Boot 프로젝트에 egov_add_entity 가 여전히 동작한다", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const projectDir = await scaffoldBoot43();
    await downgradeToLegacyPom(projectDir);

    const out = await egovAddEntity({
      projectPath: projectDir,
      packageName: "egovframework.example.member",
      entityName: "Member",
      ddl: MEMBER_DDL,
    });
    expect(out).toMatch(/추가 완료/);
    expect(
      await fs.pathExists(path.join(projectDir, "src/main/java/egovframework/example/member/service/MemberVO.java")),
    ).toBe(true);
  });
});
