# 코드 생성 구조

이 문서는 도구가 호출된 뒤에 서버 안에서 코드가 만들어지는 과정을 설명합니다. 서버를 수정하거나 템플릿을 추가하려는 개발자를 위한 문서입니다.

## 설계 원칙

- **결정적 생성**: AI 는 어느 도구를 어떤 인자로 호출할지만 정합니다. DDL 해석, 템플릿 렌더링, 파일 쓰기는 모두 서버의 코드가 수행하고, 모든 산출물은 `templates/` 의 Handlebars 템플릿에서 만들어집니다. 그래서 같은 입력은 항상 같은 산출물을 만듭니다.
- **덮어쓰지 않음**: 기존 파일을 덮어쓰는 옵션을 두지 않습니다. 내용이 다른 파일이 이미 있으면 아무 파일도 쓰지 않고 거부합니다.
- **데이터로 정의한 스택**: 스택별로 어떤 파일을 어느 템플릿으로 만드는지는 `templates/stacks.json` 과 매니페스트(`templates/manifests/*.json`)에 적습니다. 코드에는 정적 자산의 복사 위치나 결과 메시지처럼 데이터로 옮기기 어려운 분기만 남겼습니다.

## 처리 흐름

```text
MCP 클라이언트
   │  tools/call
   ▼
src/index.ts                  도구 등록, 1차 입력 검증(SDK), 사용자 확인(Elicitation)
   ▼
src/tools/<도구>.ts            2차 입력 검증(zod), 스택 감지, 충돌 검사, 결과 메시지 조립
   ▼
DDL 정리, DDL 파싱             ddlNormalizer.ts, scaffold/ddlParser*.ts
   ▼
렌더링 컨텍스트 구성           scaffold/scaffoldGenerator.ts (buildContext, applyLabels)
   ▼
매니페스트 해석                scaffold/stackMatrix.ts, scaffold/manifestLoader.ts
   ▼
Handlebars 렌더링             templates/<스택>/**/*.hbs
   ▼
출력 검증, 파일 쓰기           scaffold/outputValidator.ts, pathGuard.ts, writeRollback.ts
```

## 모듈 구성

| 파일 | 역할 |
|------|------|
| `src/index.ts` | MCP 서버의 진입점입니다. 도구 4개를 `registerTool` 로 등록하고, 생략된 인자를 사용자에게 묻는 흐름을 연결합니다. |
| `src/tools/egovScaffoldProject.ts` | `egov_scaffold_project` 의 입력 검증과 결과 메시지 |
| `src/tools/egovAddEntity.ts` | `egov_add_entity` 의 전체 흐름 (스택 감지, 외래키 해석, 충돌 검사, 시드와 메시지와 메뉴의 반영) |
| `src/tools/egovAddQueryView.ts` | `egov_add_query_view` 의 전체 흐름 |
| `src/tools/egovAddAttachFileInfrastructure.ts` | `egov_add_attach_file_infrastructure` 의 결과 메시지. 설치 로직은 `attachFileInstaller.ts` 에 있습니다. |
| `src/utils/ddlNormalizer.ts` | DDL 의 대소문자, 공백, 따옴표 정리와 정리 보고서 |
| `src/utils/sqlText.ts` | 따옴표와 괄호를 인식해서 SQL 문자열을 나누는 유틸리티 |
| `src/utils/fsCopyFilter.ts` | 정적 자산을 복사할 때 `.DS_Store`, `Thumbs.db` 를 제외하는 필터 |

`src/utils/scaffold/` 의 모듈은 다음과 같습니다.

