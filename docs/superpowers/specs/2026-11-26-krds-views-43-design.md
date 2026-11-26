# 4.3 Boot / 4.3 WAR 산출물 화면의 KRDS 전환 — 설계

작성일: 2026-11-26
상태: 검토 중 (승인 전)

## 1. 의도와 배경

`egov_scaffold_project`, `egov_add_entity`, `egov_add_query_view` 가 만드는 화면은 스택에 따라 모습이 크게 다르다. 5.1 Boot 산출물은 KRDS(대한민국 정부 디자인 시스템) 마크업과 정적 자산(`templates/static50/`)을 쓰고 날짜 입력에 달력 선택기(flatpickr)가 뜨지만, 4.3 Boot 와 4.3 WAR 산출물은 옛 eGovFrame 샘플 화면(`sample.css`, gif 버튼, 테이블 레이아웃)을 그대로 쓴다.

이 설계는 **4.3 두 스택의 화면을 5.1 Boot 와 같은 KRDS 형식으로 바꾼다.** 컨트롤러·URL 흐름·검증 방식은 스택별로 그대로 두고, 사용자가 보는 화면(뷰 템플릿, 정적 자산, 페이지네이션 마크업)만 바꾼다. 사용자가 두 가지 범위(화면만 / 4.3 Boot 흐름까지 5.1 과 통일) 중 "화면만" 을 선택했다.

## 2. 목표 / 비목표 / 금지 사항

### 목표

- 4.3 Boot 와 4.3 WAR 의 엔티티 목록·등록(수정) 화면, 조회뷰 목록 화면, 메뉴 네비게이션 fragment 가 5.1 Boot 템플릿과 같은 KRDS 마크업·클래스를 쓴다.
- 날짜(DATE/TIMESTAMP) 컬럼의 입력 필드에서 5.1 과 같은 방식(flatpickr, 한국어 로케일, `yyyy-MM-dd`)으로 달력 선택기가 뜬다.
- 페이지네이션이 5.1 과 같은 KRDS 마크업(`krds-pagination`, `page-navi`, `page-links`, `page-link`, `link-dot`)으로 렌더링된다.
- 세 스택 모두 `templates/static50/` 정적 자산을 산출물에 복사한다. 옛 `templates/static/` 은 제거한다.
- 기존 vitest 와 골든 매니페스트를 갱신하고, 두 4.3 스택을 실제로 빌드·기동해 화면과 CRUD 를 확인한다.

### 비목표

- 4.3 Boot 의 컨트롤러 URL(`/{entity}/add|detail|update|delete`), AJAX 로 목록 조각을 교체하는 방식, 서버측 바인딩 오류 표시(`th:errors`)는 바꾸지 않는다.
- 4.3 WAR 의 commons-validator 기반 클라이언트 검증(`validator.xml`, `validator:javascript`)은 유지한다. 5.1 의 `EgovValidation.js` 로 바꾸지 않는다.
- 5.1 Boot 템플릿은 바꾸지 않는다.
- flatpickr 를 로컬 번들로 바꾸는 작업(폐쇄망 대응)은 이 설계에 넣지 않는다. 5.1 도 함께 바꿔야 하는 별도 작업으로 뒤에 다룬다.
- KRDS 의 헤더·푸터·사이드 메뉴 레이아웃은 넣지 않는다. 5.1 산출물도 `#container.inner` 와 제목만 쓴다.

### 금지 사항 (되면 실패인 것)

- rte 5.x 에만 있는 클래스(`AbstractKrdsPaginationRenderer`, `jakarta.*`)를 4.3 산출물에 들여오는 것. 4.3 산출물은 JDK 8 + rte 4.3.2 + javax 로 컴파일되어야 한다.
- 4.3 Boot 산출물에서 `common.js` 의 `const contextPath` 와 템플릿 인라인 `var contextPath` 가 충돌해 스크립트가 통째로 죽는 것. 검색·페이지 이동(AJAX 교체) 시 head 의 외부 스크립트가 다시 평가되어 콘솔에 오류가 찍히는 것도 실패로 본다.

### 전제

