# egov_scaffold_project

`CREATE TABLE` 문 하나를 받아서 표준프레임워크 프로젝트 전체를 새로 생성합니다. 생성된 프로젝트에는 첫 엔티티의 CRUD 화면이 들어 있고, 내장 HSQLDB 로 바로 실행할 수 있습니다.

- 구현: `src/tools/egovScaffoldProject.ts`, `src/utils/scaffold/scaffoldGenerator.ts`
- 대상 스택: 5.1 Boot, 4.3 Boot, 4.3 WAR

## 인자

| 인자 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `projectName` | string | 필수 | 프로젝트 폴더의 이름이자 Maven `artifactId` 입니다. 소문자로 시작하고 소문자, 숫자, `-` 만 씁니다. 예: `board-app` |
| `packageName` | string | 필수 | 첫 엔티티의 Java 패키지입니다. 마지막 마디가 모듈 이름, 나머지가 프로젝트의 기본 패키지(`groupId`)가 됩니다. 예: `egovframework.example.board` |
| `outputPath` | string | 필수 | 프로젝트 폴더를 만들 상위 디렉터리입니다. 프로젝트는 `<outputPath>/<projectName>` 에 생성됩니다. |
| `entityName` | string | 필수 | 첫 엔티티의 이름입니다. 대문자로 시작하는 영문과 숫자로 씁니다. 예: `Board` |
| `ddl` | string | 필수 | 첫 엔티티의 `CREATE TABLE` 문입니다. 컬럼과 테이블의 COMMENT 는 화면 라벨로 쓰입니다. [DDL 입력 규칙](./DDL_INPUT.md) 참조 |
| `projectType` | `boot` \| `war` | 선택 | `boot` 는 Spring Boot 실행 JAR, `war` 는 JSP 와 Tomcat 을 쓰는 WAR 입니다. 사용자가 밝히지 않았으면 생략합니다. |
| `stackVersion` | `5.1` \| `4.3` | 선택 | 표준프레임워크 버전입니다. 사용자가 밝히지 않았으면 생략합니다. `5.0` 은 받지 않습니다. |
| `withAttachment` | boolean | 선택 | `true` 이면 첫 엔티티에 첨부파일을 연결하고 첨부파일 인프라를 함께 설치합니다. 사용자가 밝히지 않았으면 생략합니다. Boot 에서만 지원합니다. |
| `normalizeDdl` | boolean | 선택 | DDL 의 대소문자, 공백, 따옴표를 정리하고 정리한 내용을 결과에 첨부합니다. 기본값은 `true` 입니다. |
| `description` | string | 선택 | 프로젝트의 한 줄 설명입니다. 생략하면 `eGovFrame <버전> <엔티티> Project` 로 채웁니다. |

### 생략한 인자의 처리

`projectType`, `stackVersion`, `withAttachment` 는 사용자가 정해야 하는 값이므로, AI 가 임의로 채우지 않고 생략하도록 도구 설명에 적혀 있습니다. 생략된 값은 서버가 사용자에게 직접 묻습니다.

| 호출 형태 | 서버의 동작 |
|-----------|-------------|
| `projectType='war'` | 질문하지 않습니다. `stackVersion` 은 `4.3`, `withAttachment` 는 `false` 로 정합니다. |
| `stackVersion` 과 `withAttachment` 를 모두 지정 | 질문하지 않습니다. `projectType` 을 생략했으면 `boot` 로 봅니다. |
| `projectType` 과 `stackVersion` 을 생략 | 5.1 Boot, 4.3 Boot, 4.3 WAR 가운데 하나를 고르게 합니다. Boot 를 골랐고 `withAttachment` 도 생략했으면 첨부파일 포함 여부를 이어서 묻습니다. WAR 를 고르면 첨부파일 질문 없이 생성합니다. |
| `projectType='boot'` 이고 나머지를 생략 | 버전과 첨부파일 포함 여부를 하나의 질문 화면에서 함께 묻습니다. |
| `stackVersion` 만 지정 | 첨부파일 포함 여부만 묻습니다. |
| `withAttachment=true` 이고 `projectType` 을 생략 | Boot 로 보고, 버전 선택지에 WAR 를 넣지 않습니다. |

클라이언트가 Elicitation 을 지원하지 않거나 사용자가 60초 안에 답하지 않으면, 서버는 파일을 만들지 않고 다음과 같은 오류를 돌려줍니다. AI 는 이 안내에 따라 사용자에게 묻고 인자를 채워서 다시 호출합니다.

```text
[조치 후 재시도 가능] 프로젝트 유형과 표준프레임워크 버전과 첨부파일 포함 여부를 사용자에게 확인하지 못해 아무 파일도 생성하지 않았습니다. 사용자에게 표준프레임워크 5.1 Boot, 4.3 Boot, 4.3 WAR 중 어느 것인지 물은 뒤 projectType 을 'boot' 또는 'war' 로, stackVersion 을 '4.3' 또는 '5.1' 로 지정하고, 첨부파일 기능을 포함할지 물은 뒤 withAttachment 를 true 또는 false 로 지정해 나머지 인자는 그대로 다시 호출하세요.
```

사용자의 응답별 처리는 [사용자 확인 흐름](../architecture/USER_CONFIRMATION.md)에 있습니다.

### 거부되는 조합

