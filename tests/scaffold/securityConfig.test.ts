/**
 * boot50 스캐폴드 보안 설정 검증
 *
 * 공통컴포넌트 security 방식(egov-security-config.properties +
 * egovframe-rte-fdl-security 의 EgovSecurityConfiguration)을 참조해 생성
 * 프로젝트에 이식한 보안 기능 4종을 문자열 수준에서 검증한다.
 *
 * - 보안 헤더: sniff / xframeOptions / xssProtection / cacheControl 대응
 *   프로퍼티(`egov.security.headers.*`)와 EgovConfigWebSecurity 의 헤더 매핑
 * - CSRF: csrf / csrf-access-denied-url 프로퍼티, EgovCsrfControllerAdvice,
 *   접근 거부 컨트롤러/뷰/메시지, 화면 hidden 토큰·meta 주입과 GET 유출 방지
 * - StrictHttpFirewall: 암묵 기본값의 명시적 빈 선언과 400 거부 핸들러
 * - CORS: egov.security.cors.* 화이트리스트 (기본 비활성)
 *
 * boot43/war43 미적용(Phase A: boot50 전용)은 각 스택의 골든 테스트가
 * 해시 동일성으로 보장하므로 여기서 별도 스캐폴드를 돌리지 않는다.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "node:url";
import { generateScaffoldProject } from "../../src/utils/scaffold/scaffoldGenerator.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

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
    stackVersion: "5.1",
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

describe("CSRF — EgovConfigWebSecurity", () => {
  const CONFIG_PATH =
    "src/main/java/egovframework/example/config/EgovConfigWebSecurity.java";

  it("csrf 프로퍼티(기본 true)로 Spring Security 기본 CSRF 보호를 켠다 (참조: csrf=true)", () => {
    const config = read(CONFIG_PATH);
    expect(config).toContain("${egov.security.csrf:true}");
    expect(config).toContain("http.csrf(Customizer.withDefaults())");
    // 비활성 경로도 유지 (csrf=false 시 참조 구현과 동일하게 완전 비활성)
    expect(config).toContain("http.csrf(AbstractHttpConfigurer::disable)");
  });

  it("CSRF 예외는 csrf-access-denied-url 로 1회만 포워드한다 (참조의 이중 포워드 결함 교정)", () => {
    const config = read(CONFIG_PATH);
    expect(config).toContain("${egov.security.csrf-access-denied-url:/egovCSRFAccessDenied.do}");
    expect(config).toContain("MissingCsrfTokenException");
    expect(config).toContain("InvalidCsrfTokenException");
    expect(config).toContain("accessDeniedHandler");
    expect(config).toMatch(/getRequestDispatcher\(csrfAccessDeniedUrl\)\.forward/);
    // 참조 EgovAccessDeniedHandler 처럼 무조건 포워드 후 재포워드하는 구조가 아니어야 한다
    expect(config).toMatch(/\}\s*else\s*\{\s*\n\s*response\.sendError/);
  });
});

describe("StrictHttpFirewall — EgovConfigWebSecurity", () => {
  const CONFIG_PATH =
    "src/main/java/egovframework/example/config/EgovConfigWebSecurity.java";

  it("암묵 기본값이던 StrictHttpFirewall 을 명시적 빈으로 드러낸다", () => {
    // 참조 구현은 FilterChainProxy 기본값에 암묵 의존 — 생성 코드는 정책을 코드로 명시한다.
    const config = read(CONFIG_PATH);
    expect(config).toContain("public StrictHttpFirewall httpFirewall()");
    expect(config).toContain("new StrictHttpFirewall()");
  });

  it("기본 차단 정책(인코딩된 구분자 거부)을 기본값 그대로 명시한다", () => {
    const config = read(CONFIG_PATH);
    expect(config).toContain("setAllowUrlEncodedSlash(false)");
    expect(config).toContain("setAllowBackSlash(false)");
    expect(config).toContain("setAllowUrlEncodedPercent(false)");
    expect(config).toContain("setAllowSemicolon(false)");
    expect(config).toContain("setAllowUrlEncodedPeriod(false)");
    expect(config).toContain("setAllowUrlEncodedDoubleSlash(false)");
  });

  it("암묵 기본값이던 400 거부 핸들러를 명시적 빈으로 드러낸다", () => {
    const config = read(CONFIG_PATH);
    // FilterChainProxy 기본 핸들러와 동일 (HttpStatusRequestRejectedHandler, 기본 400)
    expect(config).toContain("new HttpStatusRequestRejectedHandler()");
    expect(config).toContain("public WebSecurityCustomizer webSecurityCustomizer(");
    expect(config).toContain("web.httpFirewall(");
    expect(config).toContain("web.requestRejectedHandler(");
  });
});

describe("CORS — EgovConfigWebSecurity", () => {
  const CONFIG_PATH =
    "src/main/java/egovframework/example/config/EgovConfigWebSecurity.java";

  it("기본값은 비활성 — 참조 구현(설정 전무 = 암묵 차단)과 동일한 자세다", () => {
    const config = read(CONFIG_PATH);
    expect(config).toContain("${egov.security.cors.enabled:false}");
    expect(config).toContain("http.cors(AbstractHttpConfigurer::disable)");
  });

  it("활성 시 화이트리스트 프로퍼티로 CorsConfigurationSource 를 구성한다", () => {
    const config = read(CONFIG_PATH);
    expect(config).toContain("${egov.security.cors.allowed-origins:}");
    expect(config).toContain("${egov.security.cors.allowed-methods:GET,POST}");
    expect(config).toContain("${egov.security.cors.allowed-headers:*}");
    expect(config).toContain("${egov.security.cors.allow-credentials:false}");
    expect(config).toContain("${egov.security.cors.max-age:1800}");
    expect(config).toContain("UrlBasedCorsConfigurationSource");
    expect(config).toContain('registerCorsConfiguration("/**"');
    expect(config).toMatch(/http\.cors\(cors -> cors\.configurationSource/);
  });
});

describe("CORS — application.properties", () => {
  it("cors 프로퍼티 기본값이 비활성 화이트리스트 방식으로 생성된다", () => {
    const props = read("src/main/resources/application.properties");
    expect(props).toContain("egov.security.cors.enabled=false");
    expect(props).toContain("egov.security.cors.allowed-origins=");
    expect(props).toContain("egov.security.cors.allowed-methods=GET,POST");
    expect(props).toContain("egov.security.cors.allowed-headers=*");
    expect(props).toContain("egov.security.cors.allow-credentials=false");
    expect(props).toContain("egov.security.cors.max-age=1800");
  });
});

describe("CSRF — 토큰 노출 (EgovCsrfControllerAdvice)", () => {
  it("공통컴포넌트와 동명의 @ControllerAdvice 가 ${_csrf} 모델 속성을 노출한다", () => {
    const advice = read(
      "src/main/java/egovframework/example/cmm/web/EgovCsrfControllerAdvice.java",
    );
    expect(advice).toContain("@ControllerAdvice");
    expect(advice).toContain('@ModelAttribute("_csrf")');
    expect(advice).toContain("CsrfToken");
    // csrf 비활성 시 null 반환 → 화면의 th:if 가드가 조용히 생략
    expect(advice).toContain("${egov.security.csrf:true}");
    expect(advice).toContain("return null;");
  });
});

describe("CSRF — 접근 거부 화면", () => {
  it("/egovCSRFAccessDenied.do 컨트롤러가 생성된다 (참조: EgovComIndexController)", () => {
    const controller = read(
      "src/main/java/egovframework/example/cmm/web/EgovCsrfAccessDeniedController.java",
    );
    expect(controller).toContain('@RequestMapping("/egovCSRFAccessDenied.do")');
    expect(controller).toContain('"cmm/error/csrfAccessDenied"');
  });

  it("csrfAccessDenied 뷰와 메시지 키가 생성된다", () => {
    const view = read(
      "src/main/resources/templates/thymeleaf/cmm/error/csrfAccessDenied.html",
    );
    expect(view).toContain("#{fail.common.csrf}");

    const msgKo = read(
      "src/main/resources/egovframework/message/message-common.properties",
    );
    expect(msgKo).toContain("fail.common.csrf=");
    const msgEn = read(
      "src/main/resources/egovframework/message/message-common_en.properties",
    );
    expect(msgEn).toContain("fail.common.csrf=");
  });
});

describe("CSRF — 화면 토큰 주입", () => {
  // 생성 화면은 th:action 없이 jQuery 로 action 을 지정해 submit 하므로
  // Thymeleaf 의 자동 hidden 필드 주입이 동작하지 않는다. 공통컴포넌트 JSP 처럼
  // 명시적 hidden 필드 + meta 태그를 넣되, ${_csrf} null 가드로 Spring Security
  // 가 없는 기존 프로젝트에 egov_add_entity 로 추가돼도 화면이 깨지지 않아야 한다.
  const HIDDEN =
    'th:if="${_csrf != null}" th:name="${_csrf.parameterName}" th:value="${_csrf.token}"';

  it("목록 화면 listForm 에 CSRF hidden 필드가 들어간다 (등록/상세 이동이 POST)", () => {
    const list = read(
      "src/main/resources/templates/thymeleaf/board/egovBoardList.html",
    );
    expect(list).toContain(HIDDEN);
    expect(list).toContain('name="_csrf"');
    expect(list).toContain('name="_csrf_header"');
  });

  it("등록/수정 화면 detailForm 에 CSRF hidden 필드와 meta 태그가 들어간다", () => {
    const register = read(
      "src/main/resources/templates/thymeleaf/board/egovBoardRegister.html",
    );
    expect(register).toContain(HIDDEN);
    expect(register).toContain('name="_csrf"');
    expect(register).toContain('name="_csrf_header"');
  });

  it("GET 제출 경로는 CSRF hidden 필드를 disabled 처리해 토큰의 URL 유출을 막는다", () => {
    // 검색/페이지네이션/목록 복귀는 같은 폼을 method=get 으로 submit 한다.
    // disabled 컨트롤은 직렬화되지 않으므로 토큰이 쿼리스트링에 실리지 않는다.
    const disableOn = "$('#csrfField').prop('disabled', true);";
    const enableOn = "$('#csrfField').prop('disabled', false);";
    const count = (s: string, needle: string) => s.split(needle).length - 1;

    const list = read(
      "src/main/resources/templates/thymeleaf/board/egovBoardList.html",
    );
    expect(list).toContain('id="csrfField"');
    expect(count(list, disableOn), "목록 화면 GET 경로(검색·페이지네이션) 2곳").toBe(2);
    expect(count(list, enableOn), "목록 화면 POST 경로(등록·상세 이동) 2곳").toBe(2);

    const register = read(
      "src/main/resources/templates/thymeleaf/board/egovBoardRegister.html",
    );
    expect(register).toContain('id="csrfField"');
    expect(count(register, disableOn), "등록 화면 GET 경로(목록 복귀) 1곳").toBe(1);
    expect(count(register, enableOn), "등록 화면 POST 경로(등록·수정·삭제) 3곳").toBe(3);
  });

  it("첨부파일 삭제 fetch 는 meta 태그에서 읽은 CSRF 헤더를 전송한다 (템플릿 소스 검증)", () => {
    // withAttachment 분기는 기본 스캐폴드에서 렌더링되지 않으므로 템플릿 소스로 검증한다.
    const template = fs.readFileSync(
      path.join(
        TEST_DIR,
        "../../templates/boot50/thymeleaf/entityRegister.html.hbs",
      ),
      "utf-8",
    );
    expect(template).toContain('meta[name="_csrf_header"]');
    expect(template).toMatch(/headers\[csrfHeaderMeta\.content\]\s*=\s*csrfTokenMeta\.content/);
  });
});
