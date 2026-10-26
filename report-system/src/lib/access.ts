import type { Directive, Entry, Grant, Member } from './types';

/** 서버(Supabase RLS)와 같은 규칙. 데모 모드와 화면 표시에서 사용 */

export function canSeeAll(me: Member): boolean {
  return me.isCeo || me.isAdmin;
}

export function viewableDepartmentIds(me: Member, grants: Grant[]): Set<string> | 'all' {
  if (canSeeAll(me)) return 'all';
  const ids = new Set<string>();
  if (me.departmentId) {
    ids.add(me.departmentId);
    for (const g of grants) if (g.viewerDepartmentId === me.departmentId) ids.add(g.targetDepartmentId);
  }
  return ids;
}

export function canViewDept(me: Member, deptId: string | null, grants: Grant[]): boolean {
  if (!deptId) return canSeeAll(me);
  const v = viewableDepartmentIds(me, grants);
  return v === 'all' || v.has(deptId);
}

export function canEditEntry(me: Member, e: Pick<Entry, 'kind' | 'departmentId' | 'authorId'>): boolean {
  if (me.isAdmin) return true;
  if (e.kind === 'dept') return e.authorId === me.id;
  return !!me.departmentId && me.departmentId === e.departmentId;
}

export function canViewDirective(me: Member, d: Directive, members: Member[], grants: Grant[]): boolean {
  if (canSeeAll(me)) return true;
  if (d.targetKind === 'site') return true;
  if (d.targetKind === 'misc') return d.slot === 'special';
  const target = members.find((m) => m.id === d.memberId);
  return canViewDept(me, target?.departmentId ?? null, grants);
}

/** 회계 현황은 대표와 회계팀만 */
export function canViewFinance(me: Member, deptName: string | undefined): boolean {
  return me.isCeo || deptName === '회계';
}
