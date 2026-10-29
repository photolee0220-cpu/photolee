import type { Comment, Department, Directive, Entry, Member, MiscSlot, Site, Snapshot } from './types';

export function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

export const has = (s: string | undefined | null) => !!s && s.trim().length > 0;

export function siteEntry(list: Entry[], siteId: string, deptId: string): Entry | undefined {
  return list.find((e) => e.kind === 'site' && e.siteId === siteId && e.departmentId === deptId);
}
export function personEntry(list: Entry[], memberId: string): Entry | undefined {
  return list.find((e) => e.kind === 'dept' && e.authorId === memberId);
}
export function miscEntry(list: Entry[], deptId: string): Entry | undefined {
  return list.find((e) => e.kind === 'misc' && e.departmentId === deptId);
}

export function siteDirective(list: Directive[], siteId: string) {
  return list.find((d) => d.targetKind === 'site' && d.siteId === siteId);
}
export function memberDirective(list: Directive[], memberId: string) {
  return list.find((d) => d.targetKind === 'member' && d.memberId === memberId);
}
export function miscDirective(list: Directive[], slot: MiscSlot) {
  return list.find((d) => d.targetKind === 'misc' && d.slot === slot);
}

export function siteDepartments(snap: Snapshot): Department[] {
  return snap.departments.filter((d) => d.active && d.writesSites).sort((a, b) => a.sort - b.sort);
}

export function activeDepartments(snap: Snapshot): Department[] {
  return snap.departments.filter((d) => d.active).sort((a, b) => a.sort - b.sort);
}

/** 매주 보고를 쓰는 사람: 부서가 있고 활성 상태 */
export function reporters(snap: Snapshot): Member[] {
  const order = new Map(snap.departments.map((d) => [d.id, d.sort]));
  return snap.members
    .filter((m) => m.active && m.departmentId && !m.isCeo)
    .sort((a, b) => (order.get(a.departmentId!) ?? 0) - (order.get(b.departmentId!) ?? 0));
}

export function hasWritten(snap: Snapshot, memberId: string): boolean {
  return snap.entries.some((e) => e.updatedBy === memberId && has(e.content));
}

export function commentsFor(list: Comment[], entryId: string | undefined): Comment[] {
  if (!entryId) return [];
  return list.filter((c) => c.entryId === entryId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function visibleSites(snap: Snapshot): Site[] {
  return snap.sites.filter((s) => !s.archived).sort((a, b) => a.sort - b.sort);
}

export function isCompleted(s: Site): boolean {
  return s.progress === 100 || /준공완료/.test(s.process);
}

export function initials(name: string): string {
  return name.replace(/\s/g, '').slice(-2);
}

const palette = ['#0E7C66', '#3B6FD4', '#B5532F', '#7A5BC7', '#B3871A', '#2F8F9D', '#C2457A', '#5B7F2E'];
export function colorFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export function firstLines(text: string, n = 3): string {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, n).join('\n');
}

/** 현장 보고 부서 사람이 이번 주 마지막으로 고친 현장 칸 */
export function siteWork(snap: Snapshot, memberId: string): Entry[] {
  const order = new Map(snap.sites.map((s, i) => [s.id, i]));
  return snap.entries
    .filter((e) => e.kind === 'site' && e.updatedBy === memberId && has(e.content))
    .sort((a, b) => (order.get(a.siteId!) ?? 0) - (order.get(b.siteId!) ?? 0));
}

/** 이 현장 칸을 그 부서가 이번 주에 썼는지 (내용 열람 권한과 관계없이 알 수 있다) */
export function siteStatusOf(snap: Snapshot, siteId: string, deptId: string) {
  return snap.siteStatus.find((x) => x.siteId === siteId && x.departmentId === deptId);
}

/** 처리 상태를 따지는 지시: 현장·개인 지시 중 내용이 있는 것 (예전 기타 칸 제외) */
export function activeDirectives(list: Directive[]): Directive[] {
  return list.filter((d) => (d.targetKind === 'site' || d.targetKind === 'member') && has(d.content));
}
