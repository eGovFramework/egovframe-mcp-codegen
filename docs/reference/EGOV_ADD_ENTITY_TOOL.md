# egov_add_entity

이미 생성된 표준프레임워크 프로젝트에 새 엔티티의 CRUD 코드를 추가합니다. `CREATE TABLE` 문 하나를 받아서 Controller, Service, ServiceImpl, Mapper, VO, MyBatis SQL, 목록 화면과 등록(수정) 화면을 만듭니다.

- 구현: `src/tools/egovAddEntity.ts`
- 대상 스택: 5.1 Boot, 4.3 Boot, 4.3 WAR. 스택은 대상 프로젝트의 `pom.xml` 에서 감지하므로 인자로 지정하지 않습니다.

## 인자

| 인자 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `projectPath` | string | 필수 | | 기존 프로젝트의 루트 경로입니다. `pom.xml` 이 있어야 합니다. |
| `packageName` | string | 필수 | | 새 엔티티의 Java 패키지입니다. 마지막 마디가 모듈 이름이 됩니다. 엔티티마다 다른 모듈 패키지를 쓸 수 있습니다. 예: `egovframework.example.article` |
| `entityName` | string | 필수 | | 엔티티 이름입니다. 대문자로 시작하는 영문과 숫자로 씁니다. 예: `Article` |
| `ddl` | string | 필수 | | 엔티티의 `CREATE TABLE` 문입니다. [DDL 입력 규칙](./DDL_INPUT.md) 참조 |
| `idGeneration` | `auto` \| `manual` | 선택 | `auto` | 기본 키를 만드는 방식입니다. 아래의 "기본 키 채번" 참조 |
| `withAttachment` | boolean | 선택 | 사용자에게 확인 | `true` 이면 엔티티에 표준 첨부파일을 연결합니다. 사용자가 밝히지 않았으면 생략합니다. Boot 에서만 지원합니다. |
| `autoApplyMigration` | boolean | 선택 | `true` | 새 테이블의 DDL 을 내장 HSQLDB 의 시드 SQL 에 덧붙입니다. |
| `autoApplyMessages` | boolean | 선택 | `true` | 새 엔티티의 메시지 키를 메시지 번들 3개에 덧붙입니다. |
| `autoApplyMenu` | boolean | 선택 | `false` | 메뉴 fragment 를 다시 만들어서 모든 목록 화면에 새 엔티티의 메뉴가 보이게 합니다. |
| `normalizeDdl` | boolean | 선택 | `true` | DDL 의 대소문자, 공백, 따옴표를 정리하고 정리한 내용을 결과에 첨부합니다. |
| `description` | string | 선택 | | 엔티티의 설명입니다. |
| `attachmentFieldName` | string | 선택 | `atchFileId` | 첨부 그룹 키를 담는 VO 필드의 이름입니다. 표준 이름을 바꾸지 않는 것을 권장합니다. DB 컬럼 이름은 이 값과 관계없이 `ATCH_FILE_ID` 입니다. |
| `maxAttachmentCount` | number | 선택 | `0` | 1 이상이면 파일 선택 입력에 `data-max-count` 속성으로 출력됩니다. 개수를 실제로 제한하는 스크립트나 서버 측 검사는 생성되지 않습니다. |

## 동작 순서

1. `pom.xml` 을 읽어서 스택을 감지합니다. 표준 eGovFrame 프로젝트가 아니면 거부합니다.
2. DDL 을 정리하고 파싱합니다.
3. 자동 채번일 때 기본 키 컬럼의 길이를 검사합니다.
4. DDL 의 외래키가 참조하는 엔티티를 프로젝트에서 찾습니다.
5. 만들 파일을 모두 메모리에서 렌더링하고 기존 파일과 비교합니다.
6. 렌더링 결과를 검사한 뒤에 파일을 씁니다. `withAttachment=true` 이고 첨부파일 인프라가 없으면 인프라를 먼저 씁니다.
7. 시드 SQL, 메시지 번들, 메뉴에 새 엔티티를 반영합니다.

5단계에서 만들 파일이 하나라도 이미 있으면 어떤 파일도 쓰지 않고 충돌한 파일의 목록을 돌려줍니다. 만들 파일이 모두 있고 내용까지 같으면 변경 없이 성공으로 응답하며, 이때 7단계는 수행하지 않습니다. 이전 호출에서 이미 반영되었을 내용이 중복으로 덧붙는 일을 막기 위해서입니다.