- **KRDS 전환 이전에 만들어진 4.3 프로젝트는 없다고 가정한다.** 이 MCP 서버는 아직 출시 전이라, 옛 4.3 템플릿으로 만든 프로젝트에 `egov_add_entity` / `egov_add_query_view` 를 돌리는 경우는 고려하지 않는다 (사용자 결정). 따라서 옛 템플릿 분기나 감지·경고 로직을 두지 않는다.

## 3. 현재 구조 (조사 결과)

- 스택 매트릭스 [templates/stacks.json](../../../templates/stacks.json) 의 `staticAssets` 키가 복사할 정적 자산 디렉터리를 정한다 (boot50 = `static50`, boot43/war43 = `static`). 복사 로직은 `scaffoldGenerator.ts` 의 "Static assets copy" 블록이며 Boot 는 `src/main/resources/static/`, WAR 는 `src/main/webapp/` 아래로 복사한다.
- 5.1 의 달력은 KRDS 자체 컴포넌트가 아니다. `boot50/thymeleaf/entityRegister.html.hbs` 가 `hasDateAttr` 일 때 jsdelivr CDN 에서 flatpickr 4.6.13(css, js, l10n/ko) 을 불러와 `.flatpickr-date` 입력에 적용한다. 날짜 값은 `#dates.format(..., 'yyyy-MM-dd')` 로 날짜까지만 표시하고, 서버는 `yyyy-MM-dd` 만 받아 Timestamp 는 ` 00:00:00` 을 보강한다.
- 5.1 페이지네이션은 `boot50/java/pagination/EgovKrdsPaginationRenderer.hbs` 가 rte 5.x 의 `AbstractKrdsPaginationRenderer` 를 상속한다. rte 4.3.2 jar 에는 이 클래스가 없고 `AbstractPaginationRenderer`(라벨 6종) 와 `PaginationRenderer` 인터페이스만 있다. 5.1 소스(`egovframe-rte-ptl-mvc-5.1.0-sources.jar`)의 `renderPagination` 로직은 100 줄 미만의 자족적 코드다.
- 4.3 Boot 는 Spring Boot 2.7.18 + Thymeleaf 3.0(spring5) 이다. 5.1 템플릿이 쓰는 문법(`#dates.format`, `th:inline="javascript"` 의 `/*[[...]]*/`, `th:classappend`, `th:each`)은 3.0 에서도 동작한다. `#httpServletRequest` 는 3.0 에서 쓸 수 있다.
- 4.3 Boot 목록 화면은 검색·페이지 이동 시 `POST /{entity}/list` 로 받은 HTML 로 `$('#content_pop').replaceWith(...)` 한다. 검색 입력은 form 밖에 있고 AJAX 가 값을 읽는다.
- 4.3 WAR 의 디스패처는 `*.do` 만 받으므로 `webapp/` 아래 css/js/img/fonts 는 Tomcat 기본 서블릿이 서빙한다. 페이지네이션은 `<ui:pagination type="image">` → `dispatcher-servlet.xml` 의 `DefaultPaginationManager.rendererType` 맵 → `EgovImgPaginationRenderer` 빈. `PaginationTag`(4.3.2) 는 렌더러 문자열을 그대로 출력한다.
- 4.3 WAR 의 `EgovBindingInitializer` 는 Date/Timestamp 편집기의 `setAsText` 만 재정의한다. `getAsText` 는 기본값이라 `form:input` 이 Timestamp 를 `yyyy-MM-dd HH:mm:ss.f` 로 표시한다.
- `static50` 의 `output.css` 는 `../../img/component/icon/`(87개 SVG), `../../fonts/`(PretendardGOV) 를 상대 경로로 참조한다. 디렉터리 구조만 보존하면 두 스택 모두 동작한다.
- `common.js`(static50) 는 `const contextPath = $('#contextPathHolder')...` 와 `notNullCheck`, Enter 키 → onclick 위임을 정의한다.
- 메시지 번들: `page.prev`/`page.next` 키는 boot50 번들에만 있다. war 번들은 `messageUnicodeEscape: true` 라 한글을 `\uXXXX` 로 쓴다. war 의 `message-common.properties.hbs` 는 default 와 `_ko` 두 파일로 출력되는데 버튼·검색·안내·검증 문구가 **영어**이고(`button.search=Search`, `info.nodata.msg=No data found.`) 엔티티 라벨만 한글이다. Boot 두 스택은 한글이다.
- 4.3 Boot 목록 화면의 `$('#content_pop').replaceWith(응답 HTML 전체)` 는 jQuery 가 응답의 `<script src>` 를 다시 받아 평가하고 `<link>` 도 body 에 다시 넣는다. 지금은 `var` 선언이라 조용히 지나가지만, `common.js`/`ui-script.js` 의 최상위 `const` 는 두 번째 평가에서 SyntaxError 를 낸다.
- 5.1 템플릿의 스크립트 구성은 페이지별로 다르다: 목록 = jQuery + `common.js`, 조회뷰 = jQuery 만, 등록 = jQuery + `ui-script.js` + `common.js` + `EgovValidation.js`.
- 테스트: `golden.test.ts` 는 `src/main/resources/static`, `src/main/webapp/static-files` 접두사만 매니페스트에서 제외한다. WAR 에 static50 을 복사하면 `src/main/webapp/css|js|img|fonts|error` 아래 600여 파일이 매니페스트에 들어가므로 제외 접두사를 늘려야 한다. `boot43Attachment.test.ts` 는 4.3 Boot 등록 화면에 `krds-` 가 **없음**을 단언한다. 그 외 4.3 마크업을 단언하는 테스트는 거의 없다.

