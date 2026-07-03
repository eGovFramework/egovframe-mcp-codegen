import path from "node:path";

/**
 * 산출물 경로가 프로젝트 디렉터리 내부에 있음을 강제한다 (path traversal 방어).
 *
 * 입력 스키마(패키지명·엔티티명 regex)가 1차 방어선이지만, 매니페스트의 output
 * 경로가 사용자 입력에서 파생되므로 실제 파일 쓰기 직전에 한 번 더 확인한다.
 * 통과 시 resolve 된 절대 경로를 반환한다.
 */
export function assertInsideProject(projectDir: string, candidate: string): string {
  const root = path.resolve(projectDir);
  const abs = path.resolve(candidate);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(
      `안전하지 않은 산출물 경로가 감지되어 중단했습니다 — 프로젝트 디렉터리 외부를 가리킵니다: ${path.relative(root, abs)}`,
    );
  }
  return abs;
}
