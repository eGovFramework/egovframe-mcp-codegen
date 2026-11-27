# 생성된 프로젝트의 동작 확인

자동화 테스트(vitest)는 생성된 파일의 텍스트만 검사합니다. 날짜 바인딩, CSRF, 화면의 표현식, 메시지 번들의 인코딩, JOIN 쿼리와 같은 실행 시점의 오류는 프로젝트를 실제로 빌드하고 실행해야 드러납니다. 이 문서는 세 스택의 산출물을 실행해서 확인하는 절차를 설명합니다.

Controller, VO, 화면, 바인딩 설정, `pom.xml` 의 템플릿을 고쳤을 때와 배포 패키지를 만들기 전에 이 절차를 수행합니다.

## 준비물

| 항목 | 용도 |
|------|------|
| JDK 17 | 5.1 Boot 의 빌드와 실행 |
| JDK 8 | 4.3 Boot 와 4.3 WAR 의 빌드와 실행 |
| Maven | 세 스택의 빌드. 의존성이 로컬 저장소에 있으면 `-o`(오프라인)로 빌드할 수 있습니다. |
| Tomcat 8.5 | 4.3 WAR 의 실행. 이 저장소에서는 `references/apache-tomcat-8.5.90` 을 사용합니다. `references/` 는 저장소에 올리지 않는 로컬 전용 디렉터리입니다. |

표준프레임워크의 부모 POM 과 실행환경 라이브러리는 표준프레임워크 Maven 저장소에서 내려받습니다. 처음 빌드할 때에는 네트워크가 필요합니다.

## 절차

### 1. 서버를 빌드하고 도구를 호출한다

`npm run build` 로 서버를 빌드한 뒤, MCP 클라이언트로 `build/index.js` 를 실행해서 도구를 호출합니다. MCP Inspector(`npm run inspector`)에서 직접 호출하거나, 다음과 같이 SDK 의 클라이언트로 스크립트를 작성합니다. 스크립트는 저장소의 `node_modules` 를 찾을 수 있는 위치에서 실행합니다.

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "verify", version: "0" }, { capabilities: {} });
await client.connect(new StdioClientTransport({ command: "node", args: ["build/index.js"] }));

const result = await client.callTool({
  name: "egov_scaffold_project",
  arguments: {
    projectName: "board-app",
    packageName: "egovframework.example.board",
    outputPath: "/tmp/verify",
    entityName: "Board",
    ddl: "CREATE TABLE BOARD ( ... )",
    projectType: "boot",
    stackVersion: "5.1",
    withAttachment: false,
  },
});
console.log(result.content[0].text);
await client.close();
```

이 클라이언트는 Elicitation 을 지원한다고 선언하지 않으므로, `stackVersion` 과 `withAttachment` 를 반드시 지정합니다. 지정하지 않으면 서버가 "사용자에게 물은 뒤 다시 호출하라"는 오류를 돌려줍니다.

세 스택 각각에 대해 다음 순서로 호출합니다.

1. `egov_scaffold_project`: `DATE` 와 `TIMESTAMP` 컬럼, COMMENT 가 들어 있는 DDL 을 사용합니다.
2. `egov_add_entity`: 첫 엔티티를 참조하는 외래키가 있는 엔티티를 `autoApplyMenu=true` 로 추가합니다. Boot 에서는 `withAttachment=true` 인 엔티티도 추가합니다.
3. `egov_add_query_view`: 두 테이블을 JOIN 하는 SQL 로, `Number` 와 `Timestamp` 형식을 지정한 컬럼을 포함해서 추가합니다. `packageName` 은 `<기본 패키지>.<모듈>.report` 처럼 깊은 패키지로도 한 번 호출합니다.
4. 같은 인자로 `egov_add_entity` 를 한 번 더 호출해서, 변경 없이 성공으로 응답하는지 확인합니다.

### 2. 빌드한다

```bash
# 5.1 Boot
JAVA_HOME=<JDK 17 경로> mvn -o -DskipTests clean package

# 4.3 Boot, 4.3 WAR
JAVA_HOME=<JDK 8 경로> mvn -o -DskipTests clean package
```

Boot 는 `target/<projectName>-1.0.0.jar`, WAR 는 `target/<projectName>-1.0.0.war` 가 만들어집니다.

### 3. 실행한다

Boot 는 포트를 지정해서 실행합니다. 세 스택을 동시에 실행해도 됩니다.

```bash
<JDK 경로>/bin/java -jar target/board-app-1.0.0.jar --server.port=18151
```

WAR 는 Tomcat 의 설치 디렉터리를 고치지 않고, `CATALINA_BASE` 를 임시 디렉터리로 분리해서 실행합니다.

```bash
BASE=/tmp/verify/tomcat-base
mkdir -p $BASE/logs $BASE/temp $BASE/webapps $BASE/work
cp -R references/apache-tomcat-8.5.90/conf $BASE/conf
# conf/server.xml 의 포트 8080 과 8005 를 다른 프로그램과 겹치지 않는 값으로 바꾼다
cp target/board-app-1.0.0.war $BASE/webapps/

