/**
 * Entity Discovery
 *
 * 기존 eGovFrame 프로젝트의 `src/main/java/.../web/Egov*Controller.java` 파일들을
 * 스캔해 현재 등록된 엔티티 목록을 추출한다. nav fragment 자동 생성 시
 * "이 프로젝트에 어떤 엔티티들이 있는가" 를 알아내는 용도로 쓴다.
 *
 * 또한 각 컨트롤러 본문을 검사해 `@GetMapping("/")` (루트 매핑) 보유 여부로 primary
 * 엔티티를 식별한다. primary 엔티티는 nav fragment 에서 `/` URL 진입 시 활성으로 강조한다.
 *
 * 명명 규칙 의존: `Egov<EntityName>Controller.java` 형태만 인식한다 (egov_scaffold_project /
 * egov_add_entity 가 만드는 표준 산출물 규칙). 사용자가 직접 만든 컨트롤러는 인식하지 않으며
 * (의도된 한계), 그런 경우 자동 메뉴에 포함시키려면 사용자가 nav fragment 를 직접 편집해야 한다.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface DiscoveredEntity {
  entityName: string;
  entityNameLower: string;
  /** 컨트롤러에 @GetMapping("/") 가 있어 root URL 을 담당하는 primary 엔티티 여부. */
  isPrimary: boolean;
}

const CONTROLLER_PATTERN = /^Egov([A-Z][A-Za-z0-9]*)Controller\.java$/;
/**
 * 컨트롤러가 root 매핑(@GetMapping("/")) 을 가지는지 검사.
 * 공백/멀티라인 변형은 허용하되, "/foo" 같은 다른 경로와 혼동하지 않도록 정확히 `"/"` 만 매칭.
 */
const ROOT_MAPPING_PATTERN = /@GetMapping\s*\(\s*"\/"\s*\)/;

/**
 * 디렉터리를 재귀적으로 탐색해 매칭되는 컨트롤러 파일들을 모은다.
 * - fs.readdir(withFileTypes) 을 써서 별도 glob 의존성 없이 동작.
 * - 숨김 디렉터리(.) 와 빌드 산출물(target, build, node_modules 등)은 스킵해 성능 보호.
 */
async function walkJavaTree(root: string): Promise<string[]> {
  const SKIP = new Set(["target", "build", "node_modules", ".git", ".idea"]);
  const results: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await visit(full);
      } else if (e.isFile() && CONTROLLER_PATTERN.test(e.name)) {
        // 컨트롤러는 관례상 `.../web/...` 아래 있다. 다른 위치의 동명 파일은 제외.
        if (!isDomainControllerDir(dir)) continue;
        results.push(full);
      }
    }
  }

  await visit(root);
  return results;
}

/**
 * 컨트롤러 디렉터리가 *도메인 엔티티* 의 것인지 판정.
 *
 * - 도메인:   `.../<entityModule>/web/Egov<Entity>Controller.java`
 * - 인프라:   `.../cmm/web/EgovFileDownloadController.java` (첨부파일 다운로드 등 공통 기능)
 *
 * 인프라 컨트롤러를 nav fragment 의 메뉴 후보로 잘못 수집하면 메뉴에 `??nav.fileDownload_ko_KR??`
 * 같은 미해석 메시지 키가 노출된다. `cmm/web/` 또는 `com/cmm/web/` 패턴은 공통 모듈로 간주해
 * 도메인 엔티티 메뉴에서 제외한다.
 */
function isDomainControllerDir(dir: string): boolean {
  const parts = dir.split(path.sep);
  if (!parts.includes("web")) return false;
  // 'web' 의 직전 segment 가 'cmm' 이면 인프라 모듈 — 도메인 엔티티가 아니다.
  const webIdx = parts.lastIndexOf("web");
  if (webIdx > 0 && parts[webIdx - 1] === "cmm") return false;
  return true;
}

/**
 * FK lookup 을 위한 부모 엔티티 정보.
 *
 * - `entityName` / `entityNameLower`: 부모 엔티티 이름 (예: Customer / customer)
 * - `packageName`: 부모 엔티티 패키지 (예: egovframework.example.customer)
 * - `pkField` / `pkColumn`: 부모의 PK Java 필드명 / DB 컬럼명 (camelCase / snake_case)
 * - `displayFields` / `displayColumns`: lookup 표시용 컬럼들 (Java/DB 양쪽). 최대 2개.
 *   결정 규칙(우선순위 순): NAME, TITLE, LABEL, FNAME, FIRST_NAME, FNAME+LNAME,
 *   그 외엔 첫 번째 non-PK 문자열 컬럼.
 */
export interface ParentEntity {
  entityName: string;
  entityNameLower: string;
  packageName: string;
  pkField: string;
  pkColumn: string;
  displayFields: string[];
  displayColumns: string[];
}