| 파일 | 역할 |
|------|------|
| `ddlParser.ts` | 파싱의 진입점. MySQL 문법 파서를 먼저 쓰고, 실패하면 보조 파서로 넘깁니다. |
| `ddlParserAst.ts` | `node-sql-parser`(MySQL 문법)의 결과를 내부 형식으로 변환 |
| `ddlParserLegacy.ts` | 정규식 기반의 보조 파서 |
| `dataTypes.ts` | SQL 타입을 Java 타입으로 매핑 |
| `dialectTypes.ts` | 컬럼 타입을 DBMS 별 타입 문자열로 변환 |
| `messageLabel.ts` | COMMENT 를 화면 라벨로 바꾸는 규칙과 properties 값의 이스케이프 |
| `stackMatrix.ts` | `templates/stacks.json` 을 읽어서 스택 정의를 제공 |
| `manifestLoader.ts` | 매니페스트를 읽어서 템플릿과 출력 경로의 매핑을 만듦 |
| `scaffoldGenerator.ts` | 렌더링 컨텍스트 구성, Handlebars 헬퍼 등록, 프로젝트 전체 생성 |
| `projectDetector.ts` | `pom.xml` 에서 스택을 감지하고, 기본 패키지와 첨부파일 인프라의 유무를 판정 |
| `entityDiscovery.ts` | 프로젝트의 Controller 를 찾아서 엔티티 목록과 외래키의 참조 엔티티를 알아냄 |
| `migrationStrategy.ts` | 새 테이블의 DDL 을 시드 SQL 에 덧붙일지, 별도 파일로 만들지 결정 |
| `attachFileInstaller.ts` | 첨부파일 인프라의 설치 계획과 적용 |
| `attachmentContext.ts` | 엔티티의 첨부파일 연결에 필요한 렌더링 변수 |
| `scaffoldDecision.ts`, `attachmentDecision.ts`, `elicitForm.ts` | 생략된 인자를 사용자에게 묻는 흐름 |
| `outputValidator.ts` | 렌더링 결과의 검증 |
| `pathGuard.ts` | 출력 경로가 프로젝트 폴더 안에 있는지 확인 |
| `writeRollback.ts` | 파일 쓰기의 기록과 되돌리기 |
| `toolMessages.ts` | 오류 문구의 머리말과 결과의 완료 표식 |

## 입력 검증

도구의 입력은 두 번 검증합니다.

1. `src/index.ts` 의 `inputSchema` 는 zod 의 필드 정의를 그대로 나열한 형태입니다. MCP SDK 가 이것으로 `tools/list` 의 JSON Schema 를 만들고, 호출이 들어오면 타입을 검사합니다. 필드의 `.describe()` 문구는 AI 가 인자를 채울 때 읽는 설명입니다.
2. `src/tools/<도구>.ts` 의 스키마가 형식(정규식)과 조합의 규칙(`refine`, `superRefine`)을 다시 검사합니다.

두 스키마의 필드가 어긋나지 않는지는 `tests/toolRegistration.test.ts` 가 검사합니다. 필드를 추가하거나 바꿀 때에는 두 곳을 함께 고칩니다.

`withAttachment` 와 `stackVersion` 은 1단계에서 기본값을 두지 않습니다. "값이 없음"과 `false` 를 구분해야 사용자에게 물을지 판단할 수 있기 때문입니다.

## DDL 처리

### 정리

`normalizeDdl`(`ddlNormalizer.ts`)은 파싱하기 전에 DDL 을 정리합니다. 수행하는 변환은 [DDL 입력 규칙](../reference/DDL_INPUT.md)의 "DDL 정리"에 있습니다. 정리한 내용과 경고는 보고서로 만들어져서 도구의 결과 메시지에 붙습니다.

### 파싱

`parseDDL`(`ddlParser.ts`)은 먼저 `node-sql-parser` 의 MySQL 문법으로 해석합니다. 이 경로가 예외를 던지거나 컬럼을 하나도 얻지 못하면 정규식 기반의 보조 파서로 넘어갑니다. 어느 파서를 썼는지는 결과의 `parserUsed` 에 기록되고, 보조 파서를 썼을 때에는 MySQL 문법 파서가 실패한 이유를 `warnings` 에 담아서 결과 메시지로 알립니다. 두 파서를 차례로 시도하는 부분은 같은 파일의 `parseDDLWithDiagnostics` 에 있습니다.

