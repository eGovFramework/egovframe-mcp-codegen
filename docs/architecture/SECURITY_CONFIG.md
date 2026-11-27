# 5.1 Boot 보안 설정

`egov_scaffold_project` 가 생성하는 5.1 Boot 프로젝트에는 Spring Security 설정이 기본으로 들어갑니다. 이 설정은 보안 응답 헤더, CSRF 보호, StrictHttpFirewall, CORS 의 4가지 기능을 제공합니다. 이 문서는 각 기능의 구현 방식과, 참조한 공통컴포넌트와의 차이를 설명합니다.

## 적용 범위

- 5.1 Boot 에만 적용됩니다. 4.3 Boot 와 4.3 WAR 산출물에는 Spring Security 의존성과 CSRF 처리가 들어가지 않습니다.
- 프로젝트를 생성할 때 항상 포함되며, 포함 여부를 고르는 인자는 없습니다. 공통컴포넌트 배포본이 security 방식을 기본으로 켜 두는 것과 같은 방침입니다.
- 생성되는 프로젝트에는 로그인과 권한 관리가 없습니다. 그래서 인증 필터와 DB 기반 권한 매핑을 포함하는 `egovframe-rte-fdl-security` 를 쓰지 않고, `spring-boot-starter-security` 위에 같은 구조의 설정을 `EgovConfigWebSecurity` 클래스로 구현했습니다. 모든 요청은 `anyRequest().permitAll()` 로 허용하며, 인증을 도입할 위치를 코드의 주석으로 안내합니다.

## 참조 기준

구현은 표준프레임워크 공통컴포넌트 템플릿의 security 방식(`Globals.Auth = security`)을 기준으로 삼았습니다. 공통컴포넌트는 `egovframework/egovProps/conf/egov-security-config.properties` 를 `egovframe-rte-fdl-security` 의 `EgovSecurityConfiguration` 이 읽어서 Spring Security 필터 체인을 구성합니다.

| 기능 | 공통컴포넌트 (security 방식) | 생성되는 코드 (5.1 Boot) |
|------|------------------------------|--------------------------|
| 보안 응답 헤더 | `sniff`, `xframeOptions`, `xssProtection`, `cacheControl` 설정을 `http.headers()` 에 매핑 | `egov.security.headers.*` 프로퍼티를 `EgovConfigWebSecurity` 가 같은 분기 구조(SAMEORIGIN, DISABLE, 그 외 DENY)로 매핑 |
| CSRF | `csrf=true` 일 때 `http.csrf(withDefaults())`, `EgovCsrfControllerAdvice` 로 토큰을 모델에 노출, 접근 거부 시 `csrfAccessDeniedUrl` 로 포워드, JSP 의 hidden 필드와 AJAX 헤더 | `egov.security.csrf` 프로퍼티, 같은 이름의 `EgovCsrfControllerAdvice`, `egov.security.csrf-access-denied-url` 로 포워드하는 핸들러와 `/egovCSRFAccessDenied.do` 화면, Thymeleaf 의 hidden 필드와 meta 태그 기반 `fetch` 헤더 |
| StrictHttpFirewall | 명시적인 설정이 없고 `FilterChainProxy` 의 기본값에 의존 | `StrictHttpFirewall` 빈, 400 으로 응답하는 `HttpStatusRequestRejectedHandler` 빈, `WebSecurityCustomizer` 빈을 명시적으로 등록 |
| CORS | 설정이 없어서 교차 출처 요청은 브라우저의 동일 출처 정책과 CSRF 로 차단 | `egov.security.cors.*` 프로퍼티. 기본값은 비활성(`enabled=false`)이며, 활성화하면 지정한 출처만 허용하는 `CorsConfigurationSource` 를 구성 |

## 생성되는 파일

| 파일 | 출력 경로 (`src/main/` 기준) | 역할 |
|------|------------------------------|------|
| `EgovConfigWebSecurity.java` | `java/<기본 패키지>/config/` | 필터 체인, 헤더, CSRF, 방화벽, CORS 설정. CSRF 접근 거부 핸들러를 중첩 클래스로 포함합니다. |
| `EgovCsrfControllerAdvice.java` | `java/<기본 패키지>/cmm/web/` | CSRF 토큰을 모든 화면의 모델에 `_csrf` 로 노출합니다. |
| `EgovCsrfAccessDeniedController.java` | `java/<기본 패키지>/cmm/web/` | `/egovCSRFAccessDenied.do` 요청을 접근 거부 화면으로 연결합니다. |
| `csrfAccessDenied.html` | `resources/templates/thymeleaf/cmm/error/` | CSRF 접근 거부 화면입니다. |