## 4. 접근 방식 비교

| 접근 | 내용 | 장점 | 단점 | 결정 |
|---|---|---|---|---|
| A. 화면만 전환 (스택별 템플릿 유지) | 스택별 뷰 템플릿·정적 자산·페이지네이션 렌더러만 KRDS 로 바꾸고 컨트롤러·URL·검증 방식은 유지 | 기존 E2E 절차·테스트·메모리에 기록된 URL 규칙이 그대로 유효. 위험이 가장 작음 | 4.3 Boot 와 5.1 Boot 템플릿이 마크업은 같아도 스크립트 흐름이 달라 두 벌로 남음 | **선택 (사용자 결정)** |
| B. 5.1 과 완전 통일 | 4.3 Boot 의 URL 을 `.do` 전체 페이지 방식으로 바꾸고 EgovValidation.js·CSRF 흐름까지 맞춤 | 템플릿 두 벌의 차이가 거의 사라짐 | 컨트롤러·테스트·E2E 스크립트 전면 수정. 기존 4.3 프로젝트와 호환 깨짐 | 기각 (사용자가 범위에서 제외) |
| C. 스택 공용 템플릿 (`{{#if jakarta}}` 분기) | Boot 4.3/5.1 이 한 템플릿을 공유 | 중복 제거 | JSP 는 공유 불가. Boot 4.3/5.1 은 URL 흐름·Thymeleaf 버전이 달라 분기가 많아지고 골든 diff 가독성이 나빠짐 | 기각 |

## 5. 설계

### 5.1 스택 매트릭스와 정적 자산

- `stacks.json`: `boot43`, `war43` 의 `staticAssets` 를 `"static50"` 으로 바꾼다. `$comment` 와 `scaffoldGenerator.ts` 의 주석("Boot 5.1 = static50, 그 외 = static")을 "모든 스택 static50" 으로 고친다.
- `templates/static/` 디렉터리를 삭제한다. `stackMatrix.ts` 의 타입 `"static" | "static50"` 은 그대로 둔다(스키마 호환). `tests/scaffold/stackMatrix.test.ts` 의 `staticAssets: "static"` 픽스처는 타입 검사용이므로 그대로 둔다.
- 복사 로직은 바꾸지 않는다. WAR 에서는 `static50/error/403.html` 이 `webapp/error/403.html` 로 들어가는데 아무 것도 참조하지 않는 파일이라 둔다.

### 5.2 4.3 Boot — Java