두 파서는 같은 형식의 결과를 돌려줍니다. 결과에는 테이블 이름, 테이블의 COMMENT, 컬럼의 목록이 들어 있고, 컬럼마다 이름, 타입, 길이, 기본 키 여부, `NOT NULL` 여부, 기본값, 외래키, COMMENT 가 들어 있습니다. COMMENT 는 앞뒤 공백만 제거한 원문으로 보관하며, 화면 라벨로 바꾸는 규칙은 다음 단계에서 적용합니다.

### 타입

`dataTypes.ts` 는 SQL 타입을 Java 타입으로 매핑하고, 사전에 없는 타입은 `java.lang.Object` 로 매핑합니다. `dialectTypes.ts` 는 Java 타입과 관계없이, 생성하는 SQL 에 쓸 DBMS 별 타입 문자열을 만듭니다. 대상은 `oracle`, `tibero`, `altibase`, `goldilocks`, `cubrid`, `mysql`, `postgres` 와 내장 DB 시드용 `hsql` 입니다.

## 렌더링 컨텍스트

`buildContext`(`scaffoldGenerator.ts`)는 파싱 결과와 도구의 인자로 템플릿에 넘길 값을 만듭니다. 주요 값은 다음과 같습니다.

| 값 | 내용 | 예 |
|----|------|-----|
| `packageName`, `packagePath` | 엔티티의 패키지와 그 경로 | `egovframework.example.board`, `egovframework/example/board` |
| `basePackage`, `basePackagePath` | 패키지에서 마지막 마디를 뺀 기본 패키지 | `egovframework.example` |
| `entityModule` | 패키지의 마지막 마디 | `board` |
| `entityName`, `entityNameLower` | 엔티티 이름과 첫 글자를 소문자로 바꾼 이름 | `Board`, `board` |
| `tableName` | 대문자로 바꾼 테이블 이름 | `BOARD` |
| `attributes`, `pkAttributes`, `nonPkAttributes` | 컬럼의 목록 | |
| `searchableAttributes`, `requiredStringAttributes` | 검색 조건과 필수 입력 검증의 대상 컬럼 | |
| `fkAttributes`, `resolvedFks` | 외래키 컬럼과, 참조 엔티티를 찾은 외래키 컬럼 | |
| `entityLabel`, 컬럼별 `label` | 화면 라벨 | |
| `hasDateAttr`, `hasFk`, `hasCompositePk` | 템플릿의 분기에 쓰는 플래그 | |
| `stack` | `stacks.json` 의 스택 정의 | |

컬럼마다 `columnName`(`BOARD_ID`), `ccName`(`boardId`), `pcName`(`BoardId`), `javaType` 이 들어 있습니다.

`applyLabels` 는 컬럼의 `label` 과 `entityLabel` 을 채웁니다. `buildContext` 안에서 한 번 실행되고, `egov_add_entity` 는 외래키의 참조 엔티티를 찾은 뒤에 한 번 더 실행해서 참조 엔티티의 이름을 라벨에 반영합니다. COMMENT 가 규칙을 통과하면 그 값을, 그렇지 않으면 참조 엔티티의 이름이나 `pcName` 을 씁니다. 규칙은 `messageLabel.ts` 의 `deriveLabelFromComment` 한 곳에 있습니다.

### Handlebars 헬퍼

헬퍼는 `scaffoldGenerator.ts` 에서 등록합니다.

