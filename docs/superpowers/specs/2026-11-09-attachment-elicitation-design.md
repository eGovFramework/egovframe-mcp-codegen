# 스캐폴드·엔티티 생성 시 첨부파일 통합과 사용자 확인 설계

- 작성일: 2026-11-09
- 대상 도구: `egov_scaffold_project`, `egov_add_entity`
- 재사용 대상: `egov_add_attach_file_infrastructure`

## 1. 의도

사용자는 보통 "표준프레임워크 프로젝트 생성"이나 "다음 DDL 기반 프로젝트 생성"처럼 요청하고, 첨부파일을 언급하지 않습니다. 현재 첨부파일이 필요한 엔티티를 만들려면 스캐폴드, 인프라 설치, `withAttachment=true` 엔티티 추가의 세 단계를 거쳐야 하고, 스캐폴드와 함께 생성되는 첫 엔티티에는 첨부파일을 연결할 수 없습니다.

이 작업은 두 도구를 호출하는 시점에 사용자에게 첨부파일 포함 여부를 확인하고, 포함을 선택하면 한 번의 호출로 첨부파일이 동작하는 결과를 만듭니다. 첨부파일 인프라는 업로드·다운로드 경로와 DB 테이블을 추가하므로, 사용자의 선택 없이 기본으로 설치하지 않습니다.

## 2. 목표와 범위

### 목표

- 두 도구에 `withAttachment` 인자 하나로 "필요하면 인프라를 설치하고 엔티티에 첨부파일을 연결"하는 동작을 제공합니다.
- 값이 지정되지 않으면 MCP Elicitation으로 사용자에게 묻고, Elicitation을 쓸 수 없으면 파일을 만들지 않은 채 AI가 사용자에게 묻도록 합니다.
- 생성 직후 내장 HSQL로 실행했을 때 다음이 동작해야 합니다: 테이블 생성, 등록·수정 화면의 파일 선택, 기존 파일 목록, 다운로드 링크, 업로드·수정·삭제 처리.

### 비목표

- `alertMessages` fragment를 엔티티 화면에 자동으로 포함하는 작업은 하지 않습니다.
- `/cmm/fms/FileDown.do` 전용 접근 제어 규칙은 추가하지 않습니다.
- 파일 저장 경로 기본값(OS 임시 디렉터리)은 변경하지 않습니다.
- 운영 DB DDL 자동 적용은 하지 않습니다.
- 4.3 Boot와 WAR용 인프라 설치는 지원하지 않습니다.
- 두 도구에 인프라 세부 설정 인자(파일 크기 한도, 채번 규칙 등)를 추가하지 않습니다. 기본값과 다른 값이 필요하면 `withAttachment=false`로 스캐폴드하고, `egov_add_attach_file_infrastructure`에 값을 지정해 설치한 뒤, `egov_add_entity`를 `withAttachment=true`로 호출합니다. 이 경로에서는 스캐폴드로 생성한 첫 엔티티에 첨부파일을 연결할 수 없으며, 이 제약은 수용합니다. 이미 기본값으로 설치한 프로젝트에서는 이 도구를 다른 값으로 다시 호출하면 충돌로 거부되므로, 생성된 설정 파일을 직접 수정해야 합니다.
- `egov_add_entity`의 `autoApplyMigration` 기본값(`true`)은 변경하지 않습니다. 기본 호출에서는 새 엔티티 테이블도 HSQL 시드에 반영되므로, 사용자가 첨부파일을 선택한 일반 경로에서 추가 인자가 필요하지 않습니다.
- 4.3 Boot와 WAR의 엔티티 템플릿에 첨부파일 연결을 구현하지 않습니다. 현재 `withAttachment` 분기는 이 스택에서 SQL과 메시지 키에만 있고 VO, Mapper, Controller, 화면에는 없습니다.

### 실패로 간주하는 결과

- 사용자가 선택하지 않았는데 첨부파일 인프라가 설치되는 경우입니다.
- `withAttachment=true`로 생성한 프로젝트가 컴파일되지 않거나 기동되지 않는 경우입니다.
- `egov_add_entity`가 엔티티 충돌로 거부되었는데 인프라 파일만 남는 경우입니다.
- `withAttachment`를 지정하지 않은 기존 내부 호출과 골든 파일 결과가 달라지는 경우입니다.

## 3. 결정 사항

### 사용자가 결정한 사항