- **새 템플릿 `boot/java/pagination/EgovKrdsPaginationRenderer.hbs`**: rte 4.3.2 의 `PaginationRenderer` 인터페이스를 직접 구현하는 `@Component`. rte 5.1 `AbstractKrdsPaginationRenderer.renderPagination` 의 로직(이전 링크 항상 표시·1페이지면 비활성, 8페이지 이하 전부, 초과 시 앞 4/뒤 4/중간 창 + `...`, `<div class="page-links">` 래퍼, 다음 링크 항상 표시)을 그대로 옮긴다. 라벨 문자열은 boot50 `EgovKrdsPaginationRenderer.hbs` 와 같다. 이전/다음 라벨은 `MessageSource` 의 `page.prev`/`page.next` 를 `LocaleContextHolder` 로케일로 렌더 시점마다 조회한다 (`@PostConstruct` 불필요). `javax`/`jakarta` import 가 전혀 없도록 한다.
- `boot/java/pagination/EgovPaginationDialect.hbs`: boot50 버전과 같은 형태로 바꾼다. 생성자로 렌더러를 받고 표현식 객체 이름을 `egovKrdsPaginationRenderer` 로 노출한다.
- `boot/java/config/EgovConfigWeb.hbs`: boot50 처럼 렌더러를 주입받아 다이얼렉트에 넘긴다. 리소스 핸들러에 `/img/**`, `/fonts/**` 를 추가한다 (`/images/**` 는 제거). `spring5` 패키지는 유지한다.
- `boot/java/pagination/EgovPaginationFormat.hbs` 와 `manifests/boot43.json` 의 해당 항목을 삭제하고 새 렌더러 항목을 추가한다.
- 메시지: `boot/message/message-common.properties.hbs`(ko, `\u` 이스케이프 형식 유지)와 `_en` 에 `page.prev`, `page.next` 를 추가한다.

### 5.3 4.3 Boot — Thymeleaf 템플릿

head 의 자산은 **5.1 의 같은 페이지와 똑같이** 구성한다 (페이지별 최소 구성):

| 페이지 | CSS | JS |
|---|---|---|
| 목록 (entityList) | `/css/component/output.css`, `/css/egovframe.css` | `/js/jquery.min.js`, `/js/egovframework/common.js`(defer) |
| 조회뷰 (queryViewList) | 같음 | `/js/jquery.min.js` |
| 등록 (entityRegister) | 같음 + (`hasDateAttr`) flatpickr css | `/js/jquery.min.js`, `/js/component/ui-script.js`(defer), `/js/egovframework/common.js`(defer) + (`hasDateAttr`) flatpickr js·ko |

- 5.1 등록 화면의 `EgovValidation.js` 는 넣지 않는다 (4.3 Boot 는 서버측 바인딩 오류 표시를 유지한다는 비목표).
- `<link id="contextPathHolder" th:data-contextPath="${#httpServletRequest.getContextPath()}"/>` 는 유지한다 (4.3 Boot 는 context-path 가 있을 수 있고 `common.js` 가 이 홀더를 읽는다). 인라인 스크립트의 `var contextPath = ...` 와 `notNullCheck` 정의는 **제거**한다 (`common.js` 가 제공). `common.js` 를 넣지 않는 조회뷰는 둘 다 쓰지 않는다.
- Enter 키 `preventDefault` 리스너는 유지한다. 4.3 Boot 등록 화면의 form 은 `action` 이 없어 Enter 로 제출되면 POST 전용 URL 에 GET 이 가서 405 가 난다.
- jQuery 는 static50 의 3.7.1 (`/js/jquery.min.js`) 로 바꾼다.

