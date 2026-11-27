# 배포 패키지 제작 가이드

이 문서는 배포 파일(`egovframe-mcp-codegen-<버전>.tgz`)을 만들고 점검하는 방법을 설명합니다. 만들어진 파일을 AI 클라이언트에 등록하는 방법은 [설치와 MCP 클라이언트 등록 가이드](../setup/MCP_SETUP_GUIDE.md)에 있습니다.

## 배포 파일의 구성

배포 파일은 `npm pack` 이 만드는 tgz 입니다. `package.json` 의 다음 설정이 내용물을 결정합니다.

| 설정 | 값 | 의미 |
|------|-----|------|
| `files` | `build`, `templates` | 컴파일된 서버 코드와 Handlebars 템플릿, 매니페스트, KRDS 정적 자산을 넣습니다. `package.json`, `README.md`, `LICENSE` 는 npm 이 항상 함께 넣습니다. |
| `bundleDependencies` | `true` | `dependencies` 에 선언한 패키지와 그 하위 의존 패키지를 `node_modules` 째로 tgz 에 넣습니다. 그래서 설치할 때 npm 레지스트리에 접속하지 않습니다. |
| `bin` | 명령 `egovframe-mcp-codegen` 을 `./build/index.js` 에 연결 | `npx --package=<tgz> egovframe-mcp-codegen` 으로 실행할 수 있게 합니다. |

실행에 필요한 의존 패키지(`@modelcontextprotocol/sdk`, `handlebars`, `node-sql-parser`, `fs-extra`, `zod`)는 모두 순수 JavaScript 입니다. 네이티브 바이너리가 없으므로 운영체제나 CPU 별로 파일을 따로 만들지 않고, 하나의 tgz 를 Windows, macOS, Linux 에서 공통으로 사용합니다.

`devDependencies`(TypeScript, vitest 등)는 tgz 에 들어가지 않습니다. `npm pack` 이 `dependencies` 의 의존 관계만 따라가서 묶기 때문입니다.

## 만드는 방법

```bash
npm run pack:bundle
```

이 명령은 `scripts/pack-bundle.sh` 를 실행하며, 스크립트는 다음 순서로 동작합니다.

1. `node_modules` 를 지우고 `npm ci` 로 `package-lock.json` 에 기록된 버전을 다시 설치합니다. 이 단계에서 네트워크가 필요합니다.
2. `npm pack --pack-destination dist` 를 실행합니다. `npm pack` 은 먼저 `prepare` 스크립트(`npm run build`)를 실행해서 `build/` 를 만든 다음 tgz 를 묶습니다.
3. 결과물인 `dist/egovframe-mcp-codegen-<버전>.tgz` 의 크기를 출력합니다.

파일 이름의 버전은 `package.json` 의 `version` 에서 옵니다. 서버가 MCP 클라이언트에 알리는 이름과 버전도 같은 `package.json` 에서 읽으므로(`src/index.ts`), 버전은 `package.json` 과 `package-lock.json` 두 곳만 고치면 됩니다.

`dist/` 와 `*.tgz` 는 `.gitignore` 에 등록되어 있어 저장소에 들어가지 않습니다.

### 묶기 전에 확인할 것

- `npm test` 가 통과하는지 확인합니다.
- `tsc` 는 `build/` 를 비우지 않고 덮어쓰기만 합니다. 소스에서 삭제한 모듈의 컴파일 결과가 `build/` 에 남아 있으면 tgz 에도 그대로 들어가므로, 묶기 전에 `build/` 디렉터리를 지우고 시작합니다.

```bash
rm -rf build
npm test
npm run pack:bundle
```

## 만든 파일 점검

### 내용물 확인

```bash
tar -tzf dist/egovframe-mcp-codegen-<버전>.tgz | grep -v node_modules | head -50
```

`package/build/index.js`, `package/templates/stacks.json`, `package/templates/manifests/` 아래의 매니페스트 3개, `package/node_modules/` 가 들어 있어야 합니다.

### 오프라인 실행 확인

npm 캐시를 빈 디렉터리로 지정하고 `--offline` 을 주면, 레지스트리에 접속하지 않고 tgz 만으로 실행되는지 확인할 수 있습니다.

```bash
npm_config_cache=$(mktemp -d) \
  npx -y --offline --package="$PWD/dist/egovframe-mcp-codegen-<버전>.tgz" egovframe-mcp-codegen < /dev/null
```

표준 오류에 `Server started successfully` 로그가 출력되고 종료 코드 0 으로 끝나면 정상입니다.

### 도구 목록 확인

`initialize` 와 `tools/list` 요청을 표준 입력으로 보내면 서버 정보와 도구 4개가 응답으로 돌아옵니다.

```bash
(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'; sleep 10) \
  | npx -y --package="$PWD/dist/egovframe-mcp-codegen-<버전>.tgz" egovframe-mcp-codegen
```

`id` 가 1 인 응답의 `serverInfo` 가 `{"name":"egovframe-mcp-codegen","version":"<버전>"}` 인지, `id` 가 2 인 응답에 `egov_scaffold_project`, `egov_add_entity`, `egov_add_query_view`, `egov_add_attach_file_infrastructure` 가 모두 있는지 확인합니다.

### 체크섬 계산

릴리스 노트와 포털 게시물에 싣는 체크섬은 다음 명령으로 계산합니다.

```bash
md5 dist/egovframe-mcp-codegen-<버전>.tgz          # macOS. Linux 에서는 md5sum
shasum -a 256 dist/egovframe-mcp-codegen-<버전>.tgz
```

tgz 를 다시 만들면 체크섬이 달라집니다. 체크섬을 공개한 뒤에 파일을 다시 만들었다면 [릴리스 노트](../release-notes/)와 포털 게시물의 체크섬도 함께 고칩니다.

## 릴리스 절차 요약

1. `package.json` 과 `package-lock.json` 의 `version` 을 올립니다.
2. `rm -rf build && npm test` 로 전체 테스트를 통과시킵니다.
3. `npm run pack:bundle` 로 tgz 를 만들고, 위의 점검을 수행합니다.
4. 체크섬을 계산해서 `docs/release-notes/` 에 해당 버전의 릴리스 노트를 추가합니다.
5. `develop` 을 `main` 으로 병합하고 `v<버전>` 태그를 만듭니다.
6. tgz 를 표준프레임워크 포털에 올리고, GitHub 릴리스를 작성합니다.