이 밖에 `pom.xml` 에 `spring-boot-starter-security` 의존성이, `application.properties` 에 아래의 프로퍼티가, 메시지 번들에 `fail.common.csrf` 키가, 엔티티의 목록 화면과 등록 화면에 CSRF 토큰 처리가 들어갑니다. `EgovConfigWeb` 은 `EgovConfigWebSecurity` 를 `@Import` 합니다.

## 프로퍼티

`application.properties` 에 다음 키가 생성됩니다. 값을 바꾸고 애플리케이션을 다시 시작하면 적용됩니다.

```properties
# 보안 응답 헤더 (기본값은 공통컴포넌트의 egov-security-config.properties 와 같음)
egov.security.headers.sniff=true
egov.security.headers.xframe-options=SAMEORIGIN
egov.security.headers.xss-protection=true
egov.security.headers.cache-control=true

# CSRF
egov.security.csrf=true
egov.security.csrf-access-denied-url=/egovCSRFAccessDenied.do

# CORS (기본 비활성)
egov.security.cors.enabled=false
egov.security.cors.allowed-origins=
egov.security.cors.allowed-methods=GET,POST
egov.security.cors.allowed-headers=*
egov.security.cors.allow-credentials=false
egov.security.cors.max-age=1800

# 인증을 도입하지 않은 상태에서 기본 계정이 자동으로 만들어지지 않게 함
spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration
```

## 참조 구현과 다르게 한 부분

### 1. cacheControl 의 의미

`egovframe-rte-fdl-security` 5.0.x 는 `cacheControl=true` 일 때 `CacheControlHeadersWriter` 를 비활성화합니다. 프로퍼티의 이름과 반대로 동작하는 것이며, 공통컴포넌트 배포본의 값이 `cacheControl=true` 이므로 실제로는 이 헤더가 출력되지 않습니다.

생성되는 코드는 프로퍼티의 이름대로 `true` 일 때 헤더를 켭니다. 기본값이 `true` 이므로 동적 응답에 `Cache-Control: no-cache, no-store` 계열의 헤더가 출력됩니다. 이는 참조 구현의 실제 동작보다 엄격한 방향입니다.

KRDS 정적 자산의 캐싱은 유지됩니다. `EgovConfigWeb` 이 정적 리소스 핸들러에 `setCachePeriod(3600)` 을 지정하며, Spring Security 의 헤더 작성기는 캐시 헤더가 이미 있는 응답을 건너뛰기 때문입니다.

### 2. CSRF 접근 거부 시의 포워드

참조 라이브러리의 `EgovAccessDeniedHandler` 는 모든 접근 거부 예외에 대해 `accessDeniedUrl` 로 포워드한 뒤, CSRF 예외이면 `csrfAccessDeniedUrl` 로 한 번 더 포워드합니다. 생성되는 코드는 CSRF 예외일 때 응답 상태를 403 으로 설정하고 한 번만 포워드하며, 그 밖의 접근 거부는 `sendError(403)` 으로 처리합니다. 이 핸들러는 `egov.security.csrf=true` 일 때만 등록됩니다.

### 3. StrictHttpFirewall 의 명시

참조 구현은 Spring Security 의 기본값에 의존하지만, 생성되는 코드는 `StrictHttpFirewall` 을 빈으로 등록합니다. 인코딩된 슬래시와 역슬래시, `%25`, 세미콜론을 거부하는 등의 차단 정책과, 거부한 요청에 400 으로 응답하는 동작은 기본값과 같습니다. 목적은 정책을 바꿀 위치를 코드에 드러내는 것입니다.

### 4. 폼의 토큰 주입 방식

생성되는 Thymeleaf 화면은 폼에 `th:action` 을 쓰지 않고 스크립트로 action 을 지정해서 제출합니다. 이 방식에서는 Thymeleaf 가 CSRF hidden 필드를 자동으로 넣어 주지 않으므로, 다음과 같이 직접 넣습니다.

