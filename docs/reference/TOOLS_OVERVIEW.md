# 도구 레퍼런스 개요

`egovframe-mcp-codegen` 서버는 4개의 도구를 제공합니다. 이 문서는 도구를 고르는 기준과 네 도구에 공통으로 적용되는 동작을 설명합니다. 도구별 인자와 세부 동작은 각 도구의 문서에 있습니다.

## 도구 목록

| 도구 | 용도 | 대상 스택 | 문서 |
|------|------|-----------|------|
| `egov_scaffold_project` | DDL 하나로 프로젝트 전체를 새로 생성 | 5.1 Boot, 4.3 Boot, 4.3 WAR | [EGOV_SCAFFOLD_PROJECT_TOOL.md](./EGOV_SCAFFOLD_PROJECT_TOOL.md) |
| `egov_add_entity` | 기존 프로젝트에 새 엔티티의 CRUD 코드를 추가 | 5.1 Boot, 4.3 Boot, 4.3 WAR | [EGOV_ADD_ENTITY_TOOL.md](./EGOV_ADD_ENTITY_TOOL.md) |
| `egov_add_query_view` | `SELECT` 문으로 조회 전용 화면을 추가 | 5.1 Boot, 4.3 Boot, 4.3 WAR | [EGOV_ADD_QUERY_VIEW_TOOL.md](./EGOV_ADD_QUERY_VIEW_TOOL.md) |
| `egov_add_attach_file_infrastructure` | 표준 첨부파일 인프라를 설치 | 5.1 Boot, 4.3 Boot | [EGOV_ADD_ATTACH_FILE_INFRASTRUCTURE_TOOL.md](./EGOV_ADD_ATTACH_FILE_INFRASTRUCTURE_TOOL.md) |

생성된 프로젝트의 구조와 실행 방법은 [생성되는 프로젝트](./GENERATED_PROJECT.md)에 있습니다.

## 지원 스택

| 스택 | `projectType` | `stackVersion` | 실행환경 | Java | 기반 | 화면 |
|------|---------------|----------------|----------|------|------|------|
| 5.1 Boot | `boot` | `5.1` | 5.1.0 | 17 | Spring Boot 3.5 | Thymeleaf |
| 4.3 Boot | `boot` | `4.3` | 4.3.2 | 8 | Spring Boot 2.7 | Thymeleaf |
| 4.3 WAR | `war` | `4.3` | 4.3.2 | 8 | Spring 5.3 | JSP, Tomcat 에 배포 |

WAR 와 5.1 의 조합은 지원하지 않습니다. 스택의 정의는 `templates/stacks.json` 에 있습니다.

`egov_scaffold_project` 를 제외한 세 도구는 스택을 인자로 받지 않고, 대상 프로젝트의 `pom.xml` 에서 감지합니다.

| 판정 순서 | `pom.xml` 의 근거 | 감지 결과 |
|-----------|-------------------|-----------|
| 1 | `<packaging>war</packaging>` | 4.3 WAR |
| 2 | 부모의 `artifactId` 가 `egovframe-boot-starter-parent` | 5.1 Boot |
| 3 | 부모의 `artifactId` 가 `org.egovframe.boot.starter.parent` | 4.3 Boot |
| 4 | 부모가 `spring-boot-starter-parent` 이고 `pom.xml` 에 `org.egovframe.rte` 가 있음 | 4.3 Boot |

어느 조건에도 해당하지 않으면 도구는 표준 eGovFrame 프로젝트가 아니라는 오류로 거부합니다.

## 일반적인 사용 순서

```text
egov_scaffold_project              프로젝트와 첫 엔티티를 생성
  └ egov_add_entity                엔티티를 추가 (필요한 만큼 반복)
  └ egov_add_query_view            여러 테이블을 JOIN 하는 조회 화면을 추가
  └ egov_add_attach_file_infrastructure
                                   첨부파일 정책을 기본값과 다르게 설치할 때만 호출
```

- 다른 엔티티를 참조하는 엔티티(외래키가 있는 테이블)는 참조되는 엔티티를 먼저 생성한 뒤에 추가합니다. 그래야 등록 화면의 콤보 상자와 목록 화면의 JOIN 이 생성됩니다.
- 첨부파일이 필요한 엔티티는 `egov_scaffold_project` 나 `egov_add_entity` 에 `withAttachment=true` 를 지정합니다. 인프라가 없으면 기본 옵션으로 함께 설치되므로, `egov_add_attach_file_infrastructure` 를 먼저 호출할 필요가 없습니다.

