// 단일 파일로 빌드된 체험판을 Claude 아티팩트 형식(문서 뼈대 없이 본문만)으로 바꾼다
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-artifact/index.html', 'utf8');
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);
const scripts = pick(/<script type="module"[^>]*>[\s\S]*?<\/script>/g);
if (!scripts.length) throw new Error('script not found');
const out = [
  '<title>사닥다리 주간보고</title>',
  ...styles,
  '<div id="root"></div>',
  ...scripts.map((s) => s.replace(/<script type="module"[^>]*>/, '<script type="module">')),
].join('\n').replace(/\uFFFD/g, '\\uFFFD');
writeFileSync('dist-artifact/artifact.html', out);
console.log(`artifact.html ${(out.length / 1024 / 1024).toFixed(2)} MB`);