JAVA_HOME=<JDK 8 경로> CATALINA_HOME=$PWD/references/apache-tomcat-8.5.90 CATALINA_BASE=$BASE \
  references/apache-tomcat-8.5.90/bin/catalina.sh start
```

WAR 의 컨텍스트 경로는 WAR 파일의 이름(`/board-app-1.0.0`)입니다. 확인이 끝나면 같은 환경 변수로 `catalina.sh stop` 을 실행합니다.

### 4. 요청을 보내서 확인한다

`curl` 이나 브라우저로 다음을 확인합니다. URL 은 [생성되는 프로젝트](../reference/GENERATED_PROJECT.md)의 "화면과 URL"에 있습니다.

| 확인 항목 | 기준 |
|-----------|------|
| 진입 URL 과 목록 화면 | 200 으로 응답하고, 제목과 컬럼 머리글이 COMMENT 의 한글 라벨로 보입니다. |
| 정적 자산 | `/css/component/output.css`, `/js/component/ui-script.js`, 아이콘 SVG 하나, 글꼴 파일 하나가 200 으로 응답합니다. |
| 등록 | 등록한 뒤에 자기 목록 화면으로 이동합니다. 응답의 상태 코드뿐 아니라 `Location` 헤더가 `/egov<E>List.do` 인지 확인합니다. |
| 수정과 삭제 | 날짜 컬럼이 있는 레코드를 수정하고 삭제합니다. 날짜가 `yyyy-MM-dd` 로 표시되는지 확인합니다. |
| 선택 입력 | 선택 입력 항목을 비운 채로 저장합니다. |
| 잘못된 입력 | 필수 항목을 비우거나 날짜 형식이 틀린 값을 보내서, 오류가 화면에 표시되는지 확인합니다. |
| 검색과 페이지 이동 | 검색 조건(`searchCondition`)에 순번을 넣어서 검색합니다. 페이지네이션 마크업에 `page-links` 가 있는지 확인합니다. |
| 외래키 | 등록 화면에 참조 엔티티의 콤보 상자가 보이고, 목록에 참조 엔티티의 표시 컬럼이 보입니다. |
| 조회 화면 | 200 으로 응답하고 `Number` 와 `Timestamp` 컬럼이 지정한 형식으로 보입니다. |
| 메뉴 | 추가한 엔티티와 조회 화면이 메뉴에 보이고, 현재 화면의 메뉴가 강조됩니다. |
| 첨부파일 (Boot) | `file_1` 로 파일을 올리고, 수정 화면의 다운로드 링크로 받은 내용이 올린 파일과 같은지 확인합니다. 실행 파일 확장자를 올리면 오류 화면이 보이는지 확인합니다. |
| CSRF (5.1 Boot) | 토큰 없이 POST 요청을 보내면 403 으로 응답합니다. |

요청을 스크립트로 보낼 때에는 다음을 알아 두어야 합니다.

- 5.1 Boot 의 POST 요청에는 CSRF 토큰이 필요합니다. 목록 화면의 `<meta name="_csrf">` 에서 토큰을 읽고, 요청의 `_csrf` 파라미터로 보냅니다. 세션 쿠키도 함께 유지해야 합니다.
- 기본 키는 자동 채번되므로(예: `BOARD-00001`) 스크립트가 값을 정하지 않고, 등록한 뒤에 목록 화면에서 읽어 옵니다. 목록의 행은 Boot 에서 `boardDetail(&quot;BOARD-00001&quot;)`, WAR 에서 `fn_egov_select('BOARD-00001')` 의 형태로 기본 키를 담고 있습니다.
- 검색 조건에 순번이 아닌 값을 넣으면 500 으로 응답합니다. 화면에서는 이런 값이 전송되지 않습니다.

### 5. 브라우저로 확인한다

화면 템플릿을 고쳤으면 브라우저에서도 확인합니다.

- 세 스택의 화면을 나란히 놓고 모양이 같은지 비교합니다.
- 4.3 Boot 의 목록에서 검색과 페이지 이동을 실제로 눌러 보고, 브라우저 콘솔에 오류가 없는지 확인합니다.
- 날짜 입력란을 눌렀을 때 달력이 뜨는지 확인합니다.
- Boot 를 `--server.servlet.context-path=/app` 으로 실행해서, 컨텍스트 경로 아래에서도 정적 자산, 메뉴의 강조, 버튼이 보내는 요청의 주소가 올바른지 확인합니다.

## 한글 인코딩의 확인

운영체제의 기본 인코딩이 UTF-8 이 아닌 환경에서 한글이 깨지지 않는지는, Boot 의 JAR 를 `-Dfile.encoding=MS949` 로 실행해서 확인합니다. 등록 화면과 첨부파일 오류 화면(`cmm/uploadError`)처럼 템플릿에 한글이 직접 들어 있는 화면을 봅니다.

## 확인을 마친 뒤

실행한 서버를 모두 종료하고, 확인에 쓴 임시 디렉터리를 지웁니다. 확인하면서 찾은 문제 가운데 바로 고치지 않는 것은 [알려진 문제와 제약 사항](./KNOWN_ISSUES.md)에 기록합니다.