| 입력 | 결과 |
|------|------|
| `projectType='war'` 와 `stackVersion='5.1'` | 거부합니다. WAR 는 4.3 만 지원합니다. |
| `projectType='war'` 와 `withAttachment=true` | 거부합니다. 첨부파일은 Boot 에서만 지원합니다. |
| `stackVersion='5.0'` | 거부합니다. `5.1` 을 사용합니다. |
| `outputPath` 아래에 `projectName` 과 같은 이름의 비어 있지 않은 폴더가 있음 | 아무 파일도 쓰지 않고 거부합니다. 기존 프로젝트에 기능을 더하려면 `egov_add_entity` 등을 사용합니다. |

## 생성되는 내용

| 구분 | 내용 |
|------|------|
| 빌드 설정 | 표준프레임워크의 공식 부모 POM 을 상속하는 `pom.xml` |
| 공통 설정 | 데이터소스, MyBatis, 트랜잭션, 예외 처리, 메시지, 유효성 검증, 페이지네이션 설정 |
| 첫 엔티티 | Controller, Service, ServiceImpl, Mapper, VO, MyBatis SQL, 목록 화면과 등록(수정) 화면 |
| ID 채번 | `EgovTableIdGnrServiceImpl` 설정과 채번 테이블(`IDS`) |
| 데이터베이스 | 내장 HSQLDB 용 시드 SQL 과 7개 DBMS 용 마이그레이션 SQL |
| 화면 자산 | KRDS(대한민국 정부 디자인 시스템) CSS, 스크립트, 아이콘, 글꼴 |
| 메시지 번들 | 기본, 한국어, 영어의 3개 파일 |
| 보안 설정 | 5.1 Boot 에 한해 Spring Security 설정 ([5.1 Boot 보안 설정](../architecture/SECURITY_CONFIG.md)) |

스택별 파일 수는 5.1 Boot 가 48개, 4.3 Boot 가 45개, 4.3 WAR 가 49개이며, 여기에 KRDS 정적 자산 588개가 더해집니다. 파일의 구성과 실행 방법은 [생성되는 프로젝트](./GENERATED_PROJECT.md)에 있습니다.

`withAttachment=true` 이면 프로젝트를 생성한 직후에 첨부파일 인프라를 기본 옵션으로 설치합니다. 인프라 설치가 실패해도 생성된 프로젝트는 지우지 않으며, 원인을 해결한 뒤 `egov_add_attach_file_infrastructure` 를 호출해서 복구하라는 안내를 돌려줍니다. 이 경우 첫 엔티티가 인프라 클래스를 참조하므로, 복구하기 전에는 프로젝트가 컴파일되지 않습니다.

## 결과 메시지

성공하면 다음 내용을 담은 텍스트를 돌려줍니다.

- 프로젝트 경로, 프레임워크 버전, 엔티티와 테이블 이름, 생성한 파일의 목록
- 빌드와 실행 방법 (Boot 는 `mvn spring-boot:run`, WAR 는 Tomcat 배포)
- 5.1 Boot 일 때 CSRF 보호가 켜져 있다는 안내
- `withAttachment=true` 일 때 첨부파일 인프라의 설치 요약
- DDL 을 정리했거나 표준 MySQL 문법이 아니어서 보조 파서로 처리했을 때 그 내용
- 생성한 파일의 자체 검증 결과

## 호출 예

사용자의 요청:

```text
다음 DDL 로 표준프레임워크 5.1 Boot 게시판 프로젝트를 /workspace 에 만들어 줘. 첨부파일은 필요 없어.

CREATE TABLE BOARD (
  BOARD_ID   VARCHAR(20)  NOT NULL COMMENT '게시글ID',
  TITLE      VARCHAR(200) NOT NULL COMMENT '제목',
  CONTENT    TEXT                  COMMENT '내용',
  WRITER     VARCHAR(50)           COMMENT '작성자',
  CREATED_AT TIMESTAMP             COMMENT '등록일시',
  PRIMARY KEY (BOARD_ID)
) COMMENT='게시판'
```

AI 가 구성하는 도구 입력:

```json
{
  "projectName": "board-app",
  "packageName": "egovframework.example.board",
  "outputPath": "/workspace",
  "entityName": "Board",
  "ddl": "CREATE TABLE BOARD ( ... ) COMMENT='게시판'",
  "projectType": "boot",
  "stackVersion": "5.1",
  "withAttachment": false
}
```

사용자가 버전이나 첨부파일 포함 여부를 말하지 않았다면 AI 는 해당 인자를 생략하고, 서버가 사용자에게 묻습니다.

## 주의할 점

- 기본 키 컬럼은 자동 채번된 값(`<테이블 이름>-00001` 형식)을 담을 수 있는 길이여야 합니다. 테이블 이름이 `BOARD` 이면 11자 이상이 필요합니다. 이 도구는 길이를 검사하지 않으므로, 길이가 모자라도 생성은 성공하고 등록할 때 채번된 값이 컬럼 길이를 넘게 됩니다. `egov_add_entity` 는 같은 조건을 미리 검사해서 거부합니다.
- 이 도구에는 `idGeneration` 인자가 없으며 첫 엔티티는 항상 자동 채번을 사용합니다. 사용자가 기본 키를 직접 입력하는 코드 테이블은 `egov_add_entity` 로 추가합니다.
- 첫 엔티티의 외래키 컬럼은 일반 입력란으로 생성됩니다. 참조할 엔티티가 아직 프로젝트에 없기 때문입니다.
