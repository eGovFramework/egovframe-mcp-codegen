# Elicitation: SDK 1.29.0과 v2 비교 및 전환 가이드

- 작성일: 2026-11-09
- 현재 사용 버전: `@modelcontextprotocol/sdk` 1.29.0 (`package.json`은 `^1.29.0`)
- 대상 코드: `src/index.ts`, `src/utils/scaffold/attachmentDecision.ts`

> **검증 범위:** 1.29.0 동작은 설치된 SDK로 실행해 확인했습니다. v2 내용은 아래 참고 문서를 읽고 정리한 것이며, 이 저장소에 v2를 설치해 실행하지는 않았습니다. 전환 시 실제 패키지의 타입과 동작으로 다시 확인해야 합니다.

## 1. 요약

- 현재 코드의 질문 흐름과 응답 처리는 v2 문서의 설명과 같습니다. 달라지는 부분은 패키지, import 경로, 핸들러 인자입니다.
- `elicitInput` 호출을 유지한 채 v2로 올리면 2025-11-25 연결에서는 그대로 동작합니다. 2026-07-28 연결에서는 `elicitInput`이 예외를 던지므로 폼이 표시되지 않고, AI가 사용자에게 묻는 경로로 넘어갑니다. 파일은 만들어지지 않아 안전하지만 Elicitation은 사용되지 않습니다.
- 두 프로토콜을 모두 지원하려면 핸들러를 `inputRequired` 반환 방식으로 바꿔야 합니다.
- main README에 따르면 v1은 v2 출시일(2026-07-27) 이후 최소 6개월 동안 버그 수정과 보안 업데이트를 받습니다. 즉 빠르면 2027-01-27 이후 지원이 끝날 수 있습니다.

## 2. 현재 코드의 동작

`resolveAttachmentDecision`의 판정 순서는 다음과 같습니다.

1. `withAttachment` 인자가 있으면 그 값을 사용하고 질문하지 않습니다.
2. 5.0 Boot가 아니면 `false`로 처리합니다.
3. `elicitInput`을 `mode: "form"`, `{ timeout: 60_000, signal }`로 호출합니다.

| 결과 | 처리 |
|---|---|
| `accept`와 boolean 값 | 값대로 진행 |
| `decline` | `false`로 생성 |
| `cancel` 또는 호출 취소 | 파일 없이 중단, `isError` 없음 |
| 미지원 클라이언트의 SDK 예외, 시간 초과, 값 없는 `accept`, 기타 예외 | 파일 없이 `isError`, AI에게 사용자 확인 후 재호출 요청 |

## 3. 문서 비교

비교 대상은 `v2.0.0-beta.1` 태그의 문서(이하 beta)와 main 브랜치의 문서(이하 main)입니다.

### 3.1 API

| 항목 | 현재 코드 (1.29.0) | beta, main |
|---|---|---|
| 패키지 | `@modelcontextprotocol/sdk` | `@modelcontextprotocol/server`, `@modelcontextprotocol/client` |
| 핸들러 인자 | `(args, extra)` | `(args, ctx)` |
| 호출 경로 | `server.server.elicitInput(params, options)` | `ctx.mcpReq.elicitInput(params, options)` |
| 취소 신호 | `extra.signal` | `ctx.mcpReq.signal` |
| 입력 스키마 | raw zod shape | `z.object(...)` 권장, raw shape는 deprecated overload로 허용 |
| 클라이언트 처리기 | `setRequestHandler(ElicitRequestSchema, ...)` | `setRequestHandler('elicitation/create', ...)` |

### 3.2 동일한 부분

- 요청 파라미터는 `mode: 'form'`, `message`, flat JSON Schema 형식의 `requestedSchema`입니다.
- 응답은 `accept`, `decline`, `cancel`이며 `content`는 `accept`에만 있습니다.
- `accept` 응답은 SDK가 `requestedSchema`로 검증합니다.
- 미지원 클라이언트에는 요청을 보내기 전에 `Client does not support form elicitation.` 예외가 발생합니다.
- 폼으로 비밀번호, API 키, 결제 정보를 수집하면 안 됩니다. 이 도구는 boolean 하나만 묻습니다.

### 3.3 문서에만 있고 현재 코드에서 사용하지 않는 기능