const DISPLAY_FIELD_PRIORITY = [
  // 이름 관련 — 1자 또는 2자 조합
  ["name"],
  ["title"],
  ["label"],
  ["fname", "lname"],
  ["firstName", "lastName"],
];

/**
 * 표시 컬럼 후보를 우선순위로 선택한다.
 *
 * 우선순위:
 *   1) {entityNameLower}Name (예: Professor → professorName, Student → studentName)
 *   2) name / title / label
 *   3) fname+lname / firstName+lastName
 *   4) FK 가 아닌 첫 번째 문자열 필드
 *   5) (최후) 그냥 첫 번째 문자열 필드
 *
 * "FK 가 아닌" 휴리스틱: camelCase 필드명이 `Id` 로 끝나는 건 FK 로 추정해 제외한다.
 * 그래야 Professor 의 표시 컬럼이 `deptId`(FK) 가 아닌 `professorName` 으로 선택된다.
 */
function pickDisplayFields(
  stringFields: string[],
  entityNameLower: string,
): string[] {
  // 1) 엔티티 이름 기반 표시 컬럼 (가장 흔한 패턴)
  const entityNameField = `${entityNameLower}Name`;
  if (stringFields.includes(entityNameField)) {
    return [entityNameField];
  }
  // 2) 우선순위 매칭 — 모든 필드가 존재할 때만 선택
  for (const candidate of DISPLAY_FIELD_PRIORITY) {
    if (candidate.every((c) => stringFields.includes(c))) {
      return candidate;
    }
  }
  // 3) FK 가 아닌 첫 String — 필드명이 'Id' 로 끝나면 FK 로 추정
  const nonFkField = stringFields.find((f) => !/Id$/.test(f));
  if (nonFkField) return [nonFkField];
  // 4) 최후 fallback
  return stringFields.length > 0 ? [stringFields[0]] : [];
}

function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function pascalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * 흔한 테이블 prefix — eGov / 한국 공공 도메인에서 자주 쓰는 명명 컨벤션.
 * FK 의 targetTable 에서 이 prefix 들을 벗긴 후보도 같이 시도한다.
 * 예: `TB_CUSTOMER` → `CUSTOMER` → entity `Customer`.
 */
const COMMON_TABLE_PREFIXES = ["TB_", "T_", "TBL_", "M_", "MST_", "SAMPLE_"] as const;

/**
 * targetTable 한 개를 후보 entity 이름들로 변환한다.
 *
 * 반환 순서대로 시도 — 첫 매칭된 컨트롤러를 채택한다.
 *   1) 원본 그대로 PascalCase: TB_CUSTOMER → TbCustomer
 *   2) 흔한 prefix 제거 후 PascalCase: TB_CUSTOMER → Customer
 *
 * (1) 을 우선하는 이유: 사용자가 의도적으로 `TbCustomer` 라는 entity 를 만들었을 수도
 *     있으므로 그쪽이 존재하면 그것을 신뢰한다.
 */
function tableToEntityCandidates(targetTable: string): string[] {
  const upper = targetTable.toUpperCase();
  const candidates: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const parts = raw.toLowerCase().split("_").filter(Boolean);
    if (parts.length === 0) return;
    const name = parts.map(pascalize).join("");
    if (name && !seen.has(name)) {
      seen.add(name);
      candidates.push(name);
    }
  };

  push(upper);
  for (const prefix of COMMON_TABLE_PREFIXES) {
    if (upper.startsWith(prefix)) {
      push(upper.slice(prefix.length));
    }
  }
  return candidates;
}

/**
 * 주어진 DB 테이블 이름(예: 'CUSTOMER') 의 부모 엔티티 정보를 프로젝트에서 찾는다.
 *
 * 명명 규약 의존: 부모 엔티티는 `Egov{Customer}Controller.java` 형태로 만들어졌어야 한다.
 * 엔티티명 후보는 두 가지를 순차 시도:
 *   1) 테이블명 그대로 PascalCase (예: TB_CUSTOMER → TbCustomer)
 *   2) 흔한 prefix (TB_/T_/TBL_/M_/MST_/SAMPLE_) 제거 후 PascalCase (예: TB_CUSTOMER → Customer)
 *
 * 부모 발견 후 부모의 VO 파일을 정규식으로 읽어 PK 와 표시 컬럼 후보를 추출한다.
 * VO 파싱 실패 또는 컨트롤러 부재 시 undefined 를 돌려준다 — 호출자는 graceful degrade.
 */
