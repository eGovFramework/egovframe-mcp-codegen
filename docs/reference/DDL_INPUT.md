# DDL 입력 규칙

`egov_scaffold_project` 와 `egov_add_entity` 는 `ddl` 인자로 `CREATE TABLE` 문을 받습니다. 이 문서는 받아들이는 문법, 컬럼 타입의 매핑, COMMENT 를 화면 라벨로 쓰는 규칙을 설명합니다.

## 기본 규칙

- 한 번의 호출에 `CREATE TABLE` 문 하나를 넣습니다. 여러 문장을 넣으면 첫 번째 `CREATE TABLE` 만 사용합니다.
- 표준 MySQL 문법으로 작성하는 것을 권장합니다. 도구가 MySQL 문법 파서를 먼저 사용하기 때문입니다.
- 기본 키를 선언합니다. 기본 키가 없는 테이블은 지원하지 않습니다.
- 자동 채번을 사용하는 테이블의 이름은 16자 이하로 합니다. 채번 테이블(`IDS`)의 `TABLE_NAME` 컬럼이 `VARCHAR(16)` 이기 때문입니다.

권장하는 형태는 다음과 같습니다.

```sql
CREATE TABLE NOTICE (
  NOTICE_ID  VARCHAR(20)  NOT NULL COMMENT '공지ID',
  TITLE      VARCHAR(200) NOT NULL COMMENT '제목',
  CONTENT    TEXT                  COMMENT '내용',
  USE_YN     CHAR(1)               COMMENT '사용여부(Y/N)',
  NOTICE_DT  DATE                  COMMENT '공지일',
  CREATED_AT TIMESTAMP             COMMENT '등록일시',
  PRIMARY KEY (NOTICE_ID)
) COMMENT='공지사항'
```

## 파싱 방식

DDL 은 두 단계로 해석됩니다.

1. **MySQL 문법 파서**: `node-sql-parser` 의 MySQL 문법으로 해석합니다.
2. **보조 파서**: 1단계가 실패하면 정규식 기반의 보조 파서가 해석합니다. `CREATE MEMORY TABLE`(HSQLDB), Oracle 의 `VARCHAR2` 와 `NUMBER`, `COMMENT ON COLUMN` 문장이 들어 있는 DDL 은 이 경로로 처리됩니다.

보조 파서로 처리했을 때에는 결과 메시지에 "DDL 파서 폴백 안내"가 붙습니다. 이 안내에는 MySQL 문법 파서가 실패한 위치와 이유가 들어 있습니다. 보조 파서는 단순한 형태의 DDL 만 해석하므로, 결과가 의도와 다르면 DDL 을 표준 MySQL 문법으로 고쳐서 다시 호출합니다.

두 파서가 모두 실패하면 도구는 파일을 만들지 않고 오류를 돌려줍니다. 오류에는 두 파서의 실패 이유가 들어 있고, 다른 DBMS 의 타입이 보이면 MySQL 타입으로 바꾸는 방법(예: `VARCHAR2` 를 `VARCHAR` 로)을 함께 안내합니다.

## DDL 정리

`normalizeDdl` 인자가 `true`(기본값)이면 파싱하기 전에 DDL 을 정리합니다. 의미를 바꾸지 않는 변환만 수행합니다.

| 변환 | 예 |
|------|-----|
| 이중으로 이스케이프된 줄바꿈과 탭을 실제 문자로 복원 | 문자 그대로의 `\n` 을 줄바꿈으로 |
| SQL 주석 제거 | `-- 설명`, `/* 설명 */` |
| 식별자를 감싼 백틱과 큰따옴표 제거 | `` `title` `` 을 `title` 로 |
| 소문자가 섞인 컬럼 이름을 대문자로 변환 | `boardId` 를 `BOARDID` 로, `title` 을 `TITLE` 로 |
| 데이터 타입을 대문자로 변환 | `varchar(20)` 을 `VARCHAR(20)` 으로 |
| 타입 인자 안의 공백 제거 | `DECIMAL(10, 2)` 를 `DECIMAL(10,2)` 로 |

테이블 이름과 문자열 값(COMMENT 의 내용 등)은 바꾸지 않습니다.

정리한 내용과 다음 경고는 결과 메시지의 "DDL 정규화 결과"에 나옵니다.

- **대소문자가 섞인 식별자**: 밑줄 없이 소문자가 들어간 컬럼 이름에 대한 경고입니다. 컬럼 이름을 `BOARD_ID` 처럼 대문자와 밑줄로 쓰면, Java 필드 이름이 `boardId` 로 올바르게 만들어집니다. `boardId` 처럼 쓰면 단어의 경계를 알 수 없어서 `boardid` 가 됩니다.
- **사전에 없는 데이터 타입**: 아래의 타입 표에 없는 타입에 대한 경고입니다.