| 헬퍼 | 용도 |
|------|------|
| `eq`, `empty` | 조건 비교 |
| `concat`, `lowercase`, `uppercase`, `add` | 문자열과 숫자의 가공 |
| `simpleJavaType` | `java.lang.String` 을 `String` 으로 줄임 |
| `dialectType` | 컬럼을 DBMS 별 타입 문자열로 변환 |
| `joinSqlDisplay` | 외래키의 표시 컬럼을 SQL 표현식으로 변환 |
| `thExpr` | Thymeleaf 의 `${...}` 표현식을 Handlebars 구문과 충돌하지 않게 출력 |
| `msg` | 메시지 번들의 값을 출력. 스택 정의의 `messageUnicodeEscape` 가 참이면 한글을 `\uXXXX` 로 바꿈 |
| `setVar`, `error` | 템플릿 안에서의 변수 지정과 오류 표시. 현재 템플릿에서는 쓰지 않습니다. |

## 스택 정의와 매니페스트

### stacks.json

`templates/stacks.json` 은 스택마다 다음을 정의합니다. `selection` 배열이 `projectType` 과 `stackVersion` 의 조합을 스택 키(`boot50`, `boot43`, `war43`)에 연결하며, 여기에 없는 조합은 지원하지 않는 조합으로 거부됩니다.

| 필드 | 내용 |
|------|------|
| `egovframe`, `springBoot`, `spring`, `java`, `jakarta` | 스택의 버전 정보 |
| `starterParentGroupId`, `starterParentArtifactId`, `starterParentVersion` | 생성되는 `pom.xml` 의 부모 POM |
| `staticAssets` | 복사할 정적 자산 디렉터리. 세 스택 모두 `static50` 입니다. |
| `manifest` | 프로젝트 생성에 쓰는 매니페스트 |
| `rteVersion`, `frameworkLabel` | 실행환경 라이브러리의 버전과 결과 메시지에 표시할 이름 |
| `addEntityMigration`, `addEntityMessages` | `egov_add_entity` 가 기존 파일에 덧붙일 조각의 템플릿 |
| `addEntityValidator` | `egov_add_entity` 가 `validator.xml` 에 삽입할 조각의 템플릿. `war43` 에만 있습니다. |
| `navFragment` | 메뉴 fragment 의 템플릿과 출력 경로 |
| `queryView` | `egov_add_query_view` 가 만들 파일의 목록 |
| `messageUnicodeEscape` | 메시지 번들의 한글을 `\uXXXX` 로 기록할지 여부. `war43` 에만 있습니다. |

### 매니페스트

매니페스트는 템플릿과 출력 경로의 목록입니다.

```json
{ "template": "boot50/java/entity/EntityVO.hbs",
  "output": "src/main/java/{{packagePath}}/service/{{entityName}}VO.java",
  "scope": "entity" }
```

| 필드 | 의미 |
|------|------|
| `template` | `templates/` 를 기준으로 한 템플릿 경로 |
| `output` | 프로젝트 폴더를 기준으로 한 출력 경로. 렌더링 컨텍스트의 값으로 치환됩니다. |
| `scope` | `framework`(기본값)는 프로젝트에 한 번만 만드는 파일, `entity` 는 엔티티마다 만드는 파일입니다. |
| `expandDialects` | `true` 이면 항목 하나가 7개 DBMS(`oracle`, `tibero`, `altibase`, `cubrid`, `goldilocks`, `mysql`, `postgres`)의 파일로 늘어나고, 템플릿에 `dialect` 값이 전달됩니다. |
| `mode` | `create`(기본값)는 새 파일 생성, `append-idempotent` 는 기존 파일의 끝에 덧붙이기입니다. 덧붙이기는 첨부파일 인프라의 매니페스트에서만 사용합니다. `append-fallback` 과 `appendTarget` 필드도 정의되어 있지만 현재 어느 매니페스트도 사용하지 않습니다. |

`egov_scaffold_project` 는 매니페스트의 모든 항목을 렌더링하고, `egov_add_entity` 는 `scope` 가 `entity` 인 항목만 렌더링합니다.

