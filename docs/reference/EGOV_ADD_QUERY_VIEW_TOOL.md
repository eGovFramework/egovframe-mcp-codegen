# egov_add_query_view

이미 생성된 표준프레임워크 프로젝트에 조회 전용 화면을 추가합니다. 여러 테이블을 JOIN 하는 `SELECT` 문과 컬럼 정보를 받아서, 목록, 페이징, 검색만 갖춘 리포트 화면을 만듭니다. 등록, 수정, 삭제 기능은 만들지 않습니다.

- 구현: `src/tools/egovAddQueryView.ts`
- 대상 스택: 5.1 Boot, 4.3 Boot, 4.3 WAR. 스택은 대상 프로젝트의 `pom.xml` 에서 감지합니다.

## 인자

| 인자 | 타입 | 필수 | 기본값 | 설명 |
|------|------|------|--------|------|
| `projectPath` | string | 필수 | | 기존 프로젝트의 루트 경로입니다. |
| `packageName` | string | 필수 | | 조회 화면의 코드를 둘 Java 패키지입니다. 마지막 마디가 모듈 이름이 되어 SQL 매퍼와 화면의 디렉터리 이름에 쓰입니다. 예: `egovframework.example.report` |
| `viewName` | string | 필수 | | 화면의 이름입니다. 대문자로 시작하는 영문과 숫자로 씁니다. 클래스 이름과 URL 에 쓰입니다. 예: `StudentEnrollmentReport` |
| `sql` | string | 필수 | | 조회에 사용할 `SELECT` 문입니다. 아래의 "SQL 작성 규칙" 참조 |
| `columns` | array | 필수 | | 화면에 표시할 컬럼의 목록입니다. 1개 이상이어야 합니다. 아래의 "컬럼 정보" 참조 |
| `searchable` | string[] | 선택 | `[]` | 검색 조건으로 고를 수 있게 할 컬럼의 alias 목록입니다. 비어 있으면 검색 영역을 만들지 않습니다. |
| `defaultOrderBy` | string | 선택 | 첫 컬럼 내림차순 | 기본 정렬입니다. `alias [ASC\|DESC]` 를 콤마로 나열합니다. 예: `studentId DESC, courseName ASC` |
| `autoApplyMenu` | boolean | 선택 | `true` | 메뉴 fragment 에 이 화면을 추가합니다. |
| `autoApplyMessages` | boolean | 선택 | `true` | 컬럼 라벨과 메뉴 라벨을 메시지 번들에 덧붙입니다. |
| `description` | string | 선택 | | 화면의 한 줄 설명입니다. |

### 컬럼 정보

`columns` 의 각 항목은 다음 필드를 가집니다.

| 필드 | 필수 | 설명 |
|------|------|------|
| `alias` | 필수 | `SELECT` 문에서 `AS` 로 붙인 별칭입니다. 소문자로 시작하는 영문과 숫자(camelCase)로 씁니다. VO 의 필드 이름이 됩니다. |
| `label` | 필수 | 표의 머리글에 표시할 이름입니다. 줄바꿈 등의 제어 문자와 역슬래시는 쓸 수 없습니다. |
| `type` | 선택 | `String`(기본값), `Date`, `Timestamp`, `Number`, `Boolean` 가운데 하나입니다. |
| `format` | 선택 | `Date`, `Timestamp`, `Number` 의 표시 형식입니다. |

`type` 에 따라 VO 의 Java 타입과 화면의 표시 방식이 정해집니다.

| `type` | Java 타입 | 화면 표시 | `format` |
|--------|-----------|-----------|----------|
| `String` | `java.lang.String` | 값을 그대로 표시 | 사용하지 않음 |
| `Date` | `java.sql.Date` | 날짜 형식으로 표시 | 날짜 패턴. 기본값은 `yyyy-MM-dd` |
| `Timestamp` | `java.sql.Timestamp` | 날짜와 시각 형식으로 표시 | 날짜 패턴. 기본값은 `yyyy-MM-dd HH:mm:ss` |
| `Number` | `java.math.BigDecimal` | 오른쪽 정렬. `format` 이 있으면 그 형식으로 표시 | `0`, `#`, 콤마, 소수점의 조합. 예: `#,##0`, `#,##0.00`, `0.00` |
| `Boolean` | `java.lang.Boolean` | "예" 또는 "아니오" (메시지 번들의 `input.yes`, `input.no`) | 사용하지 않음 |