## 컬럼 타입

### Java 타입 매핑

| SQL 타입 | Java 타입 |
|----------|-----------|
| `VARCHAR`, `VARCHAR2`, `CHAR`, `TEXT`, `MEDIUMTEXT`, `ENUM`, `SET` | `java.lang.String` |
| `INT`, `INTEGER`, `NUMBER`, `SERIAL` | `java.lang.Integer` |
| `BIGINT`, `BIGSERIAL` | `java.lang.Long` |
| `SMALLINT`, `SMALLSERIAL` | `java.lang.Short` |
| `TINYINT` | `java.lang.Byte` |
| `DECIMAL`, `NUMERIC` | `java.math.BigDecimal` |
| `FLOAT` | `java.lang.Float` |
| `REAL`, `DOUBLE` | `java.lang.Double` |
| `DATE` | `java.sql.Date` |
| `TIME` | `java.sql.Time` |
| `DATETIME` | `java.util.Date` |
| `TIMESTAMP` | `java.sql.Timestamp` |
| `BOOLEAN`, `BIT` | `java.lang.Boolean` |

표에 없는 타입(`LONGTEXT`, `CLOB`, `NVARCHAR`, `BLOB`, `JSON` 등)은 거부하지 않고 `java.lang.Object` 로 매핑합니다. 이 경우 생성된 화면과 SQL 이 의도대로 동작하지 않을 수 있으므로, 표에 있는 타입으로 바꾸어 쓰는 것을 권장합니다. 긴 문자열에는 `TEXT` 를 사용합니다.

### 화면에 영향을 주는 타입

| 조건 | 화면에서의 처리 |
|------|-----------------|
| `DATE`, `TIME`, `DATETIME`, `TIMESTAMP` | 달력 선택기(flatpickr)가 붙은 입력란이 됩니다. 값은 `yyyy-MM-dd` 형식으로 표시하고 입력받습니다. 시각을 입력받는 화면은 생성되지 않습니다. |
| `TEXT` 계열이거나 길이가 500 이상인 `VARCHAR` | 여러 줄 입력란(textarea)이 됩니다. |
| 길이가 1인 `CHAR` 이고 컬럼 이름이 `_YN` 으로 끝남 | 예/아니오 선택 항목이 됩니다. |
| `NOT NULL` 인 문자열 컬럼 (기본 키 제외) | 필수 입력 항목이 되어 검증 규칙과 필수 표시가 붙습니다. |
| 기본 키가 아니고 예/아니오 항목이 아닌 문자열 컬럼 | 목록 화면의 검색 조건으로 고를 수 있습니다. |

### 다른 DBMS 용 SQL 의 타입

운영 DB 용 마이그레이션 SQL 을 만들 때에는 입력한 타입을 DBMS 별 타입으로 바꿉니다. 예를 들어 `VARCHAR(200)` 과 `TEXT` 는 Oracle 용 SQL 에서 `VARCHAR2(200)` 과 `CLOB` 이 되고, 내장 HSQLDB 용 시드에서는 `TEXT` 가 `LONGVARCHAR` 가 됩니다. Tibero, Altibase, Goldilocks 는 Oracle 과 같은 매핑을 사용합니다. 매핑의 정의는 `src/utils/scaffold/dialectTypes.ts` 에 있습니다.

## 제약 조건

| 구문 | 지원 내용 |
|------|-----------|
| 기본 키 | 컬럼에 붙인 `PRIMARY KEY` 와 별도의 `PRIMARY KEY (...)` 절을 모두 인식합니다. |
| 복합 기본 키 | SQL 과 Mapper 의 조건절에는 모든 기본 키 컬럼이 반영됩니다. 자동 채번과 목록 화면에서 상세 화면으로 이동하는 기능은 첫 번째 기본 키 컬럼만 사용하므로, 복합 기본 키 테이블의 화면은 생성한 뒤에 직접 고쳐야 합니다. |
| 외래키 | 컬럼에 붙인 `REFERENCES` 와 `FOREIGN KEY (...) REFERENCES ...` 절을 인식합니다. 컬럼 하나짜리 외래키만 지원합니다. 화면에서의 처리는 [egov_add_entity](./EGOV_ADD_ENTITY_TOOL.md)의 "외래키" 절에 있습니다. |
| `NOT NULL` | 인식합니다. 문자열 컬럼이면 필수 입력 항목이 됩니다. |
| `DEFAULT` | 문자열, 숫자, `NULL`, 함수 이름을 인식해서 생성되는 SQL 에 유지합니다. |

## COMMENT 와 화면 라벨