| 매니페스트 | 전체 항목 | `framework` | `entity` |
|------------|-----------|-------------|----------|
| `manifests/boot50.json` (5.1 Boot) | 42 | 31 | 11 |
| `manifests/boot43.json` (4.3 Boot) | 39 | 28 | 11 |
| `manifests/war43.json` (4.3 WAR) | 41 | 30 | 11 |
| `attach-file/manifests/boot.json` (첨부파일 인프라) | 20 | 20 | 0 |

### 템플릿 디렉터리

```text
templates/
├── stacks.json              스택 정의
├── manifests/               스택별 매니페스트
├── boot50/                  5.1 Boot 템플릿
├── boot/                    4.3 Boot 템플릿
├── war/                     4.3 WAR 템플릿
│   └── static-files/        렌더링하지 않고 복사하는 WAR 전용 파일
├── static50/                KRDS 정적 자산 (세 스택 공용, 렌더링하지 않고 복사)
└── attach-file/             첨부파일 인프라의 매니페스트와 템플릿 (두 Boot 스택 공용)
```

템플릿 디렉터리의 위치는 `build/index.js` 가 놓인 패키지를 기준으로 찾으며, 환경 변수 `EGOVFRAME_SCAFFOLD_TEMPLATE_PATH` 와 `EGOVFRAME_STACK_MATRIX_PATH` 로 바꿀 수 있습니다.

## 출력 검증과 쓰기

### 검증

`outputValidator.ts` 는 렌더링 결과에 대해 두 가지를 검사합니다.

- 치환되지 않은 Handlebars 구문(`{{이름}}`, `{{#...}}`, `{{/...}}` 등)이 남아 있는지 검사합니다.
- `.xml` 파일에서 여는 태그와 닫는 태그의 짝이 맞는지 검사합니다.

`egov_add_entity`, `egov_add_query_view`, `egov_add_attach_file_infrastructure` 는 파일을 쓰기 전에 검사하고, 문제가 있으면 아무 파일도 쓰지 않습니다. `egov_scaffold_project` 는 새 폴더에 쓴 뒤에 검사하며, 문제가 있어도 이미 쓴 파일을 지우지 않고 그 사실을 오류에 알립니다. 정적 자산은 렌더링하지 않으므로 검사 대상이 아닙니다.

`egov_scaffold_project` 는 매니페스트가 가리키는 템플릿 파일이 없을 때에도 다른 도구와 다르게 동작합니다. 오류를 내지 않고 서버 로그에만 기록한 뒤 그 항목을 건너뜁니다. `egov_add_entity` 는 같은 상황에서 오류로 거부합니다. 매니페스트를 고칠 때에는 템플릿의 경로가 맞는지 골든 테스트의 파일 수로 확인합니다.

### 경로 확인

`assertInsideProject`(`pathGuard.ts`)는 출력 경로를 절대 경로로 바꾼 뒤, 프로젝트 폴더와 같거나 그 아래에 있는지 확인합니다. 매니페스트의 출력 경로는 사용자 입력(패키지 이름, 엔티티 이름)으로 치환되므로, 매니페스트에서 나온 파일을 쓰기 직전에 모두 이 확인을 거칩니다. 시드 SQL, 메시지 번들, 메뉴, `validator.xml` 의 수정과 정적 자산의 복사는 경로가 고정되어 있거나 프로젝트의 디렉터리 목록에서 얻은 경로를 사용하므로 이 확인을 거치지 않습니다.

### 되돌리기

`FileWriteJournal`(`writeRollback.ts`)은 파일을 쓰기 직전에 그 파일의 원래 상태를 기록합니다. `withWriteRollback` 으로 감싼 작업이 도중에 실패하면, 기록의 역순으로 새 파일은 지우고 고친 파일은 원래 내용으로 복원한 뒤 `[조치 후 재시도 가능]` 오류를 돌려줍니다. 이 오류의 문구에서는 프로젝트의 절대 경로를 `<projectDir>` 로 바꿉니다.