| 기능 | 문서 | 현재 코드에서 사용하지 않는 이유 |
|---|---|---|
| URL 모드 (`mode: 'url'`) | beta, main | 민감 정보를 받지 않습니다. |
| URL 완료 알림 (`createElicitationCompletionNotifier`) | main | URL 모드를 쓰지 않습니다. |
| 필드 `default`, `applyDefaults` | main | 사용자가 명시적으로 선택해야 합니다. |

### 3.4 제한 시간

main은 `elicitInput`과 클라이언트 `callTool`의 기본 제한 시간이 모두 60초라고 설명합니다. 현재 코드도 60초입니다. beta에는 이 설명이 없습니다.

### 3.5 beta와 main의 차이

전환 시에는 main과 실제 패키지를 기준으로 삼습니다.

| 항목 | beta | main |
|---|---|---|
| 상태 | beta | stable release line |
| 모듈 형식 | ESM only | ESM과 CommonJS 빌드 제공 |
| `acceptedContent` | 제네릭 형식, 스키마 인자 없음 | 세 번째 인자로 스키마를 받아 검증 |
| `content`가 없는 핸들러 결과 | `-32602` 거부 | `content: []`로 정규화 |
| legacy shim 설명 | 없음 | `ServerOptions.inputRequired.legacyShim` 설명 있음 |

## 4. 전환 시 변경할 코드

### 4.1 의존성과 런타임

| 파일 | 변경 |
|---|---|
| `package.json` | `@modelcontextprotocol/sdk`를 제거하고 `@modelcontextprotocol/server`를 추가합니다. 테스트용으로 `@modelcontextprotocol/client`를 `devDependencies`에 추가합니다. |
| `CLAUDE.md`, `README.md` | Node 최소 버전을 18에서 20으로 올리고 SDK 패키지 설명을 갱신합니다. `.nvmrc`는 22이므로 변경하지 않습니다. |

`zod ^4.4.3`은 v2의 요구 사항(`^4.2.0`)을 만족합니다. v2 문서의 예제는 `zod/v4`에서 import합니다. 현재의 `import { z } from "zod"`를 유지해도 되는지는 전환 시 `.describe()`가 `tools/list`에 나오는지로 확인합니다. `tests/toolRegistration.test.ts`가 이 동작을 검사합니다.

### 4.2 `src/index.ts`

```ts
// 변경 전
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// 변경 후
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
```

- `inputSchema`의 raw shape 4개는 deprecated overload로 계속 동작합니다. `z.object(...)`로 바꾸려면 프로젝트의 "raw zod shape" 컨벤션(`CLAUDE.md`)도 함께 고쳐야 합니다. 세 저장소에 공통된 컨벤션이므로 별도 결정이 필요합니다.
- `egov_scaffold_project`와 `egov_add_entity` 핸들러의 `(args, extra)`를 `(args, ctx)`로 바꿉니다.

### 4.3 사용자 확인: 1단계, 2025-11-25 연결 유지

`server.server` 대신 `ctx.mcpReq`를 넘깁니다. `server.server.elicitInput`이 v2에 남아 있는지는 문서에 없으므로 사용하지 않습니다.

```ts
// src/utils/scaffold/attachmentDecision.ts
// 삭제: import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
type ElicitingRequest = {
  elicitInput: (params: ElicitParams, options?: { timeout?: number; signal?: AbortSignal }) => Promise<ElicitResult>;
  signal: AbortSignal;
};

// src/index.ts
const decision = await resolveAttachmentDecision({
  request: ctx.mcpReq,
  provided: args.withAttachment,
  supported: prompt.supported,
  message: prompt.message,
});
```

`ElicitParams`, `ElicitResult`의 정확한 타입 이름과 export 위치는 실제 패키지에서 확인합니다. `ctx.mcpReq`를 분리해 호출하면 `this`가 끊길 수 있으므로 메서드로 호출합니다.

이 단계에서 2026-07-28 연결은 `needsUserDecision` 경로로 동작합니다.

### 4.4 사용자 확인: 2단계, 2026-07-28 연결 지원

`elicitInput` 대신 핸들러가 입력 요청을 반환합니다. 클라이언트가 답을 받아 같은 도구를 다시 호출하면 응답이 `ctx.mcpReq.inputResponses`에 들어옵니다. main 문서에 따르면 `legacyShim`이 기본으로 켜져 있어, 같은 핸들러가 2025-11-25 연결도 처리합니다. 이때 SDK가 `elicitation/create`를 보낸 뒤 핸들러를 다시 실행합니다.

