/**
 * 생성 산출물의 결정적(deterministic) 자체 검증.
 *
 * 도구가 "성공"이라고 보고했는데 실제로는 Handlebars 렌더링 누락이나 XML 태그
 * 불균형 같은 생성기 내부 버그로 깨진 파일을 내보내면, 호출자(LLM)는 무엇이
 * 잘못됐는지 알 수 없어 같은 인자로 재시도를 반복하거나(무한 루프) 잘못된
 * 산출물을 그대로 사용자에게 전달하게 된다. 이 모듈은 디스크에 쓰기 *전에*
 * 렌더 결과를 훑어 이런 생성기 버그를 조기에 잡아낸다.
 *
 * 두 검사 모두 "생성기가 정상일 때 0 오탐" 을 최우선 목표로 설계했다 — 오탐이
 * 잦으면 정상 산출물까지 거부되어 오히려 재시도 루프를 유발하기 때문이다
 * (checkPlaceholderResidue 는 tests/scaffold/__golden__ 시나리오의 실제 렌더
 * 결과 + FK/첨부파일/idGeneration=manual/query view 등 주요 옵션 조합으로 사전
 * 검증했다. checkXmlStructure 는 확신이 없는 케이스(속성 값 안의 '<'/'>' ,
 * 중첩 CDATA/주석 등)에서 과탐 대신 미탐을 택하도록 보수적으로 구현했다).
 */

/** 검증 대상 파일 1건 — 상대 경로와 렌더링된 전체 내용. */
export interface ValidatableFile {
  relPath: string;
  content: string;
}

/**
 * Handlebars 태그의 "잔존" 형태만 좁게 매칭하는 패턴.
 *
 * 임의의 텍스트에 우연히 등장하는 `{{`/`}}` (예: 사용자 description 에 들어간
 * 중괄호, JSON 스니펫, CSS 블록)를 오탐하지 않도록, `{{` 뒤에 실제 Handlebars
 * 문법으로 해석될 수 있는 토큰(식별자·헬퍼·`#`/`/`/`^`/`>` 섹션·`!` 주석·`else`)이
 * 바로 이어지는 경우만 매칭한다.
 *
 * 매칭 대상 예시: `{{entityName}}`, `{{#if x}}`, `{{/if}}`, `{{> partial}}`,
 * `{{! comment}}`, `{{{unescaped}}}`, `{{@index}}`, `{{this.foo}}`.
 * 매칭하지 않는 예시: `{{ 이상함 }}` (비-ASCII 시작), `{"key": "value"}`
 * (단일 중괄호), `{{}}` (내용 없음).
 */
const HANDLEBARS_IDENTIFIER = `[A-Za-z_@.][\\w.\\-\\[\\]'"]*`;
const HANDLEBARS_OPEN = `\\{\\{\\{?~?\\s*`;
const HANDLEBARS_CLOSE = `~?\\}\\}\\}?`;
const HANDLEBARS_COMMENT = `!(?:--[\\s\\S]*?--)?[^{}]*`;
const HANDLEBARS_ELSE = `else\\b[^{}]*`;
const HANDLEBARS_TAG_BODY = `(?:[#\\^/>]\\s*)?${HANDLEBARS_IDENTIFIER}[^{}]*`;

const HANDLEBARS_RESIDUE_RE = new RegExp(
  `${HANDLEBARS_OPEN}(?:${HANDLEBARS_COMMENT}|${HANDLEBARS_ELSE}|${HANDLEBARS_TAG_BODY})${HANDLEBARS_CLOSE}`,
  "g",
);

/**
 * 렌더링된 파일들에서 Handlebars 잔존 토큰(`{{...}}`, `{{#...}}`, `{{/...}}` 등)을
 * 찾아 "파일:라인 — 잔존 토큰" 형식의 목록으로 반환한다. 잔존이 없으면 빈 배열.
 *
 * 주의: 이 검사는 Handlebars 로 렌더된 파일에만 적용한다. `fs.copy` 로 템플릿에서
 * 그대로 복사되는 정적 리소스(static/static50, skills, docs 등)에는 적용하지 않는다 —
 * 그 파일들은 애초에 Handlebars 컴파일을 거치지 않으므로 `{{` 가 있어도 잔존이 아니다.
 */
export function checkPlaceholderResidue(files: ValidatableFile[]): string[] {
  const issues: string[] = [];
  for (const file of files) {
    const lines = file.content.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes("{{")) continue;
      const matches = line.match(HANDLEBARS_RESIDUE_RE);
      if (!matches) continue;
      for (const token of matches) {
        issues.push(`${file.relPath}:${i + 1} — 잔존 Handlebars 토큰: ${token.trim()}`);
      }
    }
  }
  return issues;
}

