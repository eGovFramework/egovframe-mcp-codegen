/**
 * boot50 스캐폴드 보안 설정 검증
 *
 * 공통컴포넌트 security 방식(egov-security-config.properties +
 * egovframe-rte-fdl-security 의 EgovSecurityConfiguration)을 참조해 생성
 * 프로젝트에 이식한 보안 기능을 문자열 수준에서 검증한다.
 *
 * - 보안 헤더: sniff / xframeOptions / xssProtection / cacheControl 대응
 *   프로퍼티(`egov.security.headers.*`)와 EgovConfigWebSecurity 의 헤더 매핑
 *
 * boot43/war43 미적용(Phase A: boot50 전용)은 각 스택의 골든 테스트가
 * 해시 동일성으로 보장하므로 여기서 별도 스캐폴드를 돌리지 않는다.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const BOARD_DDL = `CREATE TABLE tb_board (
  board_id    VARCHAR(20) NOT NULL,
  title       VARCHAR(200) NOT NULL,
  content     TEXT,
  use_yn      CHAR(1),
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (board_id)
)`;

let projectDir = "";

function read(relPath: string): string {
  const abs = path.join(projectDir, relPath);
  expect(fs.existsSync(abs), `${relPath} 가 생성되어야 한다`).toBe(true);
  return fs.readFileSync(abs, "utf-8");
}

beforeAll(async () => {
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), "security-config-"));
  const resultJson = await generateScaffoldProject({
    projectName: "security-config-test",
    packageName: "egovframework.example.board",
    outputPath: tmpOut,
    entityName: "Board",
    ddl: BOARD_DDL,
    description: "security config test",
    projectType: "boot",
    stackVersion: "5.0",
  });
  projectDir = JSON.parse(resultJson).projectDir;
});

describe("보안 헤더 — pom.xml", () => {
  it("spring-boot-starter-security 의존성이 추가된다", () => {
    const pom = read("pom.xml");
    expect(pom).toContain("<artifactId>spring-boot-starter-security</artifactId>");
  });
});

describe("보안 헤더 — EgovConfigWebSecurity", () => {
  const CONFIG_PATH =
    "src/main/java/egovframework/example/config/EgovConfigWebSecurity.java";

  it("@EnableWebSecurity 설정 클래스가 생성된다", () => {
    const config = read(CONFIG_PATH);
    expect(config).toContain("@Configuration");
    expect(config).toContain("@EnableWebSecurity");
    expect(config).toContain("public class EgovConfigWebSecurity");
    expect(config).toContain("SecurityFilterChain");
  });

  it("인증 미도입 상태이므로 모든 요청을 permitAll 로 허용한다", () => {
    const config = read(CONFIG_PATH);
    expect(config).toMatch(/anyRequest\(\)\s*\.permitAll\(\)/);
  });

  it("egov-security-config.properties 대응 헤더 프로퍼티를 주입받는다", () => {
    const config = read(CONFIG_PATH);
    expect(config).toContain("${egov.security.headers.sniff:true}");
    expect(config).toContain("${egov.security.headers.xframe-options:SAMEORIGIN}");
    expect(config).toContain("${egov.security.headers.xss-protection:true}");
    expect(config).toContain("${egov.security.headers.cache-control:true}");
  });

  it("sniff → X-Content-Type-Options 매핑 (참조 구현과 동일 구조)", () => {
    const config = read(CONFIG_PATH);
    expect(config).toContain("contentTypeOptions(Customizer.withDefaults())");
    expect(config).toContain("ContentTypeOptionsConfig::disable");
  });

  it("xframeOptions → SAMEORIGIN/DISABLE/기타→DENY 스위치 매핑 (참조 구현과 동일 구조)", () => {
    const config = read(CONFIG_PATH);
    expect(config).toContain('case "SAMEORIGIN"');
    expect(config).toContain('case "DISABLE"');
    expect(config).toContain("FrameOptionsConfig::sameOrigin");
    expect(config).toContain("FrameOptionsConfig::deny");
  });

  it("xssProtection → X-XSS-Protection 매핑 (참조 구현과 동일 구조)", () => {
    const config = read(CONFIG_PATH);
    expect(config).toContain("xssProtection(Customizer.withDefaults())");
    expect(config).toContain("XXssConfig::disable");
  });

  it("폼 CSRF 토큰이 없는 스캐폴드 상태에서는 CSRF 보호를 비활성한다", () => {
    // 이 줄이 사라진 채 starter-security 만 남으면 Spring Security 기본값(CSRF on)이
    // 적용되어 생성 화면의 등록/수정/삭제 POST 가 전부 403 이 된다.
    const config = read(CONFIG_PATH);
    expect(config).toContain("http.csrf(AbstractHttpConfigurer::disable)");
  });

  it("cacheControl 은 참조 라이브러리의 반전 의미를 바로잡아 true=활성이다", () => {
    const config = read(CONFIG_PATH);
    // true → CacheControlHeadersWriter 활성 (라이브러리 5.0.x 의 반전 버그를 이식하지 않음)
    expect(config).toMatch(
      /if\s*\(cacheControl\)\s*\{\s*\n\s*headers\.cacheControl\(Customizer\.withDefaults\(\)\)/,
    );
    expect(config).toContain("CacheControlConfig::disable");
  });
});

describe("보안 헤더 — application.properties", () => {
  it("egov.security.headers.* 기본값이 참조 구현의 기본값과 일치한다", () => {
    const props = read("src/main/resources/application.properties");
    expect(props).toContain("egov.security.headers.sniff=true");
    expect(props).toContain("egov.security.headers.xframe-options=SAMEORIGIN");
    expect(props).toContain("egov.security.headers.xss-protection=true");
    expect(props).toContain("egov.security.headers.cache-control=true");
  });

  it("인증 미사용 상태의 기본 계정 자동 생성(generated password)을 비활성화한다", () => {
    const props = read("src/main/resources/application.properties");
    expect(props).toContain(
      "spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration",
    );
  });
});

describe("보안 헤더 — EgovConfigWeb 연결", () => {
  it("EgovConfigWeb 의 @Import 목록에 EgovConfigWebSecurity 가 포함된다", () => {
    const configWeb = read(
      "src/main/java/egovframework/example/config/EgovConfigWeb.java",
    );
    expect(configWeb).toContain("EgovConfigWebSecurity.class");
  });

  it("정적 리소스 핸들러가 자체 Cache-Control 을 설정해 no-store 전면 적용을 피한다", () => {
    // CacheControlHeadersWriter 는 응답에 캐시 헤더가 이미 있으면 건너뛴다.
    // 핸들러에 cachePeriod 가 없으면 588개 KRDS 정적 자산이 매 페이지마다 재다운로드된다.
    const configWeb = read(
      "src/main/java/egovframework/example/config/EgovConfigWeb.java",
    );
    for (const handler of ["/css/**", "/images/**", "/img/**", "/js/**", "/fonts/**"]) {
      const idx = configWeb.indexOf(`"${handler}"`);
      expect(idx, `${handler} 핸들러가 존재해야 한다`).toBeGreaterThan(-1);
      const line = configWeb.slice(idx, configWeb.indexOf("\n", idx));
      expect(line, `${handler} 핸들러에 setCachePeriod 가 있어야 한다`).toContain(
        "setCachePeriod",
      );
    }
  });
});