`Number` 의 형식에서 콤마는 천 단위 구분 기호를 뜻하고, 소수점 뒤의 글자 수가 표시할 소수 자릿수가 됩니다. 이 범위를 벗어난 형식(통화 기호, 퍼센트 등)은 입력 검증에서 거부합니다. `Date` 와 `Timestamp` 의 형식에는 글자, 숫자, 공백과 `-`, `/`, `.`, `:`, `,` 만 쓸 수 있습니다.

`searchable` 과 `defaultOrderBy` 에는 `columns` 에 적은 alias 만 쓸 수 있으며, 없는 alias 를 적으면 입력 검증에서 거부합니다.

## SQL 작성 규칙

- `SELECT` 로 시작해야 합니다.
- 화면에 표시할 모든 컬럼에 `AS` 로 별칭을 붙이고, 그 별칭을 `columns` 의 `alias` 와 똑같이 적습니다. 도구는 SQL 을 해석해서 별칭을 대조하지 않습니다. 둘이 다르면 생성은 성공하지만, 화면에서 해당 컬럼이 비어 보이거나 검색과 정렬에서 SQL 오류가 발생합니다.
- `LIMIT`, `OFFSET` 과 같은 페이징 구문과 문장 끝의 세미콜론은 넣지 않습니다. 도구가 SQL 을 서브쿼리로 감싼 다음 페이징과 검색 조건을 바깥에 붙이기 때문입니다. 도구는 이 구문이 들어 있는지 검사하지 않으므로, 넣어도 생성은 성공하지만 화면이 의도와 다르게 동작하거나 SQL 오류가 발생합니다.
- JOIN, 표현식, `WHERE` 조건, `GROUP BY` 는 자유롭게 쓸 수 있습니다.
- `]]>` 는 쓸 수 없습니다. SQL 이 MyBatis 매퍼 XML 의 CDATA 구역에 들어가기 때문입니다.

도구는 입력한 SQL 을 실행하거나 검증하지 않고 그대로 매퍼 XML 에 넣습니다. 따라서 대상 DBMS 에서 실행되는 SQL 인지는 작성하는 쪽에서 확인해야 합니다.

### 생성되는 SQL

입력한 SQL 은 다음과 같은 형태로 감싸집니다.

```sql
SELECT * FROM ( <입력한 SELECT 문> ) v
WHERE 1=1
  AND v.<검색 컬럼> LIKE CONCAT('%', #{searchKeyword}, '%')   -- 검색어가 있을 때만
ORDER BY <defaultOrderBy>
LIMIT #{recordCountPerPage} OFFSET #{firstIndex}
```

전체 건수는 같은 서브쿼리에 `SELECT COUNT(*)` 를 적용해서 구합니다.

페이징 구문은 `LIMIT ... OFFSET ...` 으로 고정되어 있고, 검색은 인자 3개짜리 `CONCAT` 을 사용합니다. 이 구문은 HSQLDB, MySQL, MariaDB, PostgreSQL, CUBRID, Goldilocks 에서 동작합니다. Oracle, Tibero, Altibase 로 바꿀 때에는 생성된 매퍼 XML 의 주석에 적힌 대로 두 부분을 직접 고쳐야 합니다.

검색 조건은 `searchCondition` 요청 값으로 고르며, 이 값은 alias 가 아니라 검색 가능 컬럼의 순번(0부터 시작)입니다. 순번은 `searchable` 에 적은 순서가 아니라 `columns` 에 적은 순서를 따릅니다.

## 생성되는 파일

`packageName` 이 `egovframework.example.report`, `viewName` 이 `BoardArticleReport` 일 때의 예입니다. 스택마다 8개 파일을 만듭니다.

