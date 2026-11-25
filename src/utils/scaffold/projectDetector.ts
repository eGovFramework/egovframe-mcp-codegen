/**
 * Project Detector
 *
 * 기존 eGovFrame 프로젝트의 `pom.xml` 을 읽어 `projectType` 과 `stackVersion`
 * 을 자동 감지한다. `egov_add_entity` 가 사용자에게서 이 두 값을 받지 않고
 * 프로젝트에서 직접 추론하기 위해 존재한다.
 *
 * 정책
 * ----
 * - 표준 eGovFrame scaffold 가 생성한 pom.xml 의 고정 마커만을 신뢰한다.
 * - 비표준 pom 은 명확한 에러로 거부한다 (사용자가 명시적으로 우회할 수 있는
 *   override 파라미터는 의도적으로 제공하지 않는다).
 *
 * 감지 마커
 * ---------
 * | 결과   | 마커                                                                        |
 * |--------|-----------------------------------------------------------------------------|
 * | war43  | `<packaging>war</packaging>` 존재                                             |
 * | boot50 | parent `<artifactId>egovframe-boot-starter-parent</artifactId>`               |
 * | boot43 | parent `<artifactId>org.egovframe.boot.starter.parent</artifactId>` (공식 부모) |
 * | boot43 | parent `<artifactId>spring-boot-starter-parent</artifactId>` + RTE 의존성      |
 *
 * boot43 의 두 번째 규칙은 공식 부모로 전환하기 전의 scaffold 가 생성한 프로젝트
 * (spring-boot-starter-parent 직접 상속 + RTE 버전 직접 선언) 를 계속 지원하기 위한 것이다.
 *
 * XML 파서 의존성을 새로 들이지 않기 위해 정규식 기반으로 검사한다. 위 마커들은
 * eGovFrame scaffold 가 생성하는 pom.xml 의 고정 구조이므로 정규식이 충분히 안정적이다.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectType, StackVersion } from "./stackMatrix.js";

export interface DetectedStack {
  projectType: ProjectType;
  stackVersion: StackVersion;
  /** 디버깅/리포팅용 — 감지 시 사용된 marker 의 간략 설명. */
  reason: string;
}

/**
 * 프로젝트 루트에서 pom.xml 을 읽어 스택을 감지한다.
 *
 * @throws pom.xml 부재, 읽기 실패, 비표준 구조 시 명확한 한국어 에러 메시지로 실패한다.
 */
/**
 * 기존 프로젝트의 "공유 basePackage" 를 자동 감지한다.
 *
 * 이유: `egov_add_entity` 는 사용자에게 packageName 을 받는데, 그 깊이가 첫 스캐폴드와
 * 다르면 `parts.slice(0, -1)` 로 추출하는 basePackage 가 어긋난다. 이로 인해
 * `FkComboVO` 같은 공유 클래스의 import 경로가 실제 파일 위치와 불일치하여 컴파일이
 * 실패한다.
 *
 * 감지 전략: `src/main/java/**\/cmm/vo/FkComboVO.java` 를 찾아 그 파일의 `package`
 * 선언을 읽고 끝의 `.cmm.vo` 를 떼어내 basePackage 로 반환한다. 첫 스캐폴드가 만든
 * 공유 클래스의 실제 위치가 단일 진실 원본이므로 이 방식은 사용자 입력보다 신뢰할 수 있다.
 *
 * 찾지 못하면 null — 호출자는 fallback (사용자 packageName 기반 추출) 을 그대로 사용한다.
 */
export function detectBasePackage(projectPath: string): string | null {
  const javaRoot = path.join(projectPath, "src/main/java");
  if (!fs.existsSync(javaRoot)) return null;

  const found = findFkComboVO(javaRoot);
  if (!found) return null;

  let content: string;
  try {
    content = fs.readFileSync(found, "utf-8");
  } catch {
    return null;
  }

  const m = /^\s*package\s+([\w.]+)\.cmm\.vo\s*;/m.exec(content);
  return m ? m[1] : null;
}

/**
 * 프로젝트의 `EgovConfigMapper` 가 MyBatis `@Mapper` 로 매퍼를 스캔하는지 감지한다.
 *
 * 이전 버전이 생성한 4.3 Boot 프로젝트는 MyBatis `@Mapper` 로 스캔한다. 이런 프로젝트에
 * 실행환경 `@Mapper` 를 붙인 매퍼를 추가하면 빈으로 등록되지 않아 기동에 실패하므로,
 * 새로 생성하는 매퍼의 어노테이션을 프로젝트의 스캔 설정에 맞추는 데 사용한다.
 */
