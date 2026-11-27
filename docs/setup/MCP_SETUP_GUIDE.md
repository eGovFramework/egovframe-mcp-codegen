# 설치와 MCP 클라이언트 등록 가이드

이 문서는 `egovframe-mcp-codegen` 서버를 AI 클라이언트(MCP 클라이언트)에 등록하는 방법을 설명합니다. 배포 파일(tgz)을 만드는 방법은 [배포 패키지 제작 가이드](../operations/PACKAGING_GUIDE.md)에서 다룹니다.

## 요구 사항

| 항목 | 내용 |
|------|------|
| Node.js | 18 이상 (22 권장). `node -v` 로 확인합니다. |
| npm, npx | Node.js 에 포함된 것을 그대로 사용합니다. |
| JDK, Maven | 서버 실행에는 필요하지 않습니다. 생성된 프로젝트를 빌드하고 실행할 때 필요하며, 5.1 Boot 는 JDK 17, 4.3 Boot 와 4.3 WAR 는 JDK 8 을 기준으로 합니다. |
| 운영체제와 CPU | 서버는 네이티브 모듈을 쓰지 않으므로 운영체제나 CPU 에 따라 배포 파일이 달라지지 않습니다. |

## 배포 파일 내려받기

[표준프레임워크 포털](https://www.egovframe.go.kr/home/sub.do?menuNo=114)에서 다음 파일을 내려받아 로컬 디스크에 둡니다. 압축은 풀지 않습니다.

| 운영체제와 CPU | 파일 |
|----------------|------|
| 모든 운영체제 공통 | `egovframe-mcp-codegen-5.1.0.tgz` |

- 실행에 필요한 의존 패키지가 모두 들어 있으므로, 등록한 뒤에는 네트워크에 접속하지 않고 실행됩니다.
- 파일의 체크섬은 [릴리스 노트](../release-notes/v5.1.0-beta.md#체크섬)에 있습니다.

## 서버 실행 명령

모든 클라이언트는 다음 명령으로 서버를 실행합니다. `npx` 가 tgz 를 사용자 캐시에 설치한 다음, 패키지의 실행 파일인 `egovframe-mcp-codegen` 을 실행합니다. 이 문서의 예시에서 `<TGZ>` 는 내려받은 tgz 파일의 절대 경로입니다.

| 운영체제 | 실행 명령 |
|----------|-----------|
| macOS, Linux | `npx -y --package=<TGZ> egovframe-mcp-codegen` |
| Windows | `cmd /c npx -y --package=<TGZ> egovframe-mcp-codegen` |

- **경로는 절대 경로로 적습니다.** 클라이언트가 서버를 어느 디렉터리에서 실행할지 알 수 없으므로, 상대 경로는 쓰지 않습니다. macOS, Linux 의 예는 `/opt/egovframe-mcp/egovframe-mcp-codegen-5.1.0.tgz` 이고, Windows 의 예는 `C:/egovframe-mcp/egovframe-mcp-codegen-5.1.0.tgz` 입니다.
- **Windows 에서는 `cmd /c` 로 감쌉니다.** `npx` 가 배치 파일(`npx.cmd`)이어서 클라이언트가 직접 실행하지 못하는 경우가 있기 때문입니다.
- **포트를 열지 않습니다.** 이 서버는 stdio 로 통신하는 MCP 서버입니다. 포트를 열고 계속 실행되는 서비스가 아니며, AI 클라이언트가 필요할 때 프로세스를 실행합니다.

### 등록하기 전에 실행해 보기

클라이언트에 등록하기 전에, 클라이언트를 실행할 운영체제 계정으로 터미널에서 서버를 한 번 실행해 봅니다. 이렇게 하면 `npx` 캐시가 미리 채워지고, 경로를 잘못 적었는지도 바로 확인할 수 있습니다.

```bash
# macOS, Linux
npx -y --package=<TGZ> egovframe-mcp-codegen < /dev/null

# Windows
npx -y --package=<TGZ> egovframe-mcp-codegen < NUL
```

터미널에 `Server started successfully` 가 들어 있는 `[egovframe-mcp-codegen]` 로그가 출력되고 곧 종료되면 정상입니다. 이 문구는 표준 오류(stderr)로 출력되는 로그이며, 표준 출력은 MCP 프로토콜 메시지 전용입니다.

서버 시작에는 수 초가 걸립니다. macOS 와 Node.js 22 환경에서 측정한 값은 첫 실행이 약 6초, 그 뒤의 실행이 약 5초였습니다. 서버 시작 대기 시간이 짧은 클라이언트(예: 기본값이 10초인 Codex)에서 시간 초과가 발생하면, 클라이언트의 대기 시간을 늘리거나 아래의 [압축을 풀어서 직접 실행](#압축을-풀어서-직접-실행) 방식을 사용합니다.

## 공통 JSON 형식

`mcpServers` 형식을 쓰는 클라이언트에 공통으로 적용되는 설정입니다. 설정 파일에 `mcpServers` 항목이 이미 있으면, 그 안에 `egovframe-mcp-codegen` 항목만 추가합니다.

**macOS, Linux**

```json
{
  "mcpServers": {
    "egovframe-mcp-codegen": {
      "command": "npx",
      "args": ["-y", "--package=<TGZ>", "egovframe-mcp-codegen"]
    }
  }
}
```

**Windows**

```json
{
  "mcpServers": {
    "egovframe-mcp-codegen": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "--package=<TGZ>", "egovframe-mcp-codegen"]
    }
  }
}
```

- JSON 문자열 안에서는 Windows 경로에 슬래시를 쓰거나(`C:/egovframe-mcp/...`) 역슬래시를 두 번씩 적습니다(`C:\\egovframe-mcp\\...`).
- 클라이언트가 셸의 `PATH` 를 물려받지 않아 `npx` 를 찾지 못하면 `command` 에 `npx` 의 절대 경로를 적습니다. 경로는 macOS/Linux 에서는 `which npx`, Windows 에서는 `where npx` 로 확인합니다.
- tgz 를 새 버전으로 바꾸면 파일 이름이 달라지므로 등록한 경로도 함께 고칩니다.

## AI 클라이언트별 등록

| AI 클라이언트 | 등록 방법 | 유의 사항 |
|---------------|-----------|-----------|
| [Claude Code](#claude-code) | `claude mcp add` 명령 또는 `~/.claude.json` (Windows 는 `%USERPROFILE%\.claude.json`) | 공통 JSON 형식 |
| [Codex](#codex) | `codex mcp add` 명령 또는 `~/.codex/config.toml` (Windows 는 `%USERPROFILE%\.codex\config.toml`) | TOML 형식. 시간 초과가 발생하면 `startup_timeout_sec` 추가 |
| [Cursor](#cursor) | `~/.cursor/mcp.json` (Windows 는 `%USERPROFILE%\.cursor\mcp.json`) | 공통 JSON 형식에 `"type": "stdio"` 추가 |
| [VS Code (GitHub Copilot)](#vs-code-github-copilot) | `~/.copilot/mcp-config.json` (Windows 는 `%USERPROFILE%\.copilot\mcp-config.json`) | 공통 JSON 형식에 `"tools": ["*"]`, `"type": "stdio"` 추가 |
| [Cline](#cline) | Cline 패널의 MCP Servers 에서 여는 `cline_mcp_settings.json` | 공통 JSON 형식 |
| [OpenCode](#opencode) | `opencode mcp add` 명령 | `--global` 옵션으로 전역 등록 |
| [Claude Desktop](#claude-desktop) | `claude_desktop_config.json` | 공통 JSON 형식. 등록한 뒤 앱을 다시 실행 |

### Claude Code

CLI 로 등록하는 방법을 권장합니다.

```bash
# macOS, Linux
claude mcp add --scope user egovframe-mcp-codegen -- npx -y --package=<TGZ> egovframe-mcp-codegen

# Windows
claude mcp add --scope user egovframe-mcp-codegen -- cmd /c npx -y --package=<TGZ> egovframe-mcp-codegen
```

`--scope user` 는 모든 프로젝트에서 이 서버를 쓰도록 등록한다는 뜻입니다. 등록 상태는 `claude mcp list` 또는 세션 안의 `/mcp` 로 확인합니다.

설정 파일로 등록하려면 `~/.claude.json`(Windows 는 `%USERPROFILE%\.claude.json`)의 최상위 `mcpServers` 에 [공통 JSON 형식](#공통-json-형식)의 `egovframe-mcp-codegen` 항목을 추가합니다.

### Codex

CLI 로 등록합니다.

```bash
# macOS, Linux
codex mcp add egovframe-mcp-codegen -- npx -y --package=<TGZ> egovframe-mcp-codegen

# Windows
codex mcp add egovframe-mcp-codegen -- cmd /c npx -y --package=<TGZ> egovframe-mcp-codegen
```

설정 파일로 등록하려면 `~/.codex/config.toml`(Windows 는 `%USERPROFILE%\.codex\config.toml`)에 다음 내용을 추가합니다. 최상위 키는 `mcp_servers` 입니다.

**macOS, Linux**

```toml
[mcp_servers.egovframe-mcp-codegen]
command = "npx"
args = ["-y", "--package=<TGZ>", "egovframe-mcp-codegen"]
```

**Windows**

```toml
[mcp_servers.egovframe-mcp-codegen]
command = "cmd"
args = ["/c", "npx", "-y", "--package=<TGZ>", "egovframe-mcp-codegen"]
```

Codex 는 서버 시작을 기본 10초까지만 기다립니다. 시간 초과가 발생하면 같은 항목에 `startup_timeout_sec = 60` 을 추가합니다.

### Cursor

설정 파일 `~/.cursor/mcp.json`(Windows 는 `%USERPROFILE%\.cursor\mcp.json`)에 다음 형식으로 추가합니다.

**macOS, Linux**

```json
{
  "mcpServers": {
    "egovframe-mcp-codegen": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "--package=<TGZ>", "egovframe-mcp-codegen"]
    }
  }
}
```

**Windows**

```json
{
  "mcpServers": {
    "egovframe-mcp-codegen": {
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "--package=<TGZ>", "egovframe-mcp-codegen"]
    }
  }
}
```

### VS Code (GitHub Copilot)

설정 파일 `~/.copilot/mcp-config.json`(Windows 는 `%USERPROFILE%\.copilot\mcp-config.json`)에 다음 형식으로 추가합니다.

**macOS, Linux**

```json
{
  "mcpServers": {
    "egovframe-mcp-codegen": {
      "tools": ["*"],
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "--package=<TGZ>", "egovframe-mcp-codegen"]
    }
  }
}
```

**Windows**

```json
{
  "mcpServers": {
    "egovframe-mcp-codegen": {
      "tools": ["*"],
      "type": "stdio",
      "command": "cmd",
      "args": ["/c", "npx", "-y", "--package=<TGZ>", "egovframe-mcp-codegen"]
    }
  }
}
```

VS Code 의 워크스페이스 설정 파일(`<프로젝트 루트>/.vscode/mcp.json`)에 등록할 때에는 최상위 키가 `mcpServers` 가 아니라 `servers` 입니다. Windows 에서는 `command` 와 `args` 를 위의 Windows 예시와 같게 적습니다.

```json
{
  "servers": {
    "egovframe-mcp-codegen": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "--package=<TGZ>", "egovframe-mcp-codegen"]
    }
  }
}
```

등록한 뒤에 Copilot Chat 을 에이전트 모드로 전환하면 도구가 보입니다.

### Cline

VS Code 의 Cline 패널에서 MCP Servers 아이콘, Configure 탭, Configure MCP Servers 를 차례로 누르면 `cline_mcp_settings.json` 파일이 열립니다. 이 파일에 [공통 JSON 형식](#공통-json-형식)의 `egovframe-mcp-codegen` 항목을 추가합니다. 파일을 저장하면 Cline 이 서버에 다시 연결합니다.

### OpenCode

CLI 로 등록하는 방법을 권장합니다.

```bash
# macOS, Linux
opencode mcp add egovframe-mcp-codegen --global -- npx -y --package=<TGZ> egovframe-mcp-codegen

# Windows
opencode mcp add egovframe-mcp-codegen --global -- cmd /c npx -y --package=<TGZ> egovframe-mcp-codegen
```

설정 파일(`~/.config/opencode/opencode.json`)에 직접 적을 때에는 형식이 다른 클라이언트와 다릅니다. 최상위 키는 `mcp` 이고, `command` 하나에 명령과 인자를 모두 배열로 적습니다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "egovframe-mcp-codegen": {
      "type": "local",
      "command": ["npx", "-y", "--package=<TGZ>", "egovframe-mcp-codegen"],
      "enabled": true
    }
  }
}
```

### Claude Desktop

설정 파일에 [공통 JSON 형식](#공통-json-형식)의 `egovframe-mcp-codegen` 항목을 추가하고, 앱을 완전히 종료했다가 다시 실행합니다. 앱의 Settings, Developer 탭, Edit Config 를 차례로 누르면 설정 파일이 열립니다.

| 운영체제 | 설정 파일 |
|----------|-----------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

Claude Desktop 과 같은 GUI 앱은 셸의 `PATH` 를 그대로 물려받지 않을 수 있습니다. nvm 이나 Homebrew 로 Node.js 를 설치한 환경에서 서버가 시작되지 않으면, `command` 에 `npx` 의 절대 경로(`which npx` 로 확인)를 적습니다.

## 등록 확인

등록이 끝나면 클라이언트의 도구 목록에 다음 도구 4개가 보입니다.

| 도구 | 설명 |
|------|------|
| `egov_scaffold_project` | DDL 로 표준프레임워크 프로젝트를 새로 생성 |
| `egov_add_entity` | 기존 프로젝트에 새 엔티티의 CRUD 코드를 추가 |
| `egov_add_query_view` | 다중 JOIN `SELECT` 문으로 조회 전용 화면을 추가 |
| `egov_add_attach_file_infrastructure` | Boot 프로젝트에 표준 첨부파일 인프라를 설치 |

도구별 인자와 동작은 [도구 레퍼런스](../reference/TOOLS_OVERVIEW.md)에 있습니다.

## 다른 실행 형태

### 압축을 풀어서 직접 실행

배포 tgz 는 압축을 풀기만 하면 `node_modules` 까지 갖춘 실행 가능한 디렉터리가 됩니다. 그래서 `npx` 를 거치지 않고 `node` 로 진입점을 직접 실행할 수 있습니다. 이 방식에서는 `npx` 캐시를 쓰지 않으므로 서버가 바로 시작되고, Windows 에서 `cmd /c` 로 감쌀 필요도 없습니다.

```bash
mkdir -p /opt/egovframe-mcp/codegen
tar -xzf <TGZ> -C /opt/egovframe-mcp/codegen
node /opt/egovframe-mcp/codegen/package/build/index.js < /dev/null
```

클라이언트에는 `command` 에 `node`(또는 `node` 의 절대 경로), `args` 에 `package/build/index.js` 의 절대 경로를 적습니다.

```json
{
  "mcpServers": {
    "egovframe-mcp-codegen": {
      "command": "node",
      "args": ["/opt/egovframe-mcp/codegen/package/build/index.js"]
    }
  }
}
```

새 버전의 tgz 로 바꿀 때에는 압축을 다시 풀어야 합니다.

### 저장소를 클론해서 실행

서버를 수정하거나 개발 중인 버전을 쓰려면 저장소를 클론해서 빌드합니다.

```bash
git clone https://github.com/eGovFramework/egovframe-mcp-codegen.git
cd egovframe-mcp-codegen
npm install    # prepare 스크립트가 빌드(npm run build)까지 실행합니다
```

클라이언트에는 `command` 에 `node`, `args` 에 `<저장소 경로>/build/index.js` 의 절대 경로를 적습니다.

```json
{
  "mcpServers": {
    "egovframe-mcp-codegen": {
      "command": "node",
      "args": ["/absolute/path/to/egovframe-mcp-codegen/build/index.js"]
    }
  }
}
```

## 환경 변수

서버는 환경 변수 없이 동작합니다. 템플릿 디렉터리(`templates/`)는 실행 디렉터리가 아니라 `build/index.js` 가 놓인 패키지 위치를 기준으로 찾으므로, 클라이언트가 어느 디렉터리에서 서버를 실행하든 결과가 같습니다.

템플릿을 다른 위치에 두고 써야 하는 경우에만 다음 변수를 클라이언트 등록의 `env` 에 지정합니다. 코드는 이 밖의 환경 변수를 읽지 않습니다.

| 환경 변수 | 설명 | 기본값 |
|-----------|------|--------|
| `EGOVFRAME_SCAFFOLD_TEMPLATE_PATH` | 템플릿 디렉터리의 절대 경로. 매니페스트(`manifests/*.json`), 스택 정의(`stacks.json`), Handlebars 템플릿을 이 디렉터리에서 읽습니다. | 패키지의 `templates/` |
| `EGOVFRAME_STACK_MATRIX_PATH` | 스택 정의 파일(`stacks.json`)의 경로. 이 파일만 다른 위치에 둘 때 지정하며, 위의 변수보다 먼저 적용됩니다. | `<템플릿 디렉터리>/stacks.json` |

## 사용자 확인(Elicitation)을 지원하지 않는 클라이언트

`egov_scaffold_project` 와 `egov_add_entity` 는 스택 버전이나 첨부파일 포함 여부가 지정되지 않으면 MCP Elicitation 으로 사용자에게 직접 묻습니다. 클라이언트가 Elicitation 을 지원하지 않으면 서버는 파일을 만들지 않고 오류를 돌려주며, 이 오류에는 사용자에게 물어본 뒤 해당 인자를 지정해서 다시 호출하라는 안내가 들어 있습니다. AI 가 이 안내에 따라 사용자에게 묻고 다시 호출하므로, 어느 클라이언트에서나 생성은 끝까지 진행됩니다. 자세한 동작은 [사용자 확인 흐름](../architecture/USER_CONFIRMATION.md)에 있습니다.

## 문제 해결

| 증상 | 확인할 것 |
|------|-----------|
| 클라이언트에 서버가 보이지 않거나 시작하자마자 종료됨 | `--package=` 뒤의 경로가 절대 경로인지, 그 위치에 tgz 파일이 실제로 있는지 확인합니다. 터미널에서 [등록하기 전에 실행해 보기](#등록하기-전에-실행해-보기)의 명령을 실행하면 오류의 원인이 출력됩니다. |
| Windows 에서 `spawn npx ENOENT` 또는 "program not found" | `npx` 를 직접 실행하지 못하는 경우입니다. `command` 를 `cmd` 로, `args` 를 `["/c", "npx", ...]` 로 바꿉니다. |
| macOS 의 GUI 앱에서 `spawn npx ENOENT` | 앱이 셸의 `PATH` 를 물려받지 못한 경우입니다. `command` 에 `which npx` 로 확인한 절대 경로를 적습니다. |
| 서버 시작 시간 초과 | 터미널에서 서버를 한 번 실행해서 `npx` 캐시를 채운 뒤에 다시 연결합니다. 계속되면 클라이언트의 시작 대기 시간을 늘리거나, [압축을 풀어서 직접 실행](#압축을-풀어서-직접-실행) 방식으로 바꿉니다. |
| `ERR_MODULE_NOT_FOUND: Cannot find package ...` 로 서버가 종료됨 | `npx` 캐시에 설치가 끝나지 않은 상태가 남은 경우입니다. 첫 설치 도중에 클라이언트가 서버를 강제로 종료하면 이렇게 될 수 있으며, `npx` 는 이 캐시를 다시 검사하지 않고 계속 사용합니다. 캐시 디렉터리(macOS, Linux 는 `~/.npm/_npx`, Windows 는 `%LOCALAPPDATA%\npm-cache\_npx`)를 지우고, 클라이언트를 켜기 전에 터미널에서 서버를 한 번 실행합니다. |
| 도구가 "사용자에게 물은 뒤 다시 호출하라"는 오류를 반환함 | 클라이언트가 Elicitation 을 지원하지 않을 때의 정상 동작입니다. AI 의 질문에 답하면 인자를 채워서 다시 호출합니다. |
| 새 버전의 tgz 로 바꿨는데 이전 버전이 실행됨 | 파일 이름에 버전이 들어 있으므로, 클라이언트 설정의 `--package=` 경로를 새 파일로 바꾸고 서버를 다시 시작합니다. |
