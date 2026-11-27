# 화면 템플릿 구조

이 문서는 생성되는 화면이 세 스택에서 어떻게 구성되는지, 스택마다 무엇이 같고 무엇이 다른지를 설명합니다. 화면 템플릿을 수정하려는 개발자를 위한 문서입니다.

## 방침

세 스택의 화면은 사용자가 보는 모습을 같게 하고, 서버와 주고받는 방식은 스택의 관례를 따르게 했습니다.

- **같게 한 것**: KRDS(대한민국 정부 디자인 시스템)의 마크업과 CSS 클래스, 정적 자산, 페이지네이션의 마크업, 날짜 입력의 달력과 표시 형식
- **스택별로 둔 것**: Controller 의 URL 체계, 화면을 갱신하는 방식, 유효성 검증의 방식, 폼 태그

4.3 Boot 와 5.1 Boot 가 하나의 템플릿을 공유하지 않는 이유는, URL 체계와 화면 갱신 방식이 달라서 분기가 많아지기 때문입니다. JSP 는 Thymeleaf 와 템플릿을 공유할 수 없습니다. 그래서 스택별로 템플릿을 따로 두되, 마크업은 5.1 Boot 의 템플릿을 기준으로 맞췄습니다.

## 화면 템플릿

| 화면 | 5.1 Boot (`templates/boot50/thymeleaf/`) | 4.3 Boot (`templates/boot/thymeleaf/`) | 4.3 WAR (`templates/war/webapp/jsp/`) |
|------|------------------------------------------|----------------------------------------|----------------------------------------|
| 엔티티 목록 | `entityList.html.hbs` | `entityList.html.hbs` | `entity/egovEntityList.jsp.hbs` |
| 엔티티 등록(수정) | `entityRegister.html.hbs` | `entityRegister.html.hbs` | `entity/egovEntityRegister.jsp.hbs` |
| 조회 화면 | `queryViewList.html.hbs` | `queryViewList.html.hbs` | `queryView/egovQueryViewList.jsp.hbs` |
| 메뉴 | `_fragments/nav.html.hbs` | `_fragments/nav.html.hbs` | `_fragments/nav.jsp.hbs` |

화면의 골격은 세 스택이 같습니다. `<div id="container" class="inner">` 안에 제목(`h2.heading-large`), 메뉴, 본문이 차례로 들어갑니다. 목록의 표는 `krds-table-wrap` 과 `table.tbl.col.data`, 입력란은 `krds-input` 과 `krds-form-select`, 버튼은 `krds-btn` 을 사용합니다. KRDS 의 머리글, 바닥글, 옆 메뉴 레이아웃은 넣지 않았습니다.

새 CSS 클래스가 필요하면 5.1 Boot 의 템플릿에 있는 조합을 따릅니다.

## 정적 자산

정적 자산의 원본은 `templates/static50/` 이며 세 스택이 함께 사용합니다. 스택 정의(`templates/stacks.json`)의 `staticAssets` 가 이 디렉터리를 가리킵니다. 프로젝트를 생성할 때 렌더링 없이 그대로 복사하며, 파일은 588개입니다.

| 디렉터리 | 내용 |
|----------|------|
| `css/component/output.css`, `css/token/`, `css/common/` | KRDS 의 스타일 |
| `css/egovframe.css` | 생성되는 화면에 맞춘 보조 스타일 |
| `js/jquery.min.js` | jQuery |
| `js/component/ui-script.js` | KRDS 컴포넌트의 스크립트 |
| `js/egovframework/common.js` | 컨텍스트 경로, 필수 입력 확인, Enter 키 처리 등의 공용 스크립트 |
| `js/egovframework/EgovValidation.js` | 5.1 Boot 의 등록 화면이 쓰는 입력 검증 스크립트 |
| `img/component/icon/` | KRDS 아이콘 (SVG) |
| `fonts/` | Pretendard GOV 글꼴 |

복사하는 위치는 Boot 가 `src/main/resources/static/`, WAR 가 `src/main/webapp/` 입니다. `output.css` 가 아이콘과 글꼴을 상대 경로로 참조하므로, 디렉터리 구조를 그대로 유지해야 합니다.

`img/component/icon/` 의 SVG 파일은 macOS 의 `Icon` 파일을 제외하는 `.gitignore` 패턴에 걸려서 저장소에서 빠진 적이 있습니다. `.gitignore` 를 고칠 때에는 이 디렉터리가 제외되지 않는지 확인합니다.

## 페이지네이션

세 스택은 같은 KRDS 마크업(`krds-pagination`, `page-navi`, `page-links`, `page-link`)을 출력하지만, 렌더러의 구현은 스택마다 다릅니다.