6단계에서 파일 쓰기가 실패하면 이미 쓴 파일을 지우고 원래 상태로 되돌립니다. 7단계는 되돌리기 대상이 아닙니다.

## 생성되는 파일

`packageName` 이 `egovframework.example.article`, `entityName` 이 `Article` 일 때의 예입니다.

| 파일 | 5.1 Boot, 4.3 Boot | 4.3 WAR |
|------|--------------------|---------|
| VO | `src/main/java/egovframework/example/article/service/ArticleVO.java`, `ArticleDefaultVO.java` | 같음 |
| Service | `.../article/service/EgovArticleService.java`, `impl/EgovArticleServiceImpl.java` | 같음 |
| Mapper | `.../article/service/impl/ArticleMapper.java` | 같음 |
| Controller | `.../article/web/EgovArticleController.java` | 같음 |
| MyBatis SQL | `src/main/resources/egovframework/sqlmap/article/mappers/EgovArticle_Article_SQL.xml` | 같음 |
| ID 채번 설정 | `src/main/java/egovframework/example/config/EgovConfigArticleIdGeneration.java` | `src/main/resources/egovframework/spring/context-article-idgen.xml` |
| 마이그레이션 SQL | `src/main/resources/db/migrations/<dialect>/articledb.sql` (7개) | 같음 |
| 화면 | 5.1 Boot 는 `src/main/resources/templates/thymeleaf/article/` 아래, 4.3 Boot 는 `src/main/resources/templates/thymeleaf/` 바로 아래의 `egovArticleList.html`, `egovArticleRegister.html` | `src/main/webapp/WEB-INF/jsp/egovframework/example/article/egovArticleList.jsp`, `egovArticleRegister.jsp` |

`idGeneration='manual'` 이면 ID 채번 설정 파일은 만들지 않습니다.

## 기본 키 채번

| 값 | 동작 | 맞는 경우 |
|----|------|-----------|
| `auto` | `EgovTableIdGnrServiceImpl` 이 `<테이블 이름>-NNNNN` 형식의 값을 만듭니다(예: `ARTICLE-00001`). 등록 화면에는 기본 키 입력란이 보이지 않습니다. | 게시글, 주문, 고객처럼 식별자를 시스템이 정하는 테이블 |
| `manual` | 채번 설정과 채번 호출을 만들지 않고, 사용자가 등록 화면에서 기본 키를 직접 입력합니다. | 배송 상태, 권한 코드, 분류 코드처럼 짧은 코드를 기본 키로 쓰는 테이블 |

`auto` 일 때에는 기본 키 컬럼의 길이가 `테이블 이름의 길이 + 6` 이상이어야 합니다. 하이픈 1자와 일련번호 5자리를 더한 길이입니다. 길이가 모자라면 도구는 파일을 만들지 않고 다음과 같이 거부합니다.

```text
엔티티 추가 실패: [재시도 불가 — 입력을 수정해야 합니다] PK 컬럼 길이 부족: 'ID VARCHAR(5)' 인데 자동 채번 형식은 'SHORT_PK-NNNNN' (14자) 입니다.
해결 방향 두 가지:
  (a) PK 길이를 14 이상으로 늘려서 다시 호출 — 데이터 테이블이라 surrogate ID 채번이 적합한 경우.
  (b) idGeneration='manual' 로 호출 — DeliveryStatus / Role / CategoryCode 같은 코드 마스터 테이블이라 PK 가 짧은 자연 코드(RCPT/SHIP/DONE 등) 인 경우. 같은 인자로 재호출하면 동일하게 실패합니다.
```

## 외래키

DDL 에 단일 컬럼 외래키(`REFERENCES` 또는 `FOREIGN KEY ... REFERENCES`)가 있으면, 도구는 참조되는 테이블에 해당하는 엔티티를 프로젝트에서 찾습니다. 테이블 이름을 PascalCase 로 바꾼 이름과, `TB_`, `T_`, `TBL_`, `M_`, `MST_`, `SAMPLE_` 접두어를 뗀 이름으로 `Egov<이름>Controller.java` 를 찾습니다.

참조 엔티티를 찾으면 다음과 같이 생성합니다.

- 등록 화면에서 외래키 컬럼이 콤보 상자가 됩니다. 콤보 상자에는 참조 엔티티의 표시 컬럼이 보이고, 항목을 고르면 그 행의 기본 키가 저장됩니다.
- 목록 화면에는 외래키 값 대신 참조 엔티티의 표시 컬럼이 보이고, 그 컬럼으로 검색할 수 있습니다. 목록 SQL 에 `LEFT JOIN` 이 들어갑니다.
- 메시지 번들의 컬럼 라벨은 COMMENT 가 없으면 참조 엔티티의 이름이 됩니다.