컬럼의 COMMENT 는 목록 화면의 머리글, 등록 화면의 항목 이름, 필수 입력 안내문에 쓰입니다. 테이블의 COMMENT 는 화면의 제목과 메뉴 이름에 쓰입니다. COMMENT 가 없으면 컬럼 이름과 엔티티 이름으로 만든 영문 라벨이 보입니다.

### 인식하는 구문

| 구문 | 예 | 비고 |
|------|-----|------|
| 컬럼 정의 안의 COMMENT | `TITLE VARCHAR(200) COMMENT '제목'` | |
| 테이블 옵션의 COMMENT | `) COMMENT='공지사항'` | |
| 별도의 COMMENT 문장 | `COMMENT ON COLUMN NOTICE.TITLE IS '제목';` `COMMENT ON TABLE NOTICE IS '공지사항';` | 보조 파서로 처리됩니다. `CREATE TABLE` 문 뒤에 이어서 적습니다. |

### 라벨로 쓰는 조건

COMMENT 에는 화면 라벨로 쓰기 어려운 설명문이 들어 있는 경우가 많습니다. 그래서 다음 규칙을 순서대로 적용하고, 규칙에 걸리면 COMMENT 를 쓰지 않습니다.

1. 괄호 밖에 구분 문자(`,`, `/`, `;`, `:`)가 있으면 쓰지 않습니다. 여러 값을 나열하거나 설명하는 문장으로 봅니다.
2. 여는 괄호(`(` 또는 전각 `（`)가 있으면 괄호 앞부분만 사용합니다. 괄호 앞에 글자가 없으면 쓰지 않습니다.
3. 남은 값이 10자를 넘으면 쓰지 않습니다. 설명문으로 봅니다.
4. 남은 값이 비어 있으면 쓰지 않습니다.

| COMMENT | 화면 라벨 | 적용된 규칙 |
|---------|-----------|-------------|
| `제목` | 제목 | 그대로 사용 |
| `사용여부(Y/N)` | 사용여부 | 괄호 앞부분만 사용 |
| `구분코드(01:일반, 02:긴급)` | 구분코드 | 괄호 안의 구분 문자는 영향을 주지 않음 |
| `상태: 접수/처리/완료` | 컬럼 이름 | 괄호 밖에 구분 문자가 있음 |
| `본문 내용을 저장하는 긴 설명 컬럼` | 컬럼 이름 | 10자를 넘음 |
| `(예비)` | 컬럼 이름 | 괄호 앞에 글자가 없음 |

COMMENT 를 쓰지 않을 때의 라벨은 다음 순서로 정해집니다.

- 컬럼: 외래키가 참조하는 엔티티를 찾았으면 그 엔티티의 이름, 그렇지 않으면 컬럼 이름을 PascalCase 로 바꾼 값(예: `NTT_SJ` 는 `NttSj`)
- 테이블: `entityName` 인자의 값

`egov_add_entity` 의 결과 메시지는 라벨로 반영한 컬럼의 수와, 규칙에 걸려서 반영하지 않은 COMMENT 를 알려 줍니다.

### 라벨이 기록되는 위치

라벨은 화면 파일이 아니라 메시지 번들(`src/main/resources/egovframework/message/message-common*.properties`)에 기록됩니다. 생성한 뒤에 라벨을 바꾸려면 메시지 번들의 값을 고칩니다.

| 메시지 키 | 값 |
|-----------|-----|
| `title.<엔티티>.<컬럼>` | 컬럼의 라벨 |
| `confirm.required.<엔티티>.<컬럼>` | "<라벨>은(는) 필수 입력값입니다." 기본 키가 아닌 문자열 컬럼마다 생성됩니다. |
| `nav.<엔티티>` | 테이블의 라벨 (메뉴 이름) |
| `list.<엔티티>` | "<테이블의 라벨> 목록" (목록 화면의 제목). 테이블의 COMMENT 를 쓰지 않을 때에는 Boot 가 `List <엔티티 이름>`, WAR 가 `<엔티티 이름> List` 입니다. |
| `title.<엔티티>.sample` (Boot) | "<테이블의 라벨> 목록" (화면 제목) |
| `title.<엔티티>` (WAR) | 테이블의 라벨 (화면 제목) |

기본 번들과 한국어 번들(`_ko`)에만 반영하며, 영어 번들(`_en`)에는 컬럼 이름과 엔티티 이름이 들어갑니다.

4.3 WAR 프로젝트에서는 한글 라벨을 `\uXXXX` 형태로 기록합니다. WAR 의 메시지 소스가 번들을 ISO-8859-1 로 읽기 때문입니다. 따라서 WAR 프로젝트의 번들을 직접 고칠 때에도 한글을 같은 형태로 적어야 합니다.