| 스택 | 렌더러 | 화면에서의 호출 |
|------|--------|-----------------|
| 5.1 Boot | `pagination/EgovKrdsPaginationRenderer` 가 실행환경 5.x 의 `AbstractKrdsPaginationRenderer` 를 상속 | Thymeleaf 표현식 `#egovKrdsPaginationRenderer.renderPagination(...)`. `EgovPaginationDialect` 가 이 객체를 노출합니다. |
| 4.3 Boot | `pagination/EgovKrdsPaginationRenderer` 가 실행환경 4.3.2 의 `PaginationRenderer` 인터페이스를 직접 구현 | 5.1 Boot 와 같음 |
| 4.3 WAR | `cmmn/web/EgovKrdsPaginationRenderer` 가 `PaginationRenderer` 와 `MessageSourceAware` 를 구현 | `<ui:pagination type="krds">`. `dispatcher-servlet.xml` 의 `DefaultPaginationManager` 에 `krds` 유형으로 등록되어 있습니다. |

4.3 의 두 스택이 렌더러를 직접 구현한 이유는, 실행환경 4.3.2 에 KRDS 용 추상 클래스가 없기 때문입니다. 실행환경 5.1 의 렌더링 로직을 옮겨서 구현했으며, 동작은 다음과 같습니다.

- "이전"과 "다음" 링크는 항상 표시하고, 이동할 페이지가 없으면 비활성으로 표시합니다.
- 전체 페이지가 8개 이하이면 모두 표시하고, 그보다 많으면 앞쪽과 뒤쪽의 일부와 현재 페이지 주변만 표시하고 나머지는 줄임표로 나타냅니다.
- 결과가 0건이어도 1페이지를 표시합니다.

"이전"과 "다음"의 문구는 메시지 번들의 `page.prev` 와 `page.next` 에서 가져옵니다.

## 날짜 입력

날짜 계열 컬럼(`DATE`, `TIME`, `DATETIME`, `TIMESTAMP`)의 입력란에는 달력 선택기가 붙습니다.

- 달력은 flatpickr 4.6.13 이며, 날짜 컬럼이 있는 엔티티의 등록 화면에서만 CDN(`cdn.jsdelivr.net`)의 CSS, 스크립트, 한국어 로케일 파일을 불러옵니다. 입력란에는 `flatpickr-date` 클래스가 붙습니다.
- 화면에 표시하고 입력받는 형식은 세 스택 모두 `yyyy-MM-dd` 입니다. `TIMESTAMP` 컬럼도 날짜까지만 입력받고, 서버가 시각을 `00:00:00` 으로 채웁니다.
- 빈 값은 `null` 로 바인딩합니다.

형식을 맞추는 위치는 스택마다 다릅니다.

| 스택 | 입력값의 변환 | 화면에 표시할 값의 형식 |
|------|---------------|-------------------------|
| 5.1 Boot, 4.3 Boot | 엔티티 Controller 의 `@InitBinder` 가 `java.sql.Date` 와 `Timestamp` 의 편집기를 등록 | 템플릿이 `#dates.format(값, 'yyyy-MM-dd')` 로 출력 |
| 4.3 WAR | `cmmn/web/EgovBindingInitializer` 가 모든 Controller 에 편집기를 등록 | 같은 편집기의 `getAsText` 가 `yyyy-MM-dd` 로 변환해서 `form:input` 에 전달 |

flatpickr 를 CDN 에서 불러오므로, 인터넷에 연결되지 않은 환경에서는 달력이 뜨지 않고 텍스트 입력만 가능합니다. 스크립트는 flatpickr 를 불러오지 못한 경우를 확인하고 건너뛰므로 오류는 발생하지 않습니다.

## 스택별 차이

### 목록의 검색과 페이지 이동

| 스택 | 방식 |
|------|------|
| 5.1 Boot | 폼을 GET 으로 제출해서 화면 전체를 다시 받습니다. |
| 4.3 Boot | jQuery 로 `POST /<엔티티>/list` 를 호출하고, 응답 HTML 에서 `#content_pop` 영역만 뽑아서 현재 화면의 같은 영역과 교체합니다. |
| 4.3 WAR | 폼을 GET 으로 제출해서 화면 전체를 다시 받습니다. |

4.3 Boot 가 응답 전체가 아니라 `#content_pop` 만 교체하는 데에는 이유가 있습니다. 응답 HTML 전체를 jQuery 로 넣으면 `<head>` 의 외부 스크립트가 다시 실행되는데, `common.js` 가 최상위에서 `const` 로 선언한 변수가 두 번째 실행에서 구문 오류를 일으킵니다. 같은 이유로 4.3 Boot 의 템플릿에는 `var contextPath` 를 선언하는 인라인 스크립트를 두지 않습니다. `common.js` 의 `const contextPath` 와 충돌하기 때문입니다.

### 유효성 검증