표시 컬럼은 참조 엔티티의 VO 에서 다음 순서로 찾습니다.

1. `<엔티티 이름>Name` (예: `boardName`)
2. `name`, `title`, `label`
3. `fname` 과 `lname`, 또는 `firstName` 과 `lastName` 의 쌍. 이 경우 두 필드를 이어서 표시합니다.
4. `Id` 로 끝나지 않는 첫 번째 문자열 필드. 그런 필드가 없으면 첫 번째 문자열 필드

참조 엔티티를 찾지 못하면 외래키 컬럼은 일반 입력란으로 생성되고, 결과 메시지에 경고가 나옵니다. 따라서 참조되는 엔티티를 먼저 생성한 뒤에 참조하는 엔티티를 추가합니다.

## 첨부파일

`withAttachment` 를 생략하면 서버가 사용자에게 묻습니다. 프로젝트가 WAR 이면 묻지 않고 `false` 로 처리합니다. WAR 프로젝트에 `true` 를 지정하면 파일을 만들지 않고 `[재시도 불가]` 오류로 거부합니다.

`true` 이면 VO, 테이블 DDL, Mapper SQL, Controller, 등록 화면에 첨부파일 처리가 들어갑니다. 프로젝트에 첨부파일 인프라가 없으면 기본 옵션으로 함께 설치하며, 이 경우에 한해 `application.properties`, `globals.properties`, 메시지 번들, 시드 SQL 이 함께 수정됩니다. 상세한 구조는 [첨부파일 인프라와 엔티티 연결 구조](../architecture/ATTACH_FILE.md)에 있습니다.

## 자동 반영 옵션

### autoApplyMigration

새 테이블의 `CREATE TABLE` 문과 채번 테이블의 초기 행을 내장 HSQLDB 의 시드 SQL 끝에 덧붙입니다. 그래서 프로젝트를 다시 실행하면 새 테이블이 바로 만들어집니다.

시드 SQL 로 볼 파일이 `src/main/resources/db/` 에 정확히 1개일 때만 덧붙입니다. `add-*-tables.sql` 과 `attach-file.sql` 은 시드 후보에서 제외합니다. 후보가 없거나 2개 이상이면 덧붙이지 않고 `src/main/resources/db/add-<엔티티>-tables.sql` 을 따로 만든 뒤, 결과 메시지에 그 이유를 알립니다. `false` 로 호출해도 이 별도 파일을 만듭니다.

운영 DB 용 SQL 은 이 옵션과 관계없이 `src/main/resources/db/migrations/<dialect>/` 에 7개 DBMS 별로 생성됩니다. 이 파일들은 자동으로 실행되지 않으며, 운영 DB 에 직접 적용합니다.

### autoApplyMessages

화면이 참조하는 메시지 키를 `src/main/resources/egovframework/message/` 의 `message-common.properties`, `message-common_ko.properties`, `message-common_en.properties` 끝에 덧붙입니다. 추가되는 키는 다음과 같습니다.

| 키 | 용도 |
|----|------|
| `list.<엔티티>` | 목록 화면의 제목 |
| `title.<엔티티>.sample` (Boot), `title.<엔티티>` (WAR) | 화면의 제목 |
| `nav.<엔티티>` | 메뉴 이름 |
| `title.<엔티티>.<컬럼>` | 컬럼의 라벨. 모든 컬럼에 생성됩니다. |
| `confirm.required.<엔티티>.<컬럼>` | 필수 입력 안내문. 기본 키가 아닌 문자열 컬럼마다 생성되며, 실제 검증은 `NOT NULL` 컬럼에만 적용됩니다. |
| `title.<엔티티>.attachment`, `info.<엔티티>.attachment.existing` | 첨부파일 항목의 문구. `withAttachment=true` 일 때만 생성됩니다. |

3개 파일이 모두 있을 때만 동작합니다. 하나라도 없으면 아무것도 고치지 않고, 추가해야 할 키를 결과 메시지로 안내합니다. 이 옵션을 끄고 키를 직접 추가하지 않으면, Boot 의 화면에는 `??title.article.subject_ko_KR??` 와 같은 해석되지 않은 키가 그대로 보입니다. 4.3 WAR 의 JSP 는 메시지를 찾지 못하면 화면을 그리는 도중에 오류가 발생합니다.

