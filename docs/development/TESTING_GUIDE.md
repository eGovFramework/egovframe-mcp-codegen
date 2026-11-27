# 빌드와 테스트 가이드

이 문서는 서버를 빌드하고 테스트하는 방법과 테스트의 구성을 설명합니다.

## 준비

```bash
nvm use        # nvm 을 쓰는 경우. .nvmrc 가 Node.js 22 를 가리킵니다
npm install    # 의존성을 설치하고, prepare 스크립트가 빌드까지 실행합니다
```

서버는 Node.js 18 이상에서 동작하며, 개발에는 Node.js 22 를 사용합니다.

## 명령

| 명령 | 동작 |
|------|------|
| `npm run build` | TypeScript 를 컴파일해서 `build/` 에 출력하고, `build/index.js` 에 실행 권한을 줍니다. |
| `npm run watch` | 소스가 바뀔 때마다 다시 컴파일합니다. |
| `npm test` | 빌드한 뒤에 전체 테스트를 실행합니다. |
| `npm run test:unit` | 빌드하지 않고 테스트만 실행합니다. |
| `npm run test:watch` | 파일이 바뀔 때마다 관련 테스트를 다시 실행합니다. |
| `npm run test:update` | 빌드한 뒤에 골든 파일을 현재 산출물로 갱신합니다. |
| `npm run inspector` | 빌드한 서버를 MCP Inspector 로 실행합니다. |
| `npm run pack:bundle` | 배포용 tgz 를 만듭니다. [배포 패키지 제작 가이드](../operations/PACKAGING_GUIDE.md) 참조 |

테스트는 vitest 로 작성되어 있고, `tests/**/*.test.ts` 가 대상입니다. 5.1.0 을 기준으로 테스트 파일은 48개, 테스트는 757개이며, 전체 실행에 30초 정도 걸립니다.

### test 와 test:unit 의 차이

대부분의 테스트는 `src/` 의 모듈을 직접 불러오므로 빌드가 필요하지 않습니다. 다만 다음 두 파일은 빌드한 서버(`build/index.js`)를 실제로 실행해서 MCP 프로토콜로 검증합니다.

- `tests/toolRegistration.test.ts`
- `tests/elicitationIntegration.test.ts`

소스를 고친 뒤에 `npm run test:unit` 만 실행하면 이 두 파일은 이전에 빌드한 서버를 검사하게 됩니다. 도구의 등록, 인자의 설명, 사용자 확인 흐름을 고쳤을 때에는 `npm test` 로 실행합니다.

### 환경에 따라 건너뛰는 테스트

`tests/scaffold/hsqlSeedBoot.test.ts` 의 테스트 하나는 생성한 시드 SQL 을 HSQLDB 로 실제로 실행합니다. 이 테스트는 `java` 명령과 로컬 Maven 저장소(`~/.m2/repository/org/hsqldb/hsqldb/`)의 HSQLDB jar 가 있을 때만 실행되고, 없으면 건너뜁니다.

## 테스트의 구성

```text
tests/
├── toolRegistration.test.ts          tools/list 로 공개되는 스키마와 도구 모듈의 스키마가 일치하는지
├── elicitationIntegration.test.ts    서버를 실행해서 사용자 확인 흐름 전체를 검증
├── utils/                            DDL 정리, DBMS 별 타입 변환, SQL 문자열 유틸리티
└── scaffold/                         코드 생성의 단위 테스트와 통합 테스트
    └── __golden__/                   골든 파일 (boot50.json, boot43.json, war.json)
```

`tests/scaffold/` 의 테스트는 주제별로 다음과 같습니다.

| 주제 | 테스트 파일 |
|------|-------------|
| 산출물 전체의 고정 | `golden`, `outputValidator` |
| 입력 검증과 오류 문구 | `inputValidation`, `toolMessages`, `errorClassificationIntegration` |
| DDL 파싱 | `ddlParser`, `ddlParserDiagnostics`, `ddlParserFallbackNotice`, `decimalScale` |
| COMMENT 라벨 | `messageLabel`, `commentLabelsContext`, `commentLabelsBundle` |
| 스택 정의와 매니페스트 | `stackMatrix`, `manifestLoader`, `projectDetector`, `boot43PomParent`, `war43PomParent` |
| 엔티티 추가 | `addEntityAutoApply`, `addEntityIdempotency`, `mapperScanAlignment`, `navLinkMapping` |
| 조회 화면 | `addQueryView`, `addQueryViewStacks`, `queryViewNumberFormat` |
| 첨부파일 | `attachFileInstaller`, `attachFileInfraReinstall`, `attachFileMapperSql`, `addAttachFileHsqlSeed`, `attachmentHardening`, `boot43Attachment`, `addEntityAutoInstallInfra`, `addEntityWithAttachmentMigration`, `scaffoldWithAttachment` |
| 사용자 확인 | `scaffoldDecision`, `attachmentDecision` |
| 보안 설정 (5.1 Boot) | `securityConfig` |
| 화면 | `krdsViews43`, `warDateBinding`, `warRuntimeArtifacts` |
| 쓰기와 경로 | `pathGuard`, `writeRollback` |
| 내장 DB 시드 | `hsqlSeedBoot` |
| 외부 테스트에서 보고된 결함의 재발 방지 | `testReportDefects` |

