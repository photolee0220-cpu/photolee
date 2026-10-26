/** 지난주 같은 칸과 줄 단위로 비교한다. 번호·글머리표·공백 차이는 같은 줄로 본다 */

export interface DiffLine {
  text: string;
  added: boolean;
}

export interface LineDiff {
  lines: DiffLine[];
  removed: string[];
  addedCount: number;
  /** 지난주와 내용이 완전히 같음 */
  same: boolean;
  /** 지난주 칸이 비어 있었음 (새로 작성) */
  fresh: boolean;
}

function norm(line: string): string {
  return line
    .replace(/^[\s\-–·•*★■○●▶>]+/, '')
    .replace(/^(\(?\d{1,2}[.)]|[가-하][.)])\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function lineDiff(current: string, previous: string | undefined | null): LineDiff {
  const cur = current.split('\n');
  const prevLines = (previous ?? '').split('\n').filter((l) => norm(l));
  const a = prevLines.map(norm);
  const b = cur.map(norm);

  // 최장 공통 부분열로 지난주에도 있던 줄을 찾는다
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const keptCur = new Set<number>();
  const keptPrev = new Set<number>();
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[i] === b[j]) { keptPrev.add(i); keptCur.add(j); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }

  const lines = cur.map((text, j) => ({ text, added: !!b[j] && !keptCur.has(j) }));
  const addedCount = lines.filter((l) => l.added).length;
  const removed = prevLines.filter((_, i) => !keptPrev.has(i));
  return { lines, removed, addedCount, same: n > 0 && addedCount === 0 && removed.length === 0, fresh: n === 0 && b.some(Boolean) };
}