export function usesApacheMapperScan(projectPath: string): boolean {
  const javaRoot = path.join(projectPath, "src/main/java");
  if (!fs.existsSync(javaRoot)) return false;

  const found = findFileByName(javaRoot, "EgovConfigMapper.java", "config");
  if (!found) return false;

  try {
    return fs.readFileSync(found, "utf-8").includes("org.apache.ibatis.annotations.Mapper");
  } catch {
    return false;
  }
}

/**
 * 첨부파일 인프라(`egov_add_attach_file_infrastructure` 가 설치한 일습) 가
 * 프로젝트에 존재하는지 감지한다.
 *
 * 판정 기준 (양쪽 모두 존재해야 true):
 * - `src/main/java/**\/cmm/service/EgovFileMngService.java`
 * - `src/main/java/**\/config/EgovConfigAttachFile.java` (boot)
 *   또는 `src/main/resources/**\/context-idgn-File.xml` (war)
 *
 * `egov_add_entity` 가 `withAttachment=true` 로 호출되었을 때 사전조건 검사용.
 * 두 파일 중 하나라도 빠지면 false — 호출자는 "먼저 egov_add_attach_file_infrastructure
 * 를 실행하세요" 메시지로 거부한다.
 */
export function detectAttachFileInfra(projectPath: string): {
  present: boolean;
  missing: string[];
} {
  const javaRoot = path.join(projectPath, "src/main/java");
  const resourcesRoot = path.join(projectPath, "src/main/resources");

  const missing: string[] = [];

  const serviceFound = fs.existsSync(javaRoot)
    ? findFileByName(javaRoot, "EgovFileMngService.java", "cmm/service")
    : null;
  if (!serviceFound) missing.push("src/main/java/<basePackage>/cmm/service/EgovFileMngService.java");

  // Boot: EgovConfigAttachFile.java
  const bootConfigFound = fs.existsSync(javaRoot)
    ? findFileByName(javaRoot, "EgovConfigAttachFile.java", "config")
    : null;
  // WAR: context-idgn-File.xml (Spring XML bean 등록 방식)
  const warConfigFound = fs.existsSync(resourcesRoot)
    ? findFileByName(resourcesRoot, "context-idgn-File.xml")
    : null;
  if (!bootConfigFound && !warConfigFound) {
    missing.push(
      "src/main/java/<basePackage>/config/EgovConfigAttachFile.java (boot) 또는 src/main/resources/**/context-idgn-File.xml (war)",
    );
  }

  return { present: missing.length === 0, missing };
}

/**
 * 디렉터리 트리에서 특정 이름의 파일을 깊이우선으로 찾는다.
 * @param root      탐색 시작 디렉터리
 * @param fileName  찾을 파일명 (basename)
 * @param pathHint  부모 경로가 이 문자열을 포함해야 매치 (선택). 예: "cmm/service" → /cmm/service/EgovFileMngService.java
 */
function findFileByName(root: string, fileName: string, pathHint?: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      const r = findFileByName(p, fileName, pathHint);
      if (r) return r;
    } else if (e.isFile() && e.name === fileName) {
      if (!pathHint || p.replace(/\\/g, "/").includes("/" + pathHint + "/")) {
        return p;
      }
    }
  }
  return null;
}

/** src/main/java 하위에서 cmm/vo/FkComboVO.java 를 깊이 우선으로 탐색한다. */
function findFkComboVO(root: string): string | null {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      const r = findFkComboVO(p);
      if (r) return r;
    } else if (e.isFile() && e.name === "FkComboVO.java") {
      // /cmm/vo/FkComboVO.java 패턴 확인
      if (/[\\/]cmm[\\/]vo[\\/]FkComboVO\.java$/.test(p)) return p;
    }
  }
  return null;
}

