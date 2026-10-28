/** 첨부 가능한 파일: 문서·표·한글·발표·이미지·압축 */
export const ATTACH_EXT = ['pdf', 'xlsx', 'xls', 'csv', 'doc', 'docx', 'hwp', 'hwpx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png', 'gif', 'zip', 'txt', 'dwg'];
export const ATTACH_ACCEPT = ATTACH_EXT.map((e) => `.${e}`).join(',');
export const MAX_ATTACH_BYTES = 20 * 1024 * 1024;

export function extOf(name: string): string {
  return (name.split('.').pop() ?? '').toLowerCase();
}

export function checkAttachable(file: File): string | null {
  if (!ATTACH_EXT.includes(extOf(file.name))) return `${file.name}: 이 형식은 올릴 수 없습니다. (PDF, 엑셀, 워드, 한글, 파워포인트, 이미지, zip)`;
  if (file.size > MAX_ATTACH_BYTES) return `${file.name}: 20MB보다 커서 올릴 수 없습니다.`;
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

export function fileKind(name: string): 'pdf' | 'sheet' | 'doc' | 'hwp' | 'slide' | 'image' | 'zip' | 'other' {
  const e = extOf(name);
  if (e === 'pdf') return 'pdf';
  if (['xlsx', 'xls', 'csv'].includes(e)) return 'sheet';
  if (['doc', 'docx', 'txt'].includes(e)) return 'doc';
  if (['hwp', 'hwpx'].includes(e)) return 'hwp';
  if (['ppt', 'pptx'].includes(e)) return 'slide';
  if (['jpg', 'jpeg', 'png', 'gif'].includes(e)) return 'image';
  if (e === 'zip') return 'zip';
  return 'other';
}