```ts
async (args, ctx): Promise<CallToolResult | InputRequiredResult> => {
  // 입력 검증과 provided, supported 판정은 현재와 같습니다.
  const answer = inputResponse(ctx.mcpReq.inputResponses, "withAttachment" /* 정확한 형태는 확인 필요 */);
  if (answer.kind === "missing") {
    return inputRequired({
      inputRequests: {
        withAttachment: inputRequired.elicit({ message: prompt.message, requestedSchema }),
      },
    });
  }
  // accept, decline, cancel 처리는 2절의 표와 같습니다.
};
```

전환할 때 다음 사항을 결정하거나 확인해야 합니다.

| 항목 | 내용 |
|---|---|
| `decline`과 `cancel` 구분 | `acceptedContent`는 없음, 거절, 취소일 때 모두 `undefined`를 반환합니다. 현재 동작을 유지하려면 구분된 결과를 주는 `inputResponse`를 사용해야 합니다. 정확한 시그니처는 실제 패키지에서 확인합니다. |
| 미지원 클라이언트 | 2026-07-28 연결에서 capability를 선언하지 않은 클라이언트는 `-32021`로 거부됩니다. 현재의 "AI에게 재호출 요청" 메시지가 전달되지 않을 수 있으므로, 사전 검사나 오류 처리 방식을 정해야 합니다. |
| 핸들러 재실행 | 응답이 올 때마다 핸들러가 처음부터 다시 실행됩니다. 현재 구조는 파일 쓰기 전에 질문하므로 문제가 없지만, 질문 앞에 쓰기 작업을 넣으면 안 됩니다. |
| 대기 시간과 취소 | 이 방식에서는 서버가 응답을 기다리지 않으므로 `ATTACHMENT_ELICIT_TIMEOUT_MS`의 역할이 없어집니다. legacy shim 경로의 제한 시간은 문서에 없으므로 확인이 필요합니다. |

### 4.5 테스트

| 파일 | 변경 |
|---|---|
| `tests/elicitationIntegration.test.ts`, `tests/toolRegistration.test.ts` | `Client`를 `@modelcontextprotocol/client`에서, `StdioClientTransport`를 `@modelcontextprotocol/client/stdio`에서 import합니다. stdio 경로의 근거는 beta 문서뿐이므로 확인이 필요합니다. |
| `tests/elicitationIntegration.test.ts` | `ElicitRequestSchema` import를 제거하고 `setRequestHandler('elicitation/create', ...)`로 바꿉니다. |
| `tests/elicitationIntegration.test.ts` | `callTool(call, undefined, options)`를 `callTool(call, options)`로 바꿉니다. |
| `tests/elicitationIntegration.test.ts` | 클라이언트 capability를 문서의 형식인 `{ elicitation: { form: {} } }`로 바꿉니다. |
| `tests/scaffold/attachmentDecision.test.ts` | `server` 스텁을 `request` 스텁으로 바꾸고, `signal`을 스텁에서 전달합니다. |
| 신규 (2단계) | 첫 호출의 `input_required` 반환, 재호출의 `accept`, `decline`, `cancel` 처리, 2025-11-25 연결의 legacy shim 경로를 검증합니다. |

## 5. 권장 전환 순서

1. `egovframe-mcp-check`, `egovframe-mcp-search`도 같은 SDK를 사용하므로 세 저장소의 전환 시점을 정합니다. 커밋은 저장소별로 나눕니다.
2. 의존성, import, 핸들러 인자를 바꾸고 4.3의 1단계를 적용합니다. 전체 테스트와 골든 파일을 확인합니다.
3. 대상 클라이언트의 2026-07-28 지원 현황을 확인합니다.
4. 4.4의 2단계를 적용합니다.
5. 실제 AI 클라이언트에서 질문 UI와 `decline`, `cancel` 동작을 확인합니다.

## 6. 참고 문서

- beta Elicitation: <https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.0.0-beta.1/docs/servers/elicitation.md>
- main Elicitation: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/elicitation.md>
- main Input required: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/servers/input-required.md>
- main 프로토콜 버전: <https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md>
- main 마이그레이션 자료: <https://github.com/modelcontextprotocol/typescript-sdk/tree/main/skills/mcp-typescript-sdk-upgrade-to-v2/references>
- beta 마이그레이션 가이드: <https://github.com/modelcontextprotocol/typescript-sdk/blob/v2.0.0-beta.1/docs/migration/upgrade-to-v2.md>