**entityList.html.hbs**
- 5.1 과 같은 골격: `<div id="container" class="inner">` > `h2.heading-large` 제목 > nav fragment include(`@egov:nav-include` 마커 주석 유지) > `<div id="content_pop">`. `#content_pop` 안에 PK hidden 을 담은 `form#detailForm`, 5.1 과 같은 `.form-group > .search-wrap > .search-body` 검색 영역(select `krds-form-select medium`, input `krds-input medium`, 아이콘 버튼 `krds-btn medium icon` + `ico-sch`) 과 등록 버튼(`.page-btn-wrap`), `.krds-table-wrap > table.tbl.col.data` (`thead`/`tbody`, `text-center`), 데이터 없음 행(`info.nodata.msg`, 5.1 에는 있고 4.3 에는 없던 것), `<div id="paging" class="krds-pagination w-page" th:utext="${#egovKrdsPaginationRenderer.renderPagination(paginationInfo, '{{entityNameLower}}Pagination')}">` 을 둔다.
- 검색 입력은 지금처럼 form 밖에 두고 `{{entityNameLower}}Search()` 가 id 로 값을 읽어 AJAX 로 보낸다. URL 과 `$.ajax` 호출은 바꾸지 않는다.
- **AJAX 교체는 응답에서 `#content_pop` 만 뽑아 교체한다**: `.done(function(html) { $('#content_pop').replaceWith($('<div>').html(html).find('#content_pop')); })` 형태. 응답 HTML 전체를 넘기면 jQuery 가 head 의 `<script src>` 를 다시 평가해 `common.js` 의 `const` 가 SyntaxError 를 내고 `<link>` 가 중복 삽입된다. `#content_pop` 만 교체하면 제목·nav 는 그대로 남고 검색 영역·표·페이지네이션만 갱신된다 (검색 조건·키워드는 서버가 VO 로 되돌려 주므로 교체 후에도 유지된다).
- `th:utext` 안전성 주석은 boot50 의 것을 옮겨 온다.

**entityRegister.html.hbs**
- 5.1 구조(`#container.inner` > `h2.heading-large` > `form#detailForm` > `.conts-wrap > .fieldset.input-form > .form-group{.form-tit label, .form-conts}` > `.page-btn-wrap`)를 쓴다. 등록 화면은 AJAX 교체가 없으므로 5.1 과 같은 래퍼를 써도 된다.
- 4.3 의 의미는 유지: 문자열·FK·YN·긴 텍스트 필드는 `th:field` 를 그대로 쓰고 클래스만 `krds-input` / `krds-form-select` 를 붙인다. 바인딩 오류는 `<p class="form-hint-invalid" th:if="${#fields.hasErrors('x')}" th:errors="*{x}">` 로 `.form-conts` 안에 표시한다. PK 행은 지금처럼 값이 있을 때만(수정 진입) readonly 로 보인다.
- 필수 표시: `isNotNull` 인 문자열 필드 라벨에 5.1 처럼 `<span class="required">*</span>` 를 붙인다. 라벨 텍스트는 내부 `<span th:text>` 에 둔다 (`th:text` 가 자식을 통째로 바꾸므로).
- **날짜 필드**: `th:field` 대신 명시적 `id`/`name` 과 `th:value="${vo.x != null ? #dates.format(vo.x, 'yyyy-MM-dd') : ''}"`, `class="krds-input flatpickr-date"`, `placeholder="yyyy-MM-dd"` 를 쓴다. `th:field` 는 Timestamp 를 `@DateTimeFormat("yyyy-MM-dd HH:mm:ss")` 로 찍어 flatpickr 형식과 어긋난다. 컨트롤러 `@InitBinder` 가 이미 `yyyy-MM-dd` 를 받아 Timestamp 에 ` 00:00:00` 을 보강하므로 서버 변경은 없다. `th:errors` 는 그대로 표시한다.
- `hasDateAttr` 일 때 5.1 과 똑같은 flatpickr CDN 링크 3개와 초기화 스크립트를 넣는다.
- 버튼은 `krds-btn medium (secondary|tertiary|danger)` 로 바꾸고 onclick 은 4.3 함수(`{{e}}List/Add/Update/Delete/Reset`) 그대로. URL 은 `/{{entityNameLower}}/add` 등 4.3 체계 유지.
- 첨부 블록(`withAttachment`)은 5.1 마크업을 쓰되 JS 는 4.3 의 `$.ajax` → `/{{entityNameLower}}/deleteAttachFile` → `li` 제거 방식을 유지한다.

**queryViewList.html.hbs**
- boot50 의 `queryViewList.html.hbs` 와 같은 내용으로 맞춘다. 이미 전체 페이지 GET 폼 방식이라 흐름 차이가 없고, 표현식 객체 이름(`egovKrdsPaginationRenderer`)도 같아지므로 사실상 동일 파일이 된다.

