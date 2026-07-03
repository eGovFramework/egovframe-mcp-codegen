/**
 * assertInsideProject — 산출물 path traversal 방어 단위 테스트.
 */
import { describe, expect, it } from "vitest";
import * as path from "node:path";

import { assertInsideProject } from "../../src/utils/scaffold/pathGuard.js";

describe("assertInsideProject", () => {
  const root = path.join(path.sep, "tmp", "egov-proj");

  it("프로젝트 내부 경로는 resolve 된 절대 경로를 반환한다", () => {
    const inside = path.join(root, "src", "main", "java", "Foo.java");
    expect(assertInsideProject(root, inside)).toBe(path.resolve(inside));
  });

  it("프로젝트 루트 자신은 허용한다", () => {
    expect(assertInsideProject(root, root)).toBe(path.resolve(root));
  });

  it("'..' 로 프로젝트 밖을 가리키면 거부한다", () => {
    const escape = path.join(root, "..", "outside", "evil.txt");
    expect(() => assertInsideProject(root, escape)).toThrow(/프로젝트 디렉터리 외부/);
  });

  it("루트와 접두사만 겹치는 형제 디렉터리는 거부한다", () => {
    // '/tmp/egov-proj-evil' 은 '/tmp/egov-proj' 로 시작하지만 내부가 아니다.
    const sibling = `${root}-evil${path.sep}file.txt`;
    expect(() => assertInsideProject(root, sibling)).toThrow(/프로젝트 디렉터리 외부/);
  });
});
