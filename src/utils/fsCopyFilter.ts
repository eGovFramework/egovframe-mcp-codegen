import path from "path";

/**
 * macOS Finder / Windows Explorer 가 자동 생성하는 OS 부산물 파일들.
 *
 * 정당한 dotfile (`.gitkeep`, `.editorconfig` 등) 까지 거르지 않도록
 * 의도적으로 화이트리스트가 아닌 **명시 블랙리스트** 만 차단한다.
 */
const OS_JUNK_NAMES = new Set([".DS_Store", "Thumbs.db"]);

/**
 * `fs-extra.copy(..., { filter })` 에 전달할 predicate.
 *
 * OS 부산물이 templates 디렉터리 → 출력 프로젝트로 흘러들어가
 * 골든 매니페스트 파일 수를 흔드는 회귀를 차단한다 (재현 가능 빌드 보장).
 *
 * @param src 복사 대상 절대 경로 (파일 또는 디렉터리)
 * @returns `true` 면 복사, `false` 면 제외.
 */
export function osJunkCopyFilter(src: string): boolean {
  return !OS_JUNK_NAMES.has(path.basename(src));
}