| 항목 | 결정 |
|---|---|
| 인자 구성 | 두 도구 모두 `withAttachment` 하나로 통합합니다. 별도 설치 인자는 두지 않습니다. |
| 인프라가 없는 프로젝트의 `egov_add_entity` | `withAttachment=true`이면 인프라를 먼저 설치합니다. 기존의 거부 동작은 제거합니다. |
| 질문 방식 | MCP Elicitation을 두 도구에 적용합니다. |
| Elicitation 응답 대기 시간 | 120초입니다. |
| 응답별 처리 | `accept`는 입력값대로 진행, `decline`은 첨부파일 없이 생성, `cancel`은 아무 파일도 만들지 않고 중단합니다. |
| "동작"의 범위 | 2절 목표의 마지막 항목까지입니다. |
| 지원 스택 | 5.0 Boot만 대상으로 합니다. 4.3 Boot와 WAR 지원은 이번 작업에서 제외합니다. |
| 인프라 세부 설정 | 두 도구에 세부 설정 인자를 추가하지 않고 기본값으로 설치합니다. |

### 작성자가 판단한 사항 (검토 대상)

- 설치 로직은 Tool 호출이나 도구별 구현이 아니라 공통 내부 모듈로 추출합니다.
- Elicitation은 `src/index.ts`의 도구 핸들러에서 수행합니다. 도구 모듈 함수를 직접 호출하는 기존 테스트 63곳에는 영향을 주지 않기 위해서입니다.
- 5.0 Boot가 아닌 스택에서 `withAttachment`가 없으면 묻지 않고 `false`로 처리합니다. 사용자에게 동작하지 않는 기능을 제안하지 않기 위해서입니다.
- 인프라를 수동으로 갖춘 4.3 프로젝트에 `withAttachment=true`를 명시한 호출은 현재처럼 통과시키고 이번 작업에서 변경하지 않습니다. 이 호출은 `ATCH_FILE_ID` 컬럼과 메시지 키만 생성하며 첨부파일 기능은 동작하지 않습니다.
- Elicitation 시간 초과, 호출 오류, `accept`인데 값이 없는 응답은 "미지원 클라이언트"와 같은 경로로 처리합니다.
- `cancel`은 오류가 아니라 정상 응답으로 반환해서 AI가 재시도하지 않도록 합니다.

## 4. 입력 인자

두 도구 모두 다음 규칙을 따릅니다.

- `src/index.ts`의 raw shape: `withAttachment: z.boolean().optional()`로 선언하고 기본값은 두지 않습니다. 값 없음과 `false`를 구분해야 하기 때문입니다.
- 도구 모듈 스키마: `z.boolean().optional().default(false)`입니다. `egov_add_entity`는 이미 이 형태입니다.
- `.describe()` 문구는 다음 내용을 포함합니다.
  - 사용자가 요청에서 첨부파일 포함 여부를 밝히지 않았으면 이 인자를 생략해야 합니다. 임의로 `false`를 넣으면 안 됩니다.
  - 생략하면 서버가 사용자에게 확인합니다.
  - `true`이면 인프라가 없을 때 자동으로 설치합니다.
- `egov_scaffold_project` 모듈 스키마는 `withAttachment=true`와 5.0 Boot 외의 스택 조합을 `superRefine`으로 거부합니다.

스캐폴드 경로에서 `attachmentFieldName`은 `atchFileId`, `maxAttachmentCount`는 0으로 고정합니다.

## 5. 사용자 확인 흐름

새 모듈 `src/utils/scaffold/attachmentDecision.ts`가 결정을 담당합니다. `McpServer`의 `server.server`를 주입받아 테스트에서 인메모리 클라이언트로 검증할 수 있게 합니다. 반환값은 다음 세 가지입니다.

- `{ kind: "value", value: boolean }`
- `{ kind: "needsUserDecision" }`
- `{ kind: "cancelled" }`

판정 순서는 다음과 같습니다.

1. 인자에 값이 있으면 그 값을 반환하고 질문하지 않습니다.
2. 대상 스택에서 첨부파일을 쓸 수 없으면 `false`를 반환합니다.
   - 스캐폴드: `projectType`(기본 `boot`)과 `stackVersion`(기본 `5.0`)이 5.0 Boot일 때만 사용할 수 있습니다.
   - 엔티티: `detectProjectStack`이 5.0 Boot를 반환할 때만 사용할 수 있습니다. 인프라 존재 여부는 사용 가능 판정에 쓰지 않고 질문 문구를 고를 때만 사용합니다.
   - `detectProjectStack`이 예외를 던지면 질문을 건너뛰고 도구 본체가 기존 오류를 보고하게 합니다.
