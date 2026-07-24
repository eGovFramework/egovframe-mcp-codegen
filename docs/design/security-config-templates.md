# boot50 스캐폴드 보안 설정 설계

`egov_scaffold_project` 가 생성하는 boot50 프로젝트에 4가지 보안 기능
— **보안 응답 헤더, CSRF, StrictHttpFirewall, CORS** — 을 내장한다.

> 이 문서는 4개 기능을 **개별 브랜치의 순차 커밋**으로 도입하는 시리즈의
> 상위 설계다. 아래 대응 표의 "상태" 열이 커밋 시점 기준의 구현 여부를
> 나타내며, 각 기능 커밋에서 갱신한다.

구현 방식은 전자정부 표준프레임워크 **공통컴포넌트 템플릿의 security 방식**
(`Globals.Auth = security`) 을 참조 기준으로 삼는다. 공통컴포넌트 5.0.0 은
`egovframework/egovProps/conf/egov-security-config.properties` 를
`egovframe-rte-fdl-security` 5.0.1 의 `EgovSecurityConfiguration`
(`@Configuration @EnableWebSecurity`) 이 읽어 Spring Security 6.5
필터 체인을 구성한다.

## 적용 범위

- **boot50 전용** (Phase A). attach-file / query-view 와 동일한 단계적 적용
  관례를 따른다. boot43 / war43 은 별도 템플릿 트리이며 후속 과제.
- 스캐폴드 시점에 framework-scope 매니페스트 항목으로 항상 생성된다
  (공통컴포넌트 배포본이 security 방식을 기본값으로 켜 두는 것과 동일한 자세).
- 생성 프로젝트는 인증(로그인/권한 DB)이 없으므로 rte-fdl-security 라이브러리
  전체(로그인 필터·DB 권한 매핑)를 끌어오지 않고, 참조 구현과 동일한 구조의
  설정을 `spring-boot-starter-security` 기반 `EgovConfigWebSecurity` 로 이식한다.
  `authorizeHttpRequests → anyRequest().permitAll()` 이 공통컴포넌트
  `permitAllList` 전체 허용에 대응하며, 인증 도입 지점은 주석으로 안내한다.

## 참조 → 생성 코드 대응

| 기능 | 상태 | 공통컴포넌트 (security 방식) | 생성 코드 (boot50) |
|---|---|---|---|
| 보안 헤더 | 구현됨 | `sniff` / `xframeOptions` / `xssProtection` / `cacheControl` → `EgovSecurityConfiguration` 의 `http.headers()` 매핑 | `egov.security.headers.*` (application.properties) → `EgovConfigWebSecurity.configureSecurityHeaders()` — 동일한 분기 구조 (SAMEORIGIN / DISABLE / 그 외 DENY 등) |
| CSRF | 구현됨 | `csrf=true` → `http.csrf(withDefaults())`, `EgovCsrfControllerAdvice`(`${_csrf}` 모델 노출), `csrfAccessDeniedUrl` 포워드(`EgovAccessDeniedHandler`), JSP hidden 필드 + AJAX 헤더 | `egov.security.csrf` → `http.csrf(withDefaults())`, 동명 `EgovCsrfControllerAdvice`, `egov.security.csrf-access-denied-url` 포워드 핸들러 + `/egovCSRFAccessDenied.do` 컨트롤러/뷰, Thymeleaf hidden 필드 + meta 태그 기반 fetch 헤더 |
| StrictHttpFirewall | 구현됨 | 명시 설정 없음 — `FilterChainProxy` 기본값(StrictHttpFirewall)에 암묵 의존 | 암묵 기본값을 **명시적 빈**으로 문서화: `StrictHttpFirewall` + `HttpStatusRequestRejectedHandler`(400) + `WebSecurityCustomizer` |
| CORS | 후속 커밋 | 설정 전무 — 교차 출처는 브라우저 동일출처정책과 CSRF 로 암묵 차단 | `egov.security.cors.*` — 기본 `enabled=false` (참조와 동일한 차단 자세). 필요 시 화이트리스트 origin 만 허용하는 `CorsConfigurationSource` 구성 |

## 참조 구현과 의도적으로 다르게 한 것

