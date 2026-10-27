#!/usr/bin/env bash
# 웹사이트 배포: 빌드 결과를 gh-pages 브랜치에 올린다.
# 자동 설치가 넣은 서버 연결 정보(config.js)와 _ops 기록은 그대로 유지한다.
# 사용법: report-system/scripts/deploy-pages.sh "변경 내용 한 줄"
set -euo pipefail
msg="${1:-deploy: 웹사이트 업데이트}"
root=$(git rev-parse --show-toplevel)
app="$root/report-system"
work=$(mktemp -d)

git -C "$root" fetch -q origin gh-pages
git -C "$root" worktree add -q "$work" origin/gh-pages
trap 'git -C "$root" worktree remove --force "$work" >/dev/null 2>&1 || true' EXIT

grep -q "supabase.co" "$work/config.js" || { echo "중단: gh-pages의 config.js에 서버 연결 정보가 없습니다." >&2; exit 1; }
cp "$work/config.js" "$work/../config.keep.js"

(cd "$app" && rm -rf dist-pages && VITE_BASE=/photolee/ npx vite build --outDir dist-pages >/dev/null)

find "$work" -mindepth 1 -maxdepth 1 ! -name .git ! -name _ops -exec rm -rf {} +
cp -r "$app/dist-pages/." "$work/"
cp "$work/../config.keep.js" "$work/config.js"
touch "$work/.nojekyll"

cd "$work"
git add -A
if git diff --cached --quiet; then echo "변경 없음"; exit 0; fi
git commit -q -m "$msg"
git push -q origin HEAD:gh-pages
echo "배포 완료: https://photolee0220-cpu.github.io/photolee/ (1~2분 뒤 반영)"