- 폼 안에 `id="csrfField"` 인 hidden 필드를 두고, 이름과 값을 `_csrf.parameterName` 과 `_csrf.token` 에서 가져옵니다.
- `<head>` 에 토큰과 헤더 이름을 담은 meta 태그를 두고, `fetch` 요청은 이 값을 요청 헤더에 싣습니다.
- 두 요소 모두 `th:if="${_csrf != null}"` 조건이 붙어 있어서, Spring Security 를 제거한 프로젝트에서도 화면이 깨지지 않습니다.

엔티티 화면에서는 하나의 폼이 GET 요청(검색, 페이지 이동, 목록으로 돌아가기)과 POST 요청(등록, 수정, 삭제)에 함께 쓰입니다. GET 으로 제출하는 경로에서는 스크립트가 hidden 필드를 `disabled` 로 바꾸어, 토큰이 URL 의 쿼리 문자열에 실려서 브라우저 이력이나 접근 로그에 남는 일을 막습니다. 조회 화면(`egov_add_query_view`)은 GET 전용 폼이어서 CSRF 처리가 들어가지 않습니다.

### 5. 기본 계정의 자동 생성 차단

인증을 도입하지 않은 상태에서 `spring-boot-starter-security` 는 임의의 비밀번호를 가진 기본 계정을 만들고 그 비밀번호를 로그에 출력합니다. 이를 막기 위해 `UserDetailsServiceAutoConfiguration` 을 자동 구성에서 제외합니다. 인증을 도입할 때에는 이 설정을 제거해야 하며, `application.properties` 의 주석이 이를 안내합니다.

## multipart 업로드와 CSRF

`withAttachment=true` 로 만든 엔티티의 등록(수정) 폼은 `multipart/form-data` 로 제출되고, CSRF 토큰은 multipart 본문의 한 파트로 전송됩니다. CSRF 필터가 이 토큰을 읽을 수 있는 것은, Spring Boot 가 `DispatcherServlet` 에 multipart 설정을 등록해 두어서 내장 Tomcat 이 `getParameter` 를 호출하는 시점에 파트를 파싱하기 때문입니다. 이 동작은 서블릿 컨테이너에 따라 달라질 수 있으며, 내장 Tomcat 을 기준으로 확인한 것입니다.

이 구조에서는 업로드한 파일이 `spring.servlet.multipart.max-file-size` 를 넘으면 파트 파싱이 실패해서 CSRF 필터가 토큰을 읽지 못합니다. 그 결과 첨부파일 안내 화면(`cmm/uploadError`)이 아니라 CSRF 접근 거부 화면이 표시됩니다. 용량 초과를 CSRF 검사보다 먼저 구분하는 처리는 구현되어 있지 않습니다.

첨부파일 1건을 삭제하는 요청은 multipart 가 아닌 `fetch` 요청이며, meta 태그에서 읽은 토큰을 요청 헤더에 싣습니다.

## 인증을 도입할 때

- `EgovConfigWebSecurity` 의 `authorizeHttpRequests` 에서 `anyRequest().permitAll()` 을 프로젝트의 접근 정책으로 바꿉니다.
- `application.properties` 의 `spring.autoconfigure.exclude` 줄을 제거하거나, 직접 정의한 `UserDetailsService` 로 대체합니다.
- 첨부파일 인프라를 설치했다면 다운로드 URL(`/cmm/fms/FileDown.do`)에 접근 제어 규칙을 추가합니다. 기본 상태에서는 누구나 이 URL 에 접근할 수 있습니다.

## 테스트

- `tests/scaffold/securityConfig.test.ts` 는 5.1 Boot 프로젝트를 생성한 뒤, 렌더링된 `pom.xml`, 설정 클래스, 프로퍼티, 화면 템플릿의 내용을 기능별로 검증합니다.
- `tests/scaffold/__golden__/boot50.json` 은 5.1 Boot 산출물 전체의 해시를 고정합니다. 보안 설정 템플릿(`templates/boot50/`)을 고쳤을 때 `boot43.json` 과 `war.json` 이 바뀌지 않아야, 이 설정이 5.1 Boot 에만 적용된다는 조건이 지켜진 것입니다.
- 매니페스트의 항목 수를 검증하는 `tests/scaffold/manifestLoader.test.ts` 는 항목을 추가하거나 뺄 때 함께 고칩니다.