| 스택 | 서버 | 화면 |
|------|------|------|
| 5.1 Boot | `@Valid` 와 VO 의 `@EgovNullCheck` | `EgovValidation.js` 가 제출 전에 필수 입력과 최대 길이를 검사 |
| 4.3 Boot | `@Valid` 와 프로젝트에 생성되는 `@EgovNotNull` | 화면 스크립트 없이, 서버의 바인딩 오류를 입력란 아래에 표시 (`th:errors`) |
| 4.3 WAR | commons-validator 의 `beanValidator` 와 `validator.xml` | `<validator:javascript>` 가 만든 스크립트가 제출 전에 검사 |

필수 입력으로 보는 대상은 세 스택 모두 기본 키가 아닌 `NOT NULL` 문자열 컬럼이며, 라벨에 필수 표시(`*`)가 붙습니다.

4.3 WAR 의 `validator.xml` 은 commons-validator 의 DTD 를 따라야 합니다. 그래서 필수 문자열 컬럼이 없는 엔티티에는 빈 `<form>` 을 만들지 않고, 프로젝트에 그런 엔티티만 있으면 빈 `<formset>` 도 만들지 않습니다.

### CSRF

5.1 Boot 의 목록 화면과 등록 화면에는 CSRF 토큰을 담는 hidden 필드와 meta 태그가 들어갑니다. 4.3 의 두 스택에는 Spring Security 가 없으므로 들어가지 않습니다. 상세한 내용은 [5.1 Boot 보안 설정](./SECURITY_CONFIG.md)에 있습니다.

### 메시지 번들의 인코딩

Boot 의 두 스택은 메시지 소스를 UTF-8 로 읽으므로 번들에 한글을 그대로 적을 수 있습니다. 4.3 WAR 는 메시지 소스에 인코딩을 지정하지 않아서 번들을 ISO-8859-1 로 읽습니다. 그래서 스택 정의의 `messageUnicodeEscape` 가 `war43` 에만 `true` 로 설정되어 있고, `msg` 헬퍼와 `egov_add_query_view` 가 한글을 `\uXXXX` 로 바꿔서 기록합니다.

WAR 의 번들 템플릿을 직접 고칠 때에도 한글을 `\uXXXX` 로 적어야 합니다.

## 메뉴

메뉴는 `_fragments/nav` 파일 하나로 관리합니다. `egov_add_entity`(`autoApplyMenu=true`)와 `egov_add_query_view` 는 프로젝트의 Controller 를 찾아서 만든 엔티티 목록으로 이 파일을 다시 생성합니다.

- 도구는 목록 화면에 메뉴를 포함하는 구문(Thymeleaf 의 `_fragments/nav :: links`, JSP 의 `/_fragments/nav.jsp`)이 있는지로 메뉴가 이미 포함되어 있는지 판단합니다. 구문이 없으면 제목 바로 뒤에 한 줄을 삽입합니다. 화면에 있는 주석 표식(`@egov:nav-include`)은 삽입한 위치를 알리는 용도이며, 도구가 이 주석을 읽지는 않습니다.
- 현재 화면에 해당하는 메뉴는 강조해서 표시합니다. Boot 는 `EgovNavModelAdvice` 가 모델에 넣는 `egovRequestUri` 값으로, WAR 는 요청 속성의 URI 로 판별합니다. `EgovNavModelAdvice` 는 컨텍스트 경로를 제거한 URI 를 넣으므로, 컨텍스트 경로 아래에 배포해도 강조가 유지됩니다.

## 화면 템플릿을 고친 뒤의 확인

화면 템플릿의 오류는 테스트로 모두 드러나지 않습니다. 테스트는 생성된 파일의 텍스트만 검사하기 때문입니다. EL 구문, Thymeleaf 표현식, 메시지 번들의 인코딩, 날짜 바인딩의 오류는 프로젝트를 실행해야 나타납니다. 화면 템플릿을 고쳤으면 [생성된 프로젝트의 동작 확인](../development/GENERATED_PROJECT_VERIFICATION.md)의 절차로 세 스택을 실행해서 확인합니다.

관련 테스트는 다음과 같습니다.

| 테스트 파일 | 검증 대상 |
|-------------|-----------|
| `tests/scaffold/krdsViews43.test.ts` | 4.3 두 스택의 KRDS 마크업, 정적 자산, 페이지네이션 렌더러, 달력, 메시지 번들 |
| `tests/scaffold/navLinkMapping.test.ts` | 메뉴의 링크와 Controller 의 URL 이 일치하는지 |
| `tests/scaffold/warDateBinding.test.ts` | WAR 의 날짜 바인딩 |
| `tests/scaffold/warRuntimeArtifacts.test.ts` | WAR 메뉴의 EL 구문과 `MANIFEST.MF` 의 형식 |
| `tests/scaffold/commentLabelsBundle.test.ts` | COMMENT 에서 만든 라벨이 메시지 번들에 반영되는지 |