/** XML 태그 추출용 결합 정규식의 부분 패턴들. */
const XML_COMMENT = `<!--[\\s\\S]*?-->`;
const XML_CDATA = `<!\\[CDATA\\[[\\s\\S]*?\\]\\]>`;
const XML_PI = `<\\?[\\s\\S]*?\\?>`;
const XML_DOCTYPE = `<!DOCTYPE[^>]*>`;
// 속성 값(따옴표로 감싼 구간) 안의 '<'/'>' 는 태그 경계로 오인하지 않도록 별도 분기로 소비한다.
const XML_TAG = `<(\\/?)([A-Za-z_][\\w:.\\-]*)((?:"[^"]*"|'[^']*'|[^"'>])*?)(\\/?)>`;

const XML_TOKEN_RE = new RegExp(
  `(?:${XML_COMMENT})|(?:${XML_CDATA})|(?:${XML_PI})|(?:${XML_DOCTYPE})|(?:${XML_TAG})`,
  "g",
);

interface OpenTagFrame {
  name: string;
  line: number;
}

/**
 * `.xml` 산출물의 최소 태그 균형(짝 맞음) 검사. 새 런타임 의존성 없이 정규식 기반
 * 토큰화만으로 구현한다. XML 선언(`<?xml ... ?>`), DOCTYPE, 주석(`<!-- -->`),
 * CDATA(`<![CDATA[ ]]>`), 자기닫힘 태그(`<tag/>`)는 안전하게 건너뛴다.
 *
 * 보수적 구현: 속성 값 안의 `<`/`>`, 주석/CDATA 안의 가짜 태그 등 애매한 케이스는
 * 태그로 오인하지 않도록 우선 처리했다. 그래도 확신이 서지 않는 잔여 케이스는
 * 과탐(정상 파일을 실패 처리)보다 미탐(놓침)을 택한다 — 예를 들어 짝이 안 맞는
 * 닫는 태그를 만나도 매칭되는 여는 태그를 스택에서 찾지 못하면 그 시점 이후의
 * 스택 상태는 건드리지 않고 해당 건만 보고한다.
 */
export function checkXmlStructure(relPath: string, content: string): string[] {
  const issues: string[] = [];
  const stack: OpenTagFrame[] = [];

  let lineNo = 1;
  let scannedUpTo = 0;
  const lineAt = (idx: number): number => {
    for (; scannedUpTo < idx; scannedUpTo++) {
      if (content.charCodeAt(scannedUpTo) === 10 /* \n */) lineNo++;
    }
    return lineNo;
  };

  const re = new RegExp(XML_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const full = m[0];
    if (
      full.startsWith("<!--") ||
      full.startsWith("<![CDATA[") ||
      full.startsWith("<?") ||
      /^<!DOCTYPE/i.test(full)
    ) {
      continue; // 주석/CDATA/선언/PI/DOCTYPE — 태그 균형 검사 대상 아님
    }

    const closingSlash = m[1];
    const tagName = m[2];
    const selfClosingSlash = m[4];
    if (!tagName) continue;

    const ln = lineAt(m.index);

    if (closingSlash === "/") {
      // 닫는 태그 — 스택에서 같은 이름을 뒤에서부터 찾는다.
      const idx = (() => {
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].name === tagName) return i;
        }
        return -1;
      })();
      if (idx === -1) {
        issues.push(`${relPath}:${ln} — 대응하는 여는 태그 없이 </${tagName}> 가 나타났습니다.`);
      } else if (idx !== stack.length - 1) {
        const skipped = stack
          .slice(idx + 1)
          .map((s) => `<${s.name}> (라인 ${s.line})`)
          .join(", ");
        issues.push(
          `${relPath}:${ln} — </${tagName}> 전에 닫히지 않은 태그가 있습니다: ${skipped}`,
        );
        stack.length = idx;
      } else {
        stack.pop();
      }
    } else if (selfClosingSlash === "/") {
      // 자기닫힘 태그 — 스택에 넣지 않는다.
    } else {
      stack.push({ name: tagName, line: ln });
    }
  }

  for (const frame of stack) {
    issues.push(`${relPath}:${frame.line} — 파일 끝까지 닫히지 않은 태그: <${frame.name}>`);
  }

  return issues;
}

/**
 * 렌더링된 파일 목록에 두 검사를 모두 적용해 위반 사항을 하나의 목록으로 합친다.
 * `.xml` 확장자 파일에만 `checkXmlStructure` 를 추가로 적용한다.
 */
export function validateRenderedFiles(files: ValidatableFile[]): string[] {
  const issues: string[] = [...checkPlaceholderResidue(files)];
  for (const file of files) {
    if (file.relPath.toLowerCase().endsWith(".xml")) {
      issues.push(...checkXmlStructure(file.relPath, file.content));
    }
  }
  return issues;
}