## 공통 동작

### 입력 검증

모든 도구는 입력을 두 번 검증합니다. 먼저 MCP SDK 가 `tools/list` 로 공개한 스키마로 타입을 검사하고, 그다음 도구 모듈(`src/tools/`)이 형식과 조합의 규칙을 다시 검사합니다. 두 번째 검증에서 걸리면 다음과 같은 형식의 오류를 돌려줍니다.

```text
[재시도 불가 — 입력을 수정해야 합니다] 입력 검증 실패:
  - stackVersion: projectType='war' 는 stackVersion='4.3' 만 지원합니다. WAR + 5.1 조합은 허용되지 않습니다. 같은 인자로 재호출하면 동일하게 실패합니다.
```

이름에 적용되는 형식 규칙은 네 도구에서 같습니다.

| 인자 | 규칙 | 허용되는 예 | 거부되는 예 |
|------|------|-------------|-------------|
| `projectName` | 소문자로 시작하고 소문자, 숫자, `-` 만 사용 | `board-app` | `MyApp`, `my_app`, `1app` |
| `packageName` | 점으로 구분한 Java 패키지 이름이며 두 마디 이상 | `egovframework.example.board` | `board`, `egov..board`, `egov-frame.board` |
| `entityName`, `viewName` | 대문자로 시작하는 영문과 숫자(PascalCase) | `Board`, `Article2` | `board`, `Board_Item`, 한글 이름 |

`packageName` 의 마지막 마디는 모듈 이름이 되어 SQL 매퍼와 화면의 디렉터리 이름에 쓰이고, 나머지는 프로젝트의 기본 패키지가 됩니다. 예를 들어 `egovframework.example.board` 에서 기본 패키지는 `egovframework.example`, 모듈은 `board` 입니다.

### 결과와 오류의 형태

도구의 결과는 JSON 이 아니라 여러 줄의 텍스트입니다. 성공하면 생성한 파일의 목록, 다음에 할 일, 자동으로 반영한 내용, 반영하지 못한 내용과 그 이유를 알려 주고, 마지막 줄에 이 요청에 대한 추가 도구 호출이 필요하지 않다는 완료 표식을 붙입니다.

실패하면 같은 텍스트 형태에 `isError: true` 가 붙습니다. 오류 문구에는 AI 가 다음 행동을 정할 수 있도록 다음 두 가지 표식 가운데 하나가 들어갑니다.

| 표식 | 의미 | 예 |
|--------|------|-----|
| `[재시도 불가 — 입력을 수정해야 합니다]` | 같은 인자로 다시 호출하면 똑같이 실패합니다. | 형식에 맞지 않는 이름, 지원하지 않는 스택 조합, 파싱할 수 없는 DDL |
| `[조치 후 재시도 가능]` | 안내된 조치를 한 뒤에 다시 호출하면 됩니다. | 사용자 확인이 필요한 경우, 대상 폴더가 이미 있는 경우, 파일 쓰기 실패 |

표식의 위치는 도구마다 조금 다릅니다. `egov_add_entity` 는 입력 검증 이후의 오류 앞에 `엔티티 추가 실패: ` 를, `egov_scaffold_project` 는 재시도할 수 없는 오류 앞에 `프로젝트 생성 실패: ` 를 붙이므로, 표식이 문구의 맨 앞이 아니라 그 뒤에 올 수 있습니다. 대상 경로가 없거나 `pom.xml` 이 없는 경우처럼 프로젝트를 감지하지 못했을 때의 오류에는 표식이 없습니다.

스택 트레이스는 결과에 넣지 않고 서버의 표준 오류 로그에만 남깁니다.

### 덮어쓰지 않는 원칙

네 도구에는 강제로 덮어쓰는 옵션이 없습니다.

- `egov_scaffold_project` 는 `outputPath` 아래에 같은 이름의 비어 있지 않은 폴더가 있으면 아무 파일도 쓰지 않고 거부합니다.
- `egov_add_entity` 와 `egov_add_query_view` 는 만들 파일을 먼저 메모리에서 렌더링한 뒤에 기존 파일과 비교합니다. 하나라도 이미 있으면 어떤 파일도 쓰지 않고, 충돌한 파일의 목록을 돌려줍니다.
- 만들 파일이 모두 이미 있고 내용까지 같으면 변경 없이 성공으로 응답합니다. 그래서 같은 인자로 도구를 다시 호출해도 안전합니다.