**_fragments/nav.html.hbs**
- boot50 버전(`<nav>`, KRDS CSS 변수 색상)을 가져오고 머리말 주석만 "4.3 Boot / Thymeleaf 3.0" 으로 고친다. 활성 메뉴 판별식(`egovRequestUri`) 은 이미 같다.

**egovSampleError.html.hbs**
- boot50 의 최소 버전(sample.css 참조 없음)으로 바꾼다.

### 5.4 4.3 WAR — Java / 설정

- **새 템플릿 `war/java/cmmn/web/EgovKrdsPaginationRenderer.hbs`**: 5.2 의 Boot 렌더러와 같은 로직. Spring 빈은 XML 로 정의되므로 `MessageSourceAware` 를 구현해 `MessageSource` 를 받는다 (디스패처 컨텍스트가 부모 컨텍스트의 messageSource 로 위임). `javax` 의존이 필요하면 `javax.servlet` 만 쓴다.
- `war/webapp/dispatcher-servlet.xml.hbs`: `imageRenderer` 빈을 `krdsRenderer`(`EgovKrdsPaginationRenderer`) 로 바꾸고 `rendererType` 맵 키를 `krds` 로 한다.
- `war/java/cmmn/web/EgovImgPaginationRenderer.hbs` 와 `manifests/war43.json` 의 항목을 삭제하고 새 렌더러 항목을 추가한다.
- `war/java/cmmn/web/EgovBindingInitializer.hbs`: Date/Timestamp 두 편집기에 `getAsText()` 를 추가해 값이 있으면 `yyyy-MM-dd`, 없으면 빈 문자열을 돌려준다. 그래야 `form:input` 이 5.1 과 같은 형식으로 표시하고 flatpickr 가 그대로 읽는다. `setAsText` 규칙은 바꾸지 않는다.
- **메시지 번들 한글 통일 (사용자 결정)**: `war/message/message-common.properties.hbs`(default·`_ko` 공용) 의 영어 문구를 모두 boot50 번들과 같은 한글 값(`\u` 이스케이프)으로 바꾼다. 대상: `button.*`(`button.save` 는 `저장` "저장"), `search.choose`/`search.keyword`, `input.yes`/`input.no`, `info.nodata.msg`, `fail.common.msg`, `fail.common.sql`("데이터베이스 오류가 발생했습니다."), `confirm.required.*`("…은(는) 필수 입력값입니다."), commons-validator 패턴 `errors.*`("{0}은(는) 필수 입력 항목입니다." 등 14개). 여기에 `page.prev=이전`, `page.next=다음` 를 추가한다. `list.x` 의 라벨 없는 폴백 `{{entityName}} List` 와 `title.*`/`nav.*` 는 그대로 둔다. `_en` 번들은 영어를 유지하고 `page.prev=Prev`, `page.next=Next` 만 추가한다.

### 5.5 4.3 WAR — JSP 템플릿

공통 head:
- `<!DOCTYPE html>` (XHTML 1.0 Transitional 에서 변경. KRDS CSS 는 표준 모드를 전제한다). `validator:javascript xhtml="true"` 출력은 HTML5 에서도 유효하다.
- `<c:url>` 로 `/css/component/output.css`, `/css/egovframe.css`, `/js/jquery.min.js`, `/js/component/ui-script.js`(defer), `/js/egovframework/common.js`(defer). `common.js` 의 `contextPath` 는 홀더가 없어 빈 문자열이 되지만 WAR 스크립트는 `<c:url>` 을 쓰므로 영향이 없다.
- `hasDateAttr` 일 때 flatpickr CDN 3개 + 초기화 스크립트 (5.1 과 동일). commons-validator 스크립트(`/cmmn/validator.do`, `validator:javascript formName=...`)는 유지.