되돌리기가 적용되는 범위는 새 파일의 생성과 첨부파일 인프라의 설치까지입니다. `egov_add_entity` 가 그 뒤에 수행하는 시드 SQL, 메시지 번들, `validator.xml`, 메뉴의 반영은 기록하지 않습니다.

## 기존 프로젝트의 해석

`egov_add_entity` 등은 기존 프로젝트의 상태를 파일에서 읽어 냅니다. 별도의 메타데이터 파일을 프로젝트에 남기지 않습니다.

| 알아내는 것 | 방법 |
|-------------|------|
| 스택 | `pom.xml` 의 `<packaging>` 과 부모의 `artifactId`. 부모가 `spring-boot-starter-parent` 이고 `org.egovframe.rte` 의존성이 있는 예전 구성도 4.3 Boot 로 봅니다 (`projectDetector.ts`). |
| 기본 패키지 | `src/main/java/**/cmm/vo/FkComboVO.java` 의 패키지 선언 |
| 엔티티 목록 | `web` 디렉터리의 `Egov*Controller.java` (`entityDiscovery.ts`) |
| 외래키의 참조 엔티티 | 테이블 이름에서 만든 후보 이름의 Controller 와 VO |
| 첨부파일 인프라의 유무 | `cmm/service/EgovFileMngService.java` 와 `config/EgovConfigAttachFile.java`(또는 `context-idgn-File.xml`)의 존재 |
| 시드 SQL | `src/main/resources/db/*.sql` 가운데 `add-*-tables.sql` 과 `attach-file.sql` 을 뺀 파일이 1개일 때 그 파일 (`migrationStrategy.ts`) |

## 같은 인자로 다시 호출했을 때

기존 프로젝트에 파일을 추가하는 도구는 만들 파일을 메모리에서 렌더링한 뒤, 기존 파일과 내용까지 비교해서 다음과 같이 판정합니다.

| 도구 | 판정 |
|------|------|
| `egov_add_entity` | 만들 파일이 모두 같은 내용으로 있으면 변경 없이 성공으로 응답하고, 시드 SQL, 메시지 번들, 메뉴의 반영도 건너뜁니다. 이때 `withAttachment=true` 인데 첨부파일 인프라가 없으면 인프라만 설치합니다. 파일이 일부만 있거나 내용이 다르면 거부합니다. |
| `egov_add_query_view` | 판정은 `egov_add_entity` 와 같습니다. 다만 파일이 모두 같아도 메시지 번들에 이미 덧붙은 내용이 지금 계산한 내용과 다르면(예: `label` 만 바꾼 경우) 충돌로 거부합니다. |
| `egov_add_attach_file_infrastructure` | 파일 단위로 판정합니다. 같은 내용의 파일은 건너뛰고 없는 파일만 만들며, 내용이 다른 파일이 하나라도 있으면 전체를 거부합니다. |

## 템플릿을 고칠 때

- 템플릿을 고치면 골든 테스트(`tests/scaffold/golden.test.ts`)의 해시가 달라집니다. 의도한 변경인지 확인한 뒤에 `npm run test:update` 로 갱신합니다.
- 매니페스트에 항목을 추가하거나 빼면 항목 수를 검사하는 `tests/scaffold/manifestLoader.test.ts` 도 함께 고칩니다.
- 화면 템플릿이나 설정 템플릿을 고쳤으면 [생성된 프로젝트의 동작 확인](../development/GENERATED_PROJECT_VERIFICATION.md)의 절차로 실제 프로젝트를 빌드하고 실행해서 확인합니다. 테스트는 생성된 파일의 텍스트만 검사하므로, 바인딩, 화면 표현식, 인코딩의 오류는 실행해야 드러납니다.
- 4.3 스택의 템플릿에는 JDK 8 과 실행환경 4.3.2 에 없는 API(`jakarta.*`, 실행환경 5.x 의 클래스)를 쓰지 않습니다.