1. **cacheControl 의미 정방향화** — rte-fdl-security 5.0.x 는
   `cacheControl=true` 일 때 `CacheControlHeadersWriter` 를 **비활성**하는
   반전된 동작을 한다 (라이브러리 버그로 판단). 공통컴포넌트 배포본은
   `cacheControl=true` 이므로 실제 런타임에서는 이 헤더가 **출력되지 않는다**.
   생성 코드는 프로퍼티 이름 그대로 `true=활성` 으로 동작하며, 기본값 `true`
   이므로 동적 응답에 `Cache-Control: no-cache, no-store …` 를 내보낸다
   (참조 구현의 실효 동작보다 엄격한 방향의 교정). 정적 리소스 핸들러
   (`EgovConfigWeb`) 에는 `setCachePeriod` 를 부여해 — writer 는 캐시 헤더가
   이미 있는 응답을 건너뛰므로 — KRDS 정적 자산 캐싱을 유지한다.
2. **CSRF 접근 거부 이중 포워드 제거** — 라이브러리 `EgovAccessDeniedHandler`
   는 모든 예외에 대해 `accessDeniedUrl` 로 포워드한 뒤 CSRF 예외면
   `csrfAccessDeniedUrl` 로 한 번 더 포워드한다 (이중 포워드 결함).
   생성 코드는 if/else 로 한 번만 포워드하고 403 상태를 설정한다.
3. **StrictHttpFirewall 명시화** — 참조는 Spring Security 기본값에 암묵
   의존하지만, 생성 코드는 빈으로 명시해 기본 차단 정책
   (인코딩된 슬래시·백슬래시·`%25`·세미콜론 거부 등)과 400 거부 응답
   (FilterChainProxy 기본 핸들러와 동일)을 코드에 드러낸다. 동작은 기본값과
   같고, 정책 변경 지점을 명시하는 것이 목적이다.
4. **폼 토큰 주입 방식** — 생성되는 Thymeleaf 화면은 `th:action` 없이
   jQuery 로 action 을 지정해 submit 하므로 Thymeleaf 의 자동 hidden 필드
   주입이 동작하지 않는다. 공통컴포넌트 JSP 와 같은 방식으로 명시적 hidden
   필드(`_csrf`)와 meta 태그(fetch 헤더용)를 넣는다. `${_csrf}` 가 null 이면
   렌더링되지 않으므로 Spring Security 를 제거한 프로젝트에서도 화면이 깨지지
   않는다. 같은 폼이 GET(검색·페이지네이션·목록 복귀)과 POST 를 겸용하므로,
   GET 제출 경로에서는 스크립트가 hidden 필드를 `disabled` 처리해 토큰이
   URL 쿼리스트링(브라우저 이력·접근 로그)으로 유출되지 않게 한다
   (공통컴포넌트도 POST 폼에만 토큰을 둔다).
5. **기본 계정 자동 생성 차단** — 인증 미도입 상태에서
   `spring-boot-starter-security` 가 만드는 generated password 로그를 막기
   위해 `UserDetailsServiceAutoConfiguration` 을 exclude 한다. 인증 도입 시
   제거하도록 주석으로 안내한다.

## 프로퍼티 카탈로그 (application.properties)

각 항목은 해당 기능 커밋과 함께 생성 프로퍼티에 추가된다 (상태 열 기준).

```properties
# [구현됨] 보안 헤더 (기본값 = 공통컴포넌트 egov-security-config.properties 와 동일)
egov.security.headers.sniff=true
egov.security.headers.xframe-options=SAMEORIGIN
egov.security.headers.xss-protection=true
egov.security.headers.cache-control=true

# [구현됨] 인증 미도입 상태의 기본 계정 자동 생성 차단
spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration

# [구현됨] CSRF
egov.security.csrf=true
egov.security.csrf-access-denied-url=/egovCSRFAccessDenied.do

# [후속 커밋] CORS (기본 비활성 — 참조 구현과 동일한 차단 자세)
egov.security.cors.enabled=false
egov.security.cors.allowed-origins=
egov.security.cors.allowed-methods=GET,POST
egov.security.cors.allowed-headers=*
egov.security.cors.allow-credentials=false
egov.security.cors.max-age=1800
```

## 테스트 전략

- `tests/scaffold/securityConfig.test.ts` — 스캐폴드 1회 후 렌더링된
  pom / 설정 클래스 / 프로퍼티 / 화면 템플릿의 내용 검증 (기능별 describe).
- 골든 테스트(`tests/scaffold/__golden__/boot50.json`)가 산출물 전체 해시를
  고정한다. boot43 / war43 골든이 바뀌지 않는 것이 "boot50 전용" 의 회귀 방어.
- 매니페스트 항목 수 검증(`manifestLoader.test.ts`)은 항목 추가 시 함께 갱신.