3. `elicitInput`을 `mode: "form"`과 `{ timeout: 120_000 }`으로 호출합니다. 요청 스키마는 필수 boolean 필드 `withAttachment` 하나입니다.
   - `accept` + boolean 값: `value`
   - `decline`: `value: false`
   - `cancel`: `cancelled`
   - `accept`인데 값 없음, 미지원 클라이언트에서 SDK가 던지는 예외, 시간 초과, 그 외 예외: `needsUserDecision`

질문 문구는 다음과 같습니다.

- 스캐폴드: "이 프로젝트에 표준 첨부파일 기능을 포함할까요?"
- 엔티티, 인프라 있음: "엔티티 'X'에 표준 첨부파일 기능을 연결할까요?"
- 엔티티, 인프라 없음: "엔티티 'X'에 표준 첨부파일 기능을 연결할까요? 프로젝트에 첨부파일 인프라가 없어 함께 설치됩니다."

핸들러는 결과에 따라 다음과 같이 처리합니다.

- `value`: `{ ...args, withAttachment: value }`로 도구 함수를 호출합니다.
- `needsUserDecision`: 파일을 만들지 않고 `retryAfterAction`을 던집니다. 메시지는 "사용자에게 첨부파일 포함 여부를 물은 뒤 `withAttachment`를 true 또는 false로 지정해 나머지 인자는 그대로 다시 호출하라"는 내용입니다. 기존 catch 블록이 `isError: true`로 반환합니다.
- `cancelled`: "사용자가 취소하여 아무 파일도 생성하지 않았다"는 문구와 `completionFooter()`를 `isError` 없이 반환합니다.

## 6. 공통 설치 모듈

`src/tools/egovAddAttachFileInfrastructure.ts`의 300~608행 로직을 새 모듈 `src/utils/scaffold/attachFileInstaller.ts`로 옮깁니다.

- `planAttachFileInfra(projectDir, options)`: 현재의 스택 감지, 매니페스트 라우팅, 렌더링, 사전 검사, HSQL 시드 계획, 충돌 거부, 자체 검증을 수행하고 계획 객체를 반환합니다. 파일을 쓰지 않습니다.
- `applyAttachFileInfra(plan, journal)`: 계획을 디스크에 반영하고 결과를 반환합니다. `withWriteRollback`은 호출자가 감쌉니다.
- 결과를 다른 도구의 응답에 넣을 수 있도록 요약 포맷 함수를 제공합니다. HSQL 시드가 별도 파일로 fallback된 경우의 안내는 요약에 반드시 포함해야 합니다. 이 경우 내장 HSQL에 테이블이 자동 생성되지 않기 때문입니다.

옵션 기본값은 `AddAttachFileInfrastructureInputSchema` 한 곳에서 유지합니다. 기존 도구의 입력, 출력 메시지, 오류 분류는 바뀌지 않아야 합니다.

## 7. `egov_add_entity` 흐름

첨부파일 템플릿 변수 주입(현재 571~580행)과 `ATCH_FILE_ID` 속성 제외(현재 621~632행)는 공통 함수 `applyAttachmentContext`로 추출합니다.

`withAttachment=true`일 때의 순서는 다음과 같습니다.

1. `detectAttachFileInfra`로 인프라 존재 여부를 판단합니다. 대표 파일 두 개를 확인하는 기존 함수를 그대로 사용합니다.
2. 인프라가 없으면 `planAttachFileInfra`를 호출합니다. 충돌이나 미지원 스택은 이 시점에 파일 쓰기 없이 거부됩니다. 일부 파일만 있는 프로젝트도 이 경로로 들어가며, 내용이 같은 파일은 건너뛰고 다른 파일은 충돌로 거부합니다.
3. 기존 엔티티 사전 검사(6-a, 6-b, 6-c 단계)를 수행합니다.
4. 하나의 `FileWriteJournal`과 `withWriteRollback` 안에서 인프라를 먼저 적용하고 엔티티 파일을 씁니다. `writeRenderedEntityFiles`는 외부 저널을 받도록 변경합니다.
5. 시드 append, 메시지 번들 append, 메뉴 갱신 등 기존 후속 단계는 지금처럼 저널 밖에서 수행합니다. 따라서 같은 시드 파일에 인프라 DDL(저널 안)과 엔티티 DDL(저널 밖)이 순서대로 추가되며, 엔티티 DDL append가 실패해도 인프라 DDL은 남습니다. 이 후속 단계의 롤백은 기존 동작대로 지원하지 않습니다.

엔티티 파일이 전부 동일해서 6-a 멱등 경로로 끝나는 경우에도 인프라 계획이 있으면 인프라를 적용한 뒤 그 사실을 응답에 표시합니다.