export function detectProjectStack(projectPath: string): DetectedStack {
  if (!projectPath || typeof projectPath !== "string") {
    throw new Error("projectPath 가 필요합니다.");
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(projectPath);
  } catch {
    throw new Error(
      `projectPath 가 존재하지 않거나 접근할 수 없습니다: ${projectPath}`,
    );
  }
  if (!stat.isDirectory()) {
    throw new Error(`projectPath 는 디렉터리여야 합니다: ${projectPath}`);
  }

  const pomPath = path.join(projectPath, "pom.xml");
  if (!fs.existsSync(pomPath)) {
    throw new Error(
      `pom.xml 을 찾을 수 없습니다 (${pomPath}). egov_add_entity 는 표준 eGovFrame Maven 프로젝트에서만 동작합니다.`,
    );
  }

  let raw: string;
  try {
    raw = fs.readFileSync(pomPath, "utf-8");
  } catch (e) {
    throw new Error(
      `pom.xml 을 읽지 못했습니다 (${pomPath}): ${
        e instanceof Error ? e.message : "Unknown error"
      }`,
    );
  }

  // XML 주석을 제거한 뒤 검사한다 — 주석 안의 가짜 마커가 오감지를 일으키지 않게.
  const pom = raw.replace(/<!--[\s\S]*?-->/g, "");

  const hasWarPackaging = /<packaging>\s*war\s*<\/packaging>/i.test(pom);
  if (hasWarPackaging) {
    // WAR + 5.1 조합은 매트릭스에 존재하지 않는다 (egov_scaffold_project 도 거부).
    return {
      projectType: "war",
      stackVersion: "4.3",
      reason: "<packaging>war</packaging> 감지 → eGovFrame 4.3 WAR",
    };
  }

  // <parent>...<artifactId>...</artifactId>...</parent> 블록 안의 artifactId 만 추출.
  // 일반 <dependency> 의 artifactId 와 혼동하지 않도록 <parent> 블록을 먼저 좁힌다.
  const parentMatch = pom.match(/<parent>([\s\S]*?)<\/parent>/i);
  const parentArtifactId = parentMatch
    ? parentMatch[1].match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/i)?.[1]
    : undefined;

  if (parentArtifactId === "egovframe-boot-starter-parent") {
    return {
      projectType: "boot",
      stackVersion: "5.1",
      reason:
        "parent.artifactId=egovframe-boot-starter-parent → eGovFrame 5.1 Boot",
    };
  }

  if (parentArtifactId === "org.egovframe.boot.starter.parent") {
    return {
      projectType: "boot",
      stackVersion: "4.3",
      reason:
        "parent.artifactId=org.egovframe.boot.starter.parent → eGovFrame 4.3 Boot",
    };
  }

  if (parentArtifactId === "spring-boot-starter-parent") {
    // 공식 부모 전환 전 scaffold 가 생성한 4.3 Boot 프로젝트 (legacy).
    // 4.3 Boot 인지 확인하려면 RTE 의존성도 존재해야 한다 (일반 Spring Boot 프로젝트와 구분).
    if (/org\.egovframe\.rte/i.test(pom)) {
      return {
        projectType: "boot",
        stackVersion: "4.3",
        reason:
          "parent.artifactId=spring-boot-starter-parent + org.egovframe.rte 의존성 → eGovFrame 4.3 Boot",
      };
    }
    throw new Error(
      "spring-boot-starter-parent 는 감지되었지만 'org.egovframe.rte' 의존성을 찾지 못했습니다. " +
        "이 프로젝트는 표준 eGovFrame scaffold 구조가 아닌 것으로 보입니다. egov_add_entity 는 " +
        "표준 eGovFrame Maven 프로젝트에서만 동작합니다.",
    );
  }

  throw new Error(
    "pom.xml 에서 eGovFrame 스택을 감지하지 못했습니다. 감지 가능한 마커:\n" +
      "  - <packaging>war</packaging>                                           → eGovFrame 4.3 WAR\n" +
      "  - parent.artifactId=egovframe-boot-starter-parent                       → eGovFrame 5.1 Boot\n" +
      "  - parent.artifactId=org.egovframe.boot.starter.parent                   → eGovFrame 4.3 Boot\n" +
      "  - parent.artifactId=spring-boot-starter-parent + org.egovframe.rte      → eGovFrame 4.3 Boot (공식 부모 전환 전 scaffold)\n\n" +
      "이 프로젝트는 표준 eGovFrame scaffold 구조가 아닌 것으로 보입니다. egov_add_entity 는 " +
      "표준 eGovFrame Maven 프로젝트에서만 동작합니다.",
  );
}