코드를 생성하는 테스트는 운영체제의 임시 디렉터리에 프로젝트를 만들고, 생성된 파일의 내용을 검사합니다. 생성된 프로젝트를 컴파일하거나 실행하지는 않습니다.

## 골든 테스트

`tests/scaffold/golden.test.ts` 는 세 스택의 프로젝트를 정해진 DDL 로 생성한 뒤, 산출물을 골든 파일과 비교합니다. 템플릿이나 렌더링 로직을 고쳤을 때 의도하지 않은 산출물의 변경을 잡아내는 것이 목적입니다.

골든 파일은 파일의 내용 전체가 아니라 경로와 SHA-256 해시의 목록입니다.

```json
{
  "scenario": "boot50",
  "fileCount": 48,
  "staticFileCount": 588,
  "files": [
    { "path": "pom.xml", "sha256": "..." }
  ]
}
```

KRDS 정적 자산은 그대로 복사되는 파일이어서 해시를 기록하지 않고 개수만 기록합니다.

### 골든 테스트가 실패했을 때

1. 의도한 변경인지 확인합니다. 실패 메시지에 해시가 달라진 파일의 경로가 나옵니다.
2. 의도하지 않은 변경이면 템플릿(`templates/`)과 렌더링 로직을 확인합니다.
3. 의도한 변경이면 `npm run test:update` 로 골든 파일을 갱신합니다.
4. 갱신한 뒤에 `git diff tests/scaffold/__golden__/` 로 바뀐 범위를 확인합니다. 한 스택의 템플릿만 고쳤는데 다른 스택의 골든 파일이 바뀌었다면 변경이 의도한 범위를 벗어난 것입니다.

해시가 달라졌다는 사실만으로는 생성된 코드가 올바른지 알 수 없습니다. 템플릿을 고쳤으면 [생성된 프로젝트의 동작 확인](./GENERATED_PROJECT_VERIFICATION.md)의 절차로 실제 프로젝트를 빌드하고 실행해서 확인합니다.

## 테스트를 추가할 때

- 도구의 인자를 추가하거나 바꾸면 `src/index.ts` 의 스키마와 `src/tools/` 의 스키마를 함께 고칩니다. `tests/toolRegistration.test.ts` 가 두 스키마의 불일치를 잡아냅니다.
- 매니페스트에 항목을 추가하거나 빼면 `tests/scaffold/manifestLoader.test.ts` 의 항목 수와 골든 파일을 갱신합니다.
- 새 기능에는 단위 테스트와, 실제로 파일을 생성해서 내용을 검사하는 통합 테스트를 함께 추가합니다.
- 실행해야 드러나는 결함을 고쳤으면, 같은 결함을 생성된 파일의 텍스트로 검사하는 테스트를 추가해서 다시 발생하지 않게 합니다.

## MCP Inspector

```bash
npm run inspector
```

빌드한 서버를 MCP Inspector 에 연결해서, 브라우저에서 도구의 목록과 스키마를 확인하고 도구를 직접 호출할 수 있습니다. Inspector 는 `npx` 로 내려받아 실행하므로 네트워크가 필요합니다.

Inspector 가 서버를 실행하지 못하면 `npm run build` 가 성공했는지, `build/index.js` 에 실행 권한이 있는지 확인합니다.

## 타입 검사

`tsconfig.json` 은 `src/` 만 컴파일하고, vitest 는 테스트 코드의 타입을 검사하지 않고 실행합니다. 테스트 코드의 타입까지 검사하려면 `tsconfig.tests.json` 을 사용합니다.

```bash
npx tsc -p tsconfig.tests.json
```

이 검사는 `npm test` 에 포함되어 있지 않습니다. 5.1.0 을 기준으로 사용자 확인 흐름의 테스트 3개 파일에서 타입 오류 18건이 보고되며, 테스트의 실행 결과에는 영향이 없습니다. 내용은 [알려진 문제와 제약 사항](./KNOWN_ISSUES.md)에 있습니다.