### autoApplyMenu

`src/main/java` 아래의 `Egov*Controller.java` 를 찾아서 프로젝트의 엔티티 목록을 만들고, 새 엔티티를 더한 목록으로 메뉴 fragment(`_fragments/nav.html` 또는 `_fragments/nav.jsp`)를 다시 만듭니다. 기존 목록 화면에 메뉴를 포함하는 줄이 없으면 한 줄을 삽입합니다.

메뉴의 위치와 모양은 프로젝트마다 다르게 고치는 경우가 많아서 기본값이 `false` 입니다. 메뉴 갱신 중에 오류가 발생해도 엔티티 추가는 실패로 처리하지 않고, 결과 메시지에 갱신하지 못한 이유를 알립니다.

### validator.xml (4.3 WAR)

4.3 WAR 프로젝트에서는 옵션과 관계없이 `src/main/webapp/WEB-INF/config/egovframework/validator/validator.xml` 에 새 엔티티의 필수 입력 검증 규칙(`<form name="<엔티티>VO">`)을 삽입합니다. 등록 화면의 클라이언트 검증 스크립트가 이 규칙을 참조하기 때문입니다. 필수 입력 문자열 컬럼이 없으면 삽입하지 않습니다.

## 결과 메시지

성공하면 다음 내용을 담은 텍스트를 돌려줍니다.

- 프로젝트 경로, 감지한 스택과 그 근거, 엔티티와 테이블 이름, 추가한 파일의 목록
- 첨부파일 인프라를 함께 설치했을 때 그 요약
- 외래키를 처리한 결과와, 참조 엔티티를 찾지 못한 외래키의 경고
- COMMENT 를 화면 라벨로 반영한 컬럼의 수와, 규칙에 따라 반영하지 않은 COMMENT
- 운영 DB 용 마이그레이션 SQL 의 위치
- 시드 SQL, 메뉴, `validator.xml`, 메시지 번들의 반영 결과 또는 반영하지 못한 이유
- DDL 을 정리했거나 보조 파서로 처리했을 때 그 내용
- 생성한 파일의 자체 검증 결과

`packageName` 에서 계산한 기본 패키지가 프로젝트의 실제 기본 패키지와 다르면, 도구는 프로젝트의 값으로 맞추고 그 사실을 결과에 알립니다. 프로젝트의 기본 패키지는 `cmm/vo/FkComboVO.java` 의 패키지 선언에서 읽습니다.

## 호출 예

사용자의 요청:

```text
/workspace/board-app 에 Article 엔티티를 추가해 줘. 첨부파일은 필요 없고 메뉴에도 넣어 줘.

CREATE TABLE ARTICLE (
  ARTICLE_ID VARCHAR(20)  NOT NULL COMMENT '기사ID',
  BOARD_ID   VARCHAR(20)           COMMENT '게시판',
  SUBJECT    VARCHAR(100) NOT NULL COMMENT '제목',
  PRIMARY KEY (ARTICLE_ID),
  CONSTRAINT FK_ARTICLE_BOARD FOREIGN KEY (BOARD_ID) REFERENCES BOARD(BOARD_ID)
) COMMENT='기사'
```

AI 가 구성하는 도구 입력:

```json
{
  "projectPath": "/workspace/board-app",
  "packageName": "egovframework.example.article",
  "entityName": "Article",
  "ddl": "CREATE TABLE ARTICLE ( ... ) COMMENT='기사'",
  "withAttachment": false,
  "autoApplyMenu": true
}
```

## 주의할 점

- 같은 엔티티를 다른 내용으로 다시 만들 수 없습니다. 내용을 바꾸려면 생성된 파일을 직접 고치거나, 파일을 지운 뒤에 다시 호출합니다. 파일을 지우고 다시 호출하면 시드 SQL 과 메시지 번들에 같은 엔티티의 내용이 한 번 더 덧붙으므로, 이전에 덧붙은 부분을 먼저 지웁니다.
- 복합 기본 키는 SQL 에는 반영되지만, 자동 채번과 목록 화면의 상세 이동은 첫 번째 기본 키 컬럼만 사용합니다. 기본 키가 없는 테이블은 지원하지 않습니다.
- 선택 입력인 외래키 컬럼을 비운 채로 등록하면 DB 오류가 발생합니다. [알려진 문제와 제약 사항](../development/KNOWN_ISSUES.md)을 참고합니다.
