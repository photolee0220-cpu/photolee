import { triggerDownload } from './fileTypes';
import type { MediaItem, Snapshot, WeekId } from './types';

/** 폴더·파일 이름에 쓸 수 없는 글자를 바꾼다 */
const safe = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '이름없음';

/**
 * 사진·첨부파일을 '주차 보고 / 부서 / 현장(또는 부서 업무보고)' 폴더로 묶은 ZIP을 만든다.
 * 사진·PDF는 이미 압축된 파일이라 다시 압축하지 않고 담기만 한다(빠르고 메모리를 덜 쓴다).
 */
export async function buildMediaZip(items: MediaItem[], snap: Snapshot, onProgress: (done: number, total: number) => void): Promise<{ blob: Blob; count: number; failed: number }> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const depts = new Map(snap.departments.map((d) => [d.id, d.name]));
  const sites = new Map(snap.sites.map((s) => [s.id, s.name]));
  const members = new Map(snap.members.map((m) => [m.id, m.name]));
  const used = new Set<string>();
  const photoNo = new Map<string, number>();

  const pathOf = (it: MediaItem) => {
    const where = it.siteId ? sites.get(it.siteId) ?? '현장' : it.authorId ? `부서 업무보고 (${members.get(it.authorId) ?? ''})` : '부서 업무보고';
    const folder = `${it.weekId} 보고/${safe(depts.get(it.departmentId) ?? '부서')}/${safe(where)}`;
    let name = it.fileName;
    if (it.kind === 'photo') {
      const n = (photoNo.get(folder) ?? 0) + 1;
      photoNo.set(folder, n);
      name = `사진_${String(n).padStart(2, '0')}.jpg`;
    }
    name = safe(name);
    let path = `${folder}/${name}`;
    for (let i = 2; used.has(path); i++) path = `${folder}/${name.replace(/(\.[^.]*)?$/, ` (${i})$1`)}`;
    used.add(path);
    return path;
  };

  const ordered = [...items].sort((a, b) => a.weekId.localeCompare(b.weekId));
  const paths = ordered.map(pathOf);
  let done = 0;
  let failed = 0;
  let next = 0;
  // 4개씩 나눠 받는다
  const worker = async () => {
    while (next < ordered.length) {
      const i = next++;
      try {
        const res = await fetch(ordered[i].url);
        if (!res.ok) throw new Error(String(res.status));
        zip.file(paths[i], await res.arrayBuffer(), { binary: true });
      } catch {
        failed++;
      }
      onProgress(++done, ordered.length);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  return { blob, count: ordered.length - failed, failed };
}

export function zipFileName(from: WeekId | null, before: WeekId): string {
  return `사닥다리_사진파일_${from ?? '처음'}~${before}_이전.zip`;
}

/** ZIP을 만들어 바로 내려받게 한다 */
export async function downloadMediaZip(items: MediaItem[], snap: Snapshot, fileName: string, onProgress: (done: number, total: number) => void) {
  const r = await buildMediaZip(items, snap, onProgress);
  const url = URL.createObjectURL(r.blob);
  triggerDownload(url, safe(fileName.replace(/\.zip$/, '')) + '.zip');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return r;
}

/** 사진 크기는 서버에 기록이 없어 한 장에 약 350KB로 어림한다 */
export function estimateBytes(items: MediaItem[]): number {
  return items.reduce((n, x) => n + (x.kind === 'photo' ? 350 * 1024 : x.sizeBytes), 0);
}
