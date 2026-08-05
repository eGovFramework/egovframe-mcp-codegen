#!/usr/bin/env bash
# 번들 tgz 생성 — bundleDependencies 로 node_modules 를 tgz 에 포함한다.
# 이 레포의 런타임 의존성은 순수 JS 라 플랫폼 무관 — universal tgz 하나로
# 모든 플랫폼(macOS/Linux/Windows)을 커버한다.
#
# devDependencies 는 prune 하지 않는다 — npm pack 의 번들은 dependencies 그래프만
# 따라가므로 devDeps 는 tgz 에 포함되지 않으며, pack 시점에 prepare(빌드)가
# 실행되므로 tsc 등 devDeps 가 오히려 필요하다.
#
# 사용법: scripts/pack-bundle.sh
set -euo pipefail
cd "$(dirname "$0")/.."

name=$(node -p "require('./package.json').name")
ver=$(node -p "require('./package.json').version")
mkdir -p dist

rm -rf node_modules
npm ci
npm pack --pack-destination dist

echo "완료:"
ls -lh "dist/$name-$ver.tgz"