export async function discoverParentEntity(
  projectDir: string,
  targetTable: string,
): Promise<ParentEntity | undefined> {
  // src/main/java 트리에서 Egov{entityName}Controller.java 를 찾는다.
  const javaRoot = path.join(projectDir, "src/main/java");
  try {
    const stat = await fs.stat(javaRoot);
    if (!stat.isDirectory()) return undefined;
  } catch {
    return undefined;
  }

  // 후보 entity 이름들을 순차 시도. 첫 매칭이 정답.
  const candidates = tableToEntityCandidates(targetTable);
  let entityName: string | undefined;
  let controllerPath: string | undefined;

  for (const candidate of candidates) {
    const targetControllerName = `Egov${candidate}Controller.java`;
    let foundPath: string | undefined;

    async function visit(dir: string): Promise<void> {
      if (foundPath) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (foundPath) return;
        if (e.name.startsWith(".") || ["target", "build", "node_modules"].includes(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          await visit(full);
        } else if (e.isFile() && e.name === targetControllerName) {
          // 인프라 컨트롤러(`cmm/web/`) 는 FK 부모 후보에서도 제외.
          if (isDomainControllerDir(dir)) {
            foundPath = full;
          }
        }
      }
    }
    await visit(javaRoot);
    if (foundPath) {
      entityName = candidate;
      controllerPath = foundPath;
      break;
    }
  }
  if (!controllerPath || !entityName) return undefined;
  const entityNameLower = entityName.charAt(0).toLowerCase() + entityName.slice(1);

  // 부모 패키지 추론: .../web/EgovXxxController.java → .../{module}.service
  // 컨트롤러 경로의 web 디렉터리의 부모가 entity 모듈.
  const webDir = path.dirname(controllerPath);
  const moduleDir = path.dirname(webDir);
  const relFromJavaRoot = path.relative(javaRoot, moduleDir);
  const packageName = relFromJavaRoot.split(path.sep).join(".");

  // VO 파일에서 PK 와 표시 컬럼 후보 추출
  const voPath = path.join(moduleDir, "service", `${entityName}VO.java`);
  let voSource: string;
  try {
    voSource = await fs.readFile(voPath, "utf-8");
  } catch {
    return undefined;
  }

  // `private <Type> <field>;` 패턴 매칭. 1차 가장 단순한 패턴만 — 어노테이션 무시.
  const fieldRegex = /private\s+([A-Za-z][\w<>.]*)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;/g;
  type ParsedField = { type: string; name: string };
  const fields: ParsedField[] = [];
  for (const m of voSource.matchAll(fieldRegex)) {
    fields.push({ type: m[1], name: m[2] });
  }
  if (fields.length === 0) return undefined;

  // PK 추론 — 컨벤션상 첫 번째 필드가 PK. (scaffold 가 그렇게 만든다)
  const pkField = fields[0].name;
  const pkColumn = camelToSnake(pkField);

  // 표시 컬럼 후보: String 필드들 중 PK 가 아닌 것
  const stringFields = fields
    .filter((f) => f.type === "String" && f.name !== pkField)
    .map((f) => f.name);
  const displayFields = pickDisplayFields(stringFields, entityNameLower);
  const displayColumns = displayFields.map(camelToSnake);

  return {
    entityName,
    entityNameLower,
    packageName,
    pkField,
    pkColumn,
    displayFields,
    displayColumns,
  };
}

/**
 * `src/main/java` 하위에서 Egov*Controller 들을 찾아 엔티티 목록을 추출한다.
 *
 * 반환 목록은 entityName 알파벳 순으로 정렬되며 중복은 제거된다. 같은 엔티티명이
 * 두 모듈에 등장하는 비정상 상태는 첫 발견을 신뢰하고 나머지를 묵시적으로 무시한다 —
 * 이 도구의 충돌 거부 정책이 정상 흐름에서 그런 상태를 만들지 않는다.
 *
 * primary 엔티티는 `@GetMapping("/")` 보유 컨트롤러로 식별된다. 발견되지 않으면
 * 모든 항목의 `isPrimary` 는 false 가 된다. 둘 이상 발견되면 첫 매칭만 primary 로 인정한다.
 */
export async function discoverEntities(
  projectDir: string,
): Promise<DiscoveredEntity[]> {
  const javaRoot = path.join(projectDir, "src/main/java");
  let stat;
  try {
    stat = await fs.stat(javaRoot);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];

  const files = await walkJavaTree(javaRoot);
  type RawEntity = { entityName: string; entityNameLower: string; isPrimary: boolean };
  const map = new Map<string, RawEntity>();
  let primaryClaimed = false;

  for (const f of files) {
    const m = path.basename(f).match(CONTROLLER_PATTERN);
    if (!m) continue;
    const entityName = m[1];
    if (map.has(entityName)) continue;

    let isPrimary = false;
    if (!primaryClaimed) {
      try {
        const content = await fs.readFile(f, "utf-8");
        if (ROOT_MAPPING_PATTERN.test(content)) {
          isPrimary = true;
          primaryClaimed = true;
        }
      } catch {
        // 읽기 실패 시 primary 판단 보류
      }
    }

    map.set(entityName, {
      entityName,
      entityNameLower: entityName.charAt(0).toLowerCase() + entityName.slice(1),
      isPrimary,
    });
  }

  return Array.from(map.values()).sort((a, b) =>
    a.entityName.localeCompare(b.entityName),
  );
}