### 기존 파일을 고치는 경우

새 파일을 만드는 것 외에 기존 파일을 고치는 경우는 다음으로 한정됩니다. 표에 없는 파일(`pom.xml`, 설정 클래스, 다른 엔티티의 코드)은 고치지 않습니다.

| 도구 | 고치는 파일 | 끄는 방법 |
|------|-------------|-----------|
| `egov_add_entity` | 내장 HSQLDB 의 시드 SQL (끝에 덧붙임) | `autoApplyMigration=false` |
| | 메시지 번들 3개 (끝에 덧붙임) | `autoApplyMessages=false` |
| | 메뉴 fragment 와 기존 목록 화면 (`autoApplyMenu=true` 일 때만) | 기본값이 꺼짐 |
| | WAR 의 `validator.xml` (필수 입력 검증 규칙을 삽입) | 끌 수 없음 |
| `egov_add_query_view` | 메뉴 fragment (다시 생성) | `autoApplyMenu=false` |
| | 메시지 번들 3개 (끝에 덧붙임) | `autoApplyMessages=false` |
| `egov_add_attach_file_infrastructure` | `application.properties`, `globals.properties`, 메시지 번들 3개 (끝에 덧붙임) | `autoApplyProperties=false` |
| | 내장 HSQLDB 의 시드 SQL (끝에 덧붙임) | `autoMergeHsqlSeed=false` |

`egov_add_entity` 와 `egov_scaffold_project` 가 `withAttachment=true` 로 첨부파일 인프라를 함께 설치할 때에는 `egov_add_attach_file_infrastructure` 의 행이 그대로 적용됩니다.

### 쓰기 전 검증과 되돌리기

`egov_add_entity`, `egov_add_query_view`, `egov_add_attach_file_infrastructure` 는 파일을 쓰기 전에 렌더링 결과를 검사합니다. 치환되지 않은 템플릿 구문이 남아 있거나 XML 의 태그 짝이 맞지 않으면 아무 파일도 쓰지 않고 거부합니다. 새 파일을 쓰는 도중에 실패하면 이미 쓴 파일을 지우고 고친 파일을 원래 내용으로 되돌립니다. 다만 `egov_add_entity` 와 `egov_add_query_view` 가 그 뒤에 수행하는 시드 SQL, 메시지 번들, 메뉴의 반영은 되돌리기 대상이 아닙니다. `egov_add_attach_file_infrastructure` 는 설정, 메시지 번들, 시드 SQL 에 덧붙인 내용까지 함께 되돌립니다.

`egov_scaffold_project` 는 새 폴더에 프로젝트를 만들기 때문에 되돌리기를 하지 않습니다. 같은 검사를 파일을 쓴 뒤에 수행하고, 문제가 있으면 생성된 폴더가 남아 있다는 사실과 함께 오류를 돌려줍니다.

### 경로 처리

모든 산출물의 경로는 대상 프로젝트 폴더 안에 있는지 확인한 뒤에 씁니다(`src/utils/scaffold/pathGuard.ts`). 이름 인자의 형식 규칙과 이 확인이 함께 적용되므로, 인자를 조작해서 프로젝트 폴더 밖에 파일을 쓰게 할 수 없습니다.

`outputPath` 와 `projectPath` 는 절대 경로로 지정하는 것을 권장합니다. 상대 경로는 서버 프로세스의 작업 디렉터리를 기준으로 해석되는데, 이 디렉터리는 클라이언트마다 다릅니다.

### 사용자 확인

`egov_scaffold_project` 의 `stackVersion` 과 `withAttachment`, `egov_add_entity` 의 `withAttachment` 는 사용자가 정해야 하는 값입니다. 이 인자가 생략되면 서버가 MCP Elicitation 으로 사용자에게 직접 묻고, 클라이언트가 Elicitation 을 지원하지 않으면 파일을 만들지 않은 채 "사용자에게 물은 뒤 다시 호출하라"는 오류를 돌려줍니다. 흐름의 상세한 내용은 [사용자 확인 흐름](../architecture/USER_CONFIRMATION.md)에 있습니다.

### DDL 입력

`egov_scaffold_project` 와 `egov_add_entity` 는 `CREATE TABLE` 문 하나를 받습니다. 지원하는 문법, 타입 매핑, COMMENT 를 화면 라벨로 쓰는 규칙은 [DDL 입력 규칙](./DDL_INPUT.md)에 있습니다.