**egovEntityList.jsp.hbs / egovQueryViewList.jsp.hbs**
- `<div id="container" class="inner">` > `h2.heading-large` > nav include(마커 주석 유지) > `form:form`(기존 modelAttribute/method 유지) 안에 5.1 과 같은 검색 영역(`form:select cssClass="krds-form-select medium"`, `form:input cssClass="krds-input medium"`, 아이콘 버튼 `<button type="button" class="krds-btn medium icon" onclick="fn_egov_selectList()">`) → `.krds-table-wrap > table.tbl.col.data` (`thead`/`tbody`, `align` 속성 대신 `text-center`/`text-right` 클래스, `<c:out>` 유지) → 데이터 없음 행(엔티티 목록에 추가; 조회뷰에는 이미 있음) → `<div id="paging" class="krds-pagination w-page"><ui:pagination paginationInfo="${paginationInfo}" type="krds" jsFunction="fn_egov_link_page"/></div>` + `form:hidden pageIndex`.
- JS 함수(`fn_egov_select`, `fn_egov_addView`, `fn_egov_selectList`, `fn_egov_link_page`) 와 URL 은 그대로. `<a href="javascript:...">` + gif 버튼은 `krds-btn` 버튼으로 바꾼다.

**egovEntityRegister.jsp.hbs**
- 5.1 등록 화면과 같은 `.conts-wrap > .fieldset.input-form > .form-group` 구조. `form:input cssClass="krds-input"`, `form:select cssClass="krds-form-select"`, `form:textarea cssClass="krds-input"`, 오류는 `<form:errors path="x" element="p" cssClass="form-hint-invalid"/>`.
- 날짜 필드: `form:input path="x" cssClass="krds-input flatpickr-date" placeholder="yyyy-MM-dd"` (값 형식은 5.4 의 `getAsText` 가 보장).
- 필수 표시 `*` 는 `isNotNull` 문자열 필드 라벨에 추가.
- 버튼(`fn_egov_selectList`, `fn_egov_save`, `fn_egov_delete`, reset) 은 `krds-btn` 으로.
- `registerFlag` 분기, 검색조건 hidden 3개, `form:form modelAttribute` 는 유지.

**_fragments/nav.jsp.hbs**
- boot50 nav 와 같은 `<nav>` 마크업·KRDS CSS 변수 스타일. 활성 판별식(`javax.servlet.forward.request_uri` + `contextPath += '/egov{E}List'`) 은 유지 (`warRuntimeArtifacts.test.ts` 가 단언).

**바꾸지 않는 JSP**: `cmmn/*.jsp`, `common/error.jsp`, `index.jsp`, `validator.jsp` 는 옛 자산을 참조하지 않는 최소 페이지라 그대로 둔다.

### 5.6 도구 동작

- `egov_scaffold_project`, `egov_add_entity`, `egov_add_query_view` 의 TypeScript 로직은 바꾸지 않는다. 바뀌는 것은 템플릿·매니페스트·`stacks.json`·주석뿐이다. (옛 4.3 프로젝트 감지·경고는 전제에 따라 두지 않는다.)

### 5.7 테스트

- `golden.test.ts`: `STATIC_PREFIXES` 에 `src/main/webapp/css`, `src/main/webapp/js`, `src/main/webapp/img`, `src/main/webapp/fonts`, `src/main/webapp/error` 를 추가한다. 그 뒤 `npm run test:update` 로 boot43·war 매니페스트를 갱신한다 (boot50 매니페스트는 바뀌면 안 된다).
- `boot43Attachment.test.ts` 의 `not.toContain("krds-")` 를 KRDS 클래스가 **있음**을 단언하도록 바꾼다.
- 새 테스트 (하나의 파일 `krdsViews43.test.ts` 권장):
  - boot43·war 스캐폴드 산출물에 `css/component/output.css`, `js/component/ui-script.js`, `fonts/PretendardGOV-Regular.subset.woff2` 가 있고 `css/egovframework/sample.css`, `jquery-3.6.1.min.js` 가 없다.
  - DATE/TIMESTAMP 컬럼이 있는 DDL 로 만든 등록 화면(boot43 Thymeleaf, war JSP)에 `flatpickr-date` 와 flatpickr CDN 스크립트가 있고, 날짜 컬럼이 없는 DDL 에서는 없다.
  - boot43 목록·조회뷰에 `#egovKrdsPaginationRenderer.renderPagination` 이 있고 `egovPaginationFormat` 이 없다. war 목록·조회뷰에 `type="krds"` 가 있고 dispatcher 에 `EgovKrdsPaginationRenderer` 빈과 `krds` 키가 있으며 `EgovImgPaginationRenderer.java` 는 생성되지 않는다.
  - boot43 Thymeleaf 산출물 어디에도 `var contextPath` 선언이 없다 (`common.js` 충돌 방지).
  - 세 스택 message-common(ko/en) 에 `page.prev`, `page.next` 가 있다 (war 는 `\u` 이스케이프).
  - war `message-common.properties`/`_ko` 에 영어 공통 문구가 남아 있지 않다 (`button.search=검색`, `info.nodata.msg` 가 `\u` 로 시작, `errors.required` 가 `\u` 로 시작). `_en` 은 영어 그대로다.
  - war `EgovBindingInitializer.java` 에 `getAsText` 가 있고 `yyyy-MM-dd` 를 돌려준다. 기존 `warDateBinding.test.ts` 는 그대로 통과해야 한다.
  - boot43 목록 템플릿의 AJAX 핸들러가 `#content_pop` 을 추출해 교체한다 (`find('#content_pop')` 포함, `replaceWith(fragment)` 직접 호출 없음).
  - 4.3 산출물 Java 소스에 `jakarta.` 와 `AbstractKrdsPaginationRenderer` 가 없다 (`addQueryViewStacks.test.ts` 의 `not.toContain("jakarta.")` 패턴 참고).
