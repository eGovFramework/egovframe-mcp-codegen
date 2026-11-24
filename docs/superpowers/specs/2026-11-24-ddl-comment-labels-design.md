# DDL COMMENT 를 화면 라벨로 반영 — 설계

작성일: 2026-11-24

## 의도

`egov_scaffold_project` 와 `egov_add_entity` 가 생성하는 목록·등록·상세 화면과 메뉴, 필수 입력 안내문에서
컬럼 라벨이 `NttSj` 처럼 PascalCase 컬럼명으로 보인다. DDL 에 `COMMENT '공지사항제목'` 같은 논리명이
있으면 그 값이 보이도록 한다. 테이블 수준 `COMMENT='공지사항'` 도 엔티티 제목과 메뉴명에 반영한다.

## 현재 구조 (조사 결과)

- 화면(JSP, Thymeleaf) 은 라벨을 직접 쓰지 않고 `title.<entity>.<ccName>` 메시지 키를 참조한다.
  엔티티 제목은 `title.<entity>.sample` (Boot) / `title.<entity>` (WAR), 메뉴명은 `nav.<entity>`,
  목록 제목은 `list.<entity>`, 필수 입력 안내는 `confirm.required.<entity>.<ccName>` 이다.
- 키 값은 스캐폴드 시 `templates/<stack>/message/message-common*.properties.hbs`,
  엔티티 추가 시 `templates/<stack>/message/message-entity-keys*.properties.hbs` 가 채운다.
  현재 값은 `{{#if fkParent}}{{fkParent.entityName}}{{else}}{{pcName}}{{/if}}` 이다.
- `message-common.properties.hbs` 하나가 기본 번들과 `_ko` 번들 두 파일로 출력된다. `_en` 은 별도 템플릿.
- AST 파서(`ddlParserAst.ts`) 는 `node-sql-parser` 가 돌려주는 `comment` 노드와 `table_options` 를
  이미 받고 있으나 IR 에 담지 않는다. 폴백 정규식 파서(`ddlParserLegacy.ts`) 는 `COMMENT ON` 조각을 건너뛴다.
- WAR 4.3 은 `messageSource` 에 인코딩 지정이 없어 번들을 ISO-8859-1 로 읽는다. 스택 매트릭스의
  `messageUnicodeEscape: true` 가 이를 표시하며, `egov_add_query_view` 는 이미 `\uXXXX` 이스케이프를 적용한다.
- DDL 정규화기(`ddlNormalizer.ts`) 의 `splitTopLevelCommas` 는 따옴표를 인식하지 않아
  `COMMENT '내용, 본문'` 의 콤마에서 줄을 쪼갠다. 파싱은 되지만 코멘트 문자열 안에 줄바꿈이 섞인다.

## 목표 / 비목표 / 실패 조건

- 목표
  - 컬럼 COMMENT → `title.<entity>.<ccName>`, `confirm.required.<entity>.<ccName>` 의 라벨.
  - 테이블 COMMENT → `title.<entity>.sample`(Boot) / `title.<entity>`(WAR), `nav.<entity>`, `list.<entity>`.
  - 세 스택(boot43, boot50, war43), 두 도구(scaffold, add_entity), 두 파서(AST, legacy) 에 동일 적용.
  - WAR 4.3 에서 한글 라벨이 깨지지 않는다.
- 비목표
  - 화면 템플릿(JSP/Thymeleaf) 변경, `_en` 번들 번역, VO Javadoc 등 다른 산출물에 코멘트 반영.
  - `egov_add_query_view` 변경 (이미 `columns[].label` 로 라벨을 받는다).
- 실패 조건
  - 코멘트가 없는 DDL 의 산출물이 지금과 달라지는 것 (골든 파일은 코멘트가 있는 픽스처로 갱신하되,
    코멘트 없는 경로의 출력은 불변이어야 한다).
  - 코멘트의 설명문이 그대로 라벨로 노출되는 것 (아래 라벨 규칙으로 차단).

## 검토한 접근

1. **파서가 코멘트를 IR 에 담고, 생성 컨텍스트가 라벨을 계산하고, 번들 템플릿이 출력 (채택).**
   한 경로로 두 도구·세 스택·두 파서를 모두 덮고 화면 템플릿은 그대로 둔다.
2. 렌더링된 번들 문자열을 도구 계층에서 후처리(`=NttSj` 치환). 템플릿 구조에 의존하는 문자열 치환으로 깨지기 쉬움. 제외.
3. 라벨을 화면 템플릿에 직접 기록. 메시지 번들을 우회해 다국어와 validator 메시지가 어긋남. 제외.

## 결정 사항

### 파서 (IR 확장)

- `Column` 에 `comment: string | null` 추가. 두 파서가 모두 채운다.
  - AST: `def.comment.value.value` (문자열 리터럴). 없으면 null.
  - Legacy: 컬럼 정의 안의 인라인 `COMMENT '...'` 와, CREATE TABLE 뒤에 오는
    `COMMENT ON COLUMN <table>.<col> IS '...'` (Oracle/Tibero/PostgreSQL) 둘 다 추출.
    `''` 는 `'` 로 복원한다.
- `ParsedDDLCore` 에 `tableComment: string | null` 추가.
  - AST: `table_options` 중 `keyword === "comment"` 항목의 값(양끝 따옴표 제거).
  - Legacy: 닫는 `)` 뒤의 `COMMENT[=]'...'` 또는 `COMMENT ON TABLE <table> IS '...'`.