| 파일 | 경로 |
|------|------|
| VO | `src/main/java/egovframework/example/report/BoardArticleReportVO.java`, `BoardArticleReportDefaultVO.java` |
| Service | `.../report/EgovBoardArticleReportService.java`, `impl/EgovBoardArticleReportServiceImpl.java` |
| Mapper | `.../report/impl/BoardArticleReportMapper.java` |
| Controller | `.../report/web/EgovBoardArticleReportController.java` |
| MyBatis SQL | `src/main/resources/egovframework/sqlmap/report/mappers/EgovBoardArticleReport_BoardArticleReport_SQL.xml` |
| 화면 (5.1 Boot) | `src/main/resources/templates/thymeleaf/report/egovBoardArticleReportList.html` |
| 화면 (4.3 Boot) | `src/main/resources/templates/thymeleaf/egovBoardArticleReportList.html` |
| 화면 (4.3 WAR) | `src/main/webapp/WEB-INF/jsp/egovframework/example/report/egovBoardArticleReportList.jsp` |

화면의 URL 은 세 스택 모두 `GET /egov<viewName>List.do` 하나입니다. 위의 예에서는 `/egovBoardArticleReportList.do` 입니다.

## 메뉴와 메시지 번들

`autoApplyMenu=true` 이면 메뉴 fragment 파일이 이미 있을 때 그 파일을 다시 만들어서 새 화면을 추가합니다. `egov_add_entity` 와 달리 기존 목록 화면에 메뉴를 포함하는 줄을 삽입하지는 않습니다. 메뉴 fragment 파일이 없거나 갱신에 실패하면 결과 메시지에 알리지 않고 건너뜁니다.

`autoApplyMessages=true` 이면 메시지 번들 3개가 모두 있을 때 다음 키를 덧붙입니다. 번들이 하나라도 없으면 결과 메시지에 알리지 않고 건너뛰므로, 결과 메시지에 메시지 번들을 적용했다는 줄이 있는지 확인합니다. 4.3 WAR 에서는 한글을 `\uXXXX` 형태로 기록합니다.

| 키 | 값 |
|----|-----|
| `list.<view>`, `title.<view>.sample`, `nav.<view>` | `viewName` 그대로 |
| `title.<view>.<alias>` | 해당 컬럼의 `label` |

화면의 제목과 메뉴 이름에는 `viewName` 이 그대로 쓰입니다. 한글 이름으로 바꾸려면 생성한 뒤에 메시지 번들의 `list.<view>`, `title.<view>.sample`, `nav.<view>` 값을 고칩니다.

## 충돌과 재호출

만들 파일이 하나라도 이미 있으면 어떤 파일도 쓰지 않고 거부합니다. 만들 파일이 모두 있고 내용까지 같으면 변경 없이 성공으로 응답합니다. 다만 파일의 내용은 같아도 `label` 만 바꿔서 다시 호출한 경우에는, 메시지 번들에 이미 덧붙은 내용과 달라지므로 충돌로 거부합니다.

## 호출 예

사용자의 요청:

```text
/workspace/board-app 에 게시판별 기사 현황 화면을 추가해 줘.

SELECT b.BOARD_ID   AS boardId,
       b.TITLE      AS boardTitle,
       a.SUBJECT    AS articleSubject,
       b.CREATED_AT AS createdAt
FROM BOARD b
LEFT JOIN ARTICLE a ON a.BOARD_ID = b.BOARD_ID
```

AI 가 구성하는 도구 입력:

```json
{
  "projectPath": "/workspace/board-app",
  "packageName": "egovframework.example.report",
  "viewName": "BoardArticleReport",
  "sql": "SELECT b.BOARD_ID AS boardId, b.TITLE AS boardTitle, a.SUBJECT AS articleSubject, b.CREATED_AT AS createdAt FROM BOARD b LEFT JOIN ARTICLE a ON a.BOARD_ID = b.BOARD_ID",
  "columns": [
    { "alias": "boardId", "label": "게시글ID" },
    { "alias": "boardTitle", "label": "게시글 제목" },
    { "alias": "articleSubject", "label": "기사 제목" },
    { "alias": "createdAt", "label": "등록일시", "type": "Timestamp", "format": "yyyy-MM-dd HH:mm" }
  ],
  "searchable": ["boardTitle", "articleSubject"],
  "defaultOrderBy": "boardId DESC"
}
```