- **실제 기동 검증 (필수)**: 메모리에 기록된 3 스택 E2E 절차대로, DATE 와 TIMESTAMP 컬럼을 포함한 DDL 로 4.3 Boot(JDK 8, `mvn -o spring-boot:run` 또는 jar)와 4.3 WAR(JDK 8, `references/apache-tomcat-8.5.90`, 임시 `CATALINA_BASE`)을 기동한다. 확인 항목: 목록·등록·조회뷰 페이지 200, `/css/component/output.css`·`/js/component/ui-script.js`·`/img/component/icon/` SVG 하나·폰트 하나가 200, 페이지네이션 마크업에 `page-links` 가 있음, 날짜 필드 값이 `yyyy-MM-dd` 로 표시됨, 등록·수정(날짜 포함)·삭제가 성공하고 Location 이 자기 목록임, WAR 화면의 버튼·안내 문구가 한글로 나옴. 내장 브라우저로 두 4.3 화면과 5.1 화면을 나란히 스크린샷해 외형을 비교하고, 4.3 Boot 목록에서 검색과 페이지 이동을 실제로 눌러 **콘솔 오류가 0건**이고 달력 팝업이 뜨는지 확인한다.

### 5.8 문서

- `README.md` 의 스택 설명과 디렉터리 트리에서 `static50` 이 세 스택 공용임을 밝힌다. `CLAUDE.md` 의 WAR 화면 확인 절차는 그대로 유효하다.

## 6. 빌더에게 맡기는 것

- 각 KRDS 클래스 조합(`krds-btn` 변형, `tbl col data` 등)은 boot50 템플릿을 그대로 따른다. 새 클래스를 고안하지 않는다.
- 렌더러 Java 코드의 세부 작성(라벨 조립, 로케일 조회 위치).
- WAR 번들 한글 문구의 세부 표현 (boot50 번들에 같은 키가 있으면 그 값을 그대로 쓴다. 없는 키 — `button.save`, `fail.common.sql`, `errors.*` — 는 같은 어조로 짓는다).
- 골든 매니페스트 갱신 전 diff 를 훑어 boot50 이 바뀌지 않았는지, 바뀐 파일이 설계 범위 안인지 확인하는 순서.

## 7. 알려진 한계 / 후속 작업

- flatpickr 는 CDN 의존이다. 폐쇄망에서는 달력이 뜨지 않고 텍스트 입력만 된다 (5.1 과 같은 한계). 세 스택 공통으로 `static50` 에 로컬 번들을 넣는 작업은 별도 설계로 다룬다.
- 옛 4.3 템플릿으로 만든 프로젝트에 새 화면을 추가하면 KRDS 페이지네이션 렌더러가 없어 500 이 난다. 출시 전이라 그런 프로젝트가 없다는 전제로 대응하지 않는다.
