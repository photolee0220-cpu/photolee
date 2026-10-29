import type { Directive, Entry, Grant, Member, WeekId } from './types';
import { currentWeekId } from './week';

/** 서버(Supabase RLS)와 같은 규칙. 데모 모드와 화면 표시에서 사용 */

export function canSeeAll(me: Member): boolean {
  return me.isCeo || me.isAdmin || me.isExecutive;
}

/** 보고를 쓰지 않고 검토하며 코멘트를 남기는 사람 (대표, 본부장). 이들의 코멘트는 담당자가 확인해야 한다 */
export function isReviewer(m: Pick<Member, 'isCeo' | 'isExecutive'> | undefined | null): boolean {
  return !!m && (m.isCeo || m.isExecutive);
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

/** 지난 주차는 관리자만 고친다 (보기는 누구나 권한대로). 서버 guard_past_week와 같은 규칙 */
export function isWeekLocked(me: Member, weekId: WeekId): boolean {
  return !me.isAdmin && weekId < currentWeekId();
}

/** 지시사항 처리 상태를 바꿀 수 있는 사람: 담당자(개인 지시는 본인, 현장 지시는 현장 칸 쓰는 부서원)·대표·관리자 */
export function canSetDirectiveStatus(me: Member, d: Directive, writesSites: boolean): boolean {
  if (me.isCeo || me.isAdmin) return true;
  if (d.targetKind === 'member') return d.memberId === me.id;
  return d.targetKind === 'site' && writesSites;
}