결과 메시지에는 인프라를 자동 설치했다는 내용과 6절의 요약을 추가합니다.

## 8. `egov_scaffold_project` 흐름

1. `generateScaffoldProject`의 `ScaffoldParams`에 `withAttachment`를 추가합니다. `buildContext` 직후 `applyAttachmentContext`를 적용합니다. 값이 없거나 `false`이면 기존 렌더링 결과와 동일해야 합니다.
2. 도구 함수는 프로젝트 생성이 끝난 뒤 `planAttachFileInfra`와 `applyAttachFileInfra`를 `withWriteRollback`으로 실행합니다. 프로젝트의 base package 감지가 생성된 파일에 의존하므로 설치는 생성 후에 수행합니다.
3. 설치가 실패하면 인프라 변경만 롤백됩니다. 스캐폴드는 현재 롤백을 지원하지 않으므로 생성된 프로젝트는 남고, 첫 엔티티가 인프라 클래스를 참조해 컴파일되지 않는 상태가 됩니다. 이때 `retryAfterAction`으로 "프로젝트는 생성되었으나 인프라 설치에 실패했으며, `egov_add_attach_file_infrastructure`를 호출하면 복구된다"고 안내합니다. 스캐폴드 전체 롤백은 이번 범위에 포함하지 않습니다.
4. 결과 메시지에 인프라 설치 요약을 추가합니다.

## 9. 구현 순서

1. `attachFileInstaller` 추출: 동작 변경 없음.
2. `applyAttachmentContext` 추출: 동작 변경 없음.
3. `egov_add_entity` 자동 설치.
4. `egov_scaffold_project`의 `withAttachment`.
5. `attachmentDecision` 구현과 두 핸들러 연결.
6. 실제 빌드·기동 검증과 문서 갱신.

## 10. 검증

### 자동 테스트

- `attachmentDecision`: 값 지정, 미지원 스택, 미지원 클라이언트, `accept`(true/false), `decline`, `cancel`, `accept` 값 누락, 시간 초과, 120초 옵션 전달을 인메모리 클라이언트로 검증합니다.
- `egov_add_entity`: 인프라 없음 + `true`의 자동 설치, 인프라 있음 + `true`의 재설치 없음, 엔티티 충돌 시 인프라 미기록, 쓰기 실패 시 인프라까지 복원, 인프라가 없는 4.3 프로젝트 거부, 인프라가 있는 4.3 프로젝트에서 값이 없을 때 질문하지 않음을 검증합니다.
- `egov_scaffold_project`: `true`의 인프라 설치와 첫 엔티티 연결, 4.3·WAR 조합 거부, `false` 또는 값 없음의 골든 파일 불변을 검증합니다.
- `tests/scaffold/errorClassificationIntegration.test.ts`의 인프라 미설치 거부 검증은 새 동작에 맞게 수정합니다.
- `tests/toolRegistration.test.ts`로 두 스키마의 동기화를 확인합니다.

### 실제 실행 검증

다음 두 경로에서 Maven 빌드와 기동을 수행하고, 내장 HSQL 기준으로 업로드, 기존 파일 목록 표시, 다운로드, 수정, 삭제를 확인합니다.

- `egov_scaffold_project`를 `withAttachment=true`로 호출한 프로젝트입니다.
- `withAttachment=false`로 스캐폴드한 뒤 `egov_add_entity`를 `withAttachment=true`와 나머지 기본 인자로 호출한 프로젝트입니다. 같은 시드 파일에 인프라 DDL과 엔티티 DDL이 모두 추가된 상태로 기동되는지 확인합니다.

첫 엔티티의 `withAttachment` 렌더링은 지금까지 생성된 적이 없는 조합이므로, 스캐폴드 경로를 우선 검증합니다.

## 11. 문서 갱신

- `src/index.ts`의 두 도구 설명과 `withAttachment` 설명을 갱신합니다. `egov_add_entity` 설명의 "프로젝트 공용 설정은 건드리지 않습니다" 문구에 `withAttachment=true`로 인프라를 설치하는 경우의 예외를 명시합니다.
- `README.md`, `docs/design/attach-file-tool-schema.md`에서 사전 설치를 전제로 한 설명을 수정합니다.

## 12. 구현자 재량

- 모듈 내부의 타입 이름, 응답 메시지의 세부 문구, 옵션 기본값을 스키마 한 곳에 유지하기 위한 파일 배치는 구현자가 정합니다.
- 5.0 Boot `withAttachment=true` 스캐폴드용 골든 파일을 추가할지는 테스트 유지 비용을 고려해 구현자가 정합니다.