- 코멘트 원문은 trim 만 하고 가공 없이 IR 에 보존한다. 라벨 규칙은 생성 컨텍스트에서 적용한다.

### 정규화기

- `splitTopLevelCommas` 가 단일/이중 따옴표 안의 콤마와 괄호를 무시하도록 수정한다. `''` 이스케이프를 고려한다.

### 라벨 결정 규칙 (사용자 지정 예외 포함)

코멘트 원문에 다음을 순서대로 적용해 `label` 을 구한다. 어느 단계든 "폴백" 이면 코멘트가 없는 경우와
동일한 현행 값으로 돌아간다.

1. 코멘트 전체에 콤마(`,`) 가 하나라도 있으면 폴백. (콤마가 있는 코멘트는 논리명이 아니라고 본다.)
2. 여는 괄호가 있으면 괄호 앞부분만 취한다(trim). 괄호 앞에 남는 문자가 없으면 폴백.
   ASCII `(` 와 전각 `（` 를 모두 괄호로 본다.
3. 1, 2 를 거친 뒤 남은 값이 10글자를 넘으면(코드 포인트 기준, 11자 이상) 설명문으로 간주해 폴백.
4. 남은 값이 비어 있으면 폴백.

폴백 값:

- 컬럼: FK 부모가 해석되었으면 `fkParent.entityName`, 아니면 `pcName` (현행과 동일).
- 테이블: `entityName` (현행과 동일).

위 규칙은 컬럼 코멘트와 테이블 코멘트에 똑같이 적용한다. 규칙 구현은 순수 함수
(`deriveLabelFromComment(comment): string | null`) 하나로 두고 두 곳에서 재사용한다.

### 생성 컨텍스트

- `ScaffoldContext` 의 각 `Column` 에 `label: string` 을, 컨텍스트 루트에 `entityLabel: string` 을 추가한다.
  (`fkParent` 해석이 끝난 뒤 계산해야 하므로 scaffoldGenerator 에서 컨텍스트를 만드는 단계에서 채운다.
  `egov_add_entity` 가 FK 해석 후 컨텍스트를 보정하는 지점이 있으면 그 뒤에 재계산한다.)

### 메시지 번들 템플릿

- 기본/ko 템플릿(`message-common.properties.hbs`, `message-entity-keys.properties.hbs`, 세 스택):
  - `title.<entity>.<ccName>={{msg label}}`
  - `confirm.required.<entity>.<ccName>={{msg label}}은(는) 필수 입력값입니다.` (WAR 는 현재 영문 문구이므로
    WAR 기본/ko 템플릿의 문구는 그대로 두고 라벨만 바꾼다.)
  - `nav.<entity>={{msg entityLabel}}`
  - Boot: `title.<entity>.sample={{msg entityLabel}} 목록`, `list.<entity>`:
    테이블 코멘트가 있으면 `{{msg entityLabel}} 목록`, 없으면 현행 `List {{entityName}}` 유지.
  - WAR: `title.<entity>={{msg entityLabel}}`, `list.<entity>`: 테이블 코멘트가 있으면
    `{{msg entityLabel}} 목록`, 없으면 현행 `{{entityName}} List` 유지.
- `_en` 템플릿은 변경하지 않는다.
- `msg` 헬퍼: 문자열을 받아 컨텍스트 루트의 `stack.messageUnicodeEscape` 가 참이면 비ASCII 문자를
  `\uXXXX` 로 이스케이프해 돌려준다. `egov_add_query_view` 의 `escapeNonAscii` 를 공용 유틸로 옮겨 재사용한다.
  properties 값에서 특수한 `\`, 줄바꿈은 코멘트에서 올 수 있으므로 이스케이프한다.

### 입력 설명문과 문서

- `ddl` 필드의 `.describe()` 와 README, `templates/skills/` 의 DDL 안내에 "컬럼/테이블 COMMENT 가 화면 라벨로
  쓰이며, 콤마·괄호·10자 초과 규칙으로 걸러진다" 는 한 줄을 추가한다.
- `egov_add_entity` 결과 메시지에 코멘트가 라벨로 반영된 컬럼 수와 규칙 때문에 폴백된 컬럼이 있으면 안내한다.

## 테스트

- 파서 단위: AST/legacy 양쪽에서 인라인 COMMENT, `COMMENT ON COLUMN/TABLE`, 테이블 `COMMENT=` 추출,
  `''` 복원, 코멘트 없음 → null.
- 라벨 규칙 단위: 콤마 폴백, 괄호 앞부분 취득, 괄호 앞 공백만 → 폴백, 10자 경계(10자 통과, 11자 폴백),
  전각 괄호, 공백 trim.
- 정규화기: 따옴표 안 콤마와 괄호에서 줄을 쪼개지 않는다.
- 통합: 세 스택 scaffold 와 add_entity 의 번들 출력에 라벨이 반영되고, WAR 는 `\u` 이스케이프,
  `_en` 은 불변, 코멘트 없는 DDL 은 출력 불변.
- 골든: `SHARED_DDL` 에 컬럼·테이블 코멘트를 넣고 `npm run test:update` 로 갱신.
- 수동 확인: WAR 4.3 산출물을 Tomcat 으로 기동해 목록 화면 라벨과 메뉴명을 확인한다 (CLAUDE.md 절차).

## 빌더 재량

- 헬퍼 이름, 공용 유틸 파일 위치, 라벨 규칙 함수의 파일 위치.
- 결과 메시지의 문구.
- 전각 괄호 외 다른 괄호 문자(`[`, `{`) 포함 여부 — 포함하지 않는 것을 기본으로 한다.
