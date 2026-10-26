import { PageHeader, WeekSwitcher } from '../components/AppShell';
import { SiteCard } from '../components/SiteCard';
import { Badge, Empty, Spinner } from '../components/ui';
import { visibleSites } from '../lib/derive';
import { useStore } from '../state/store';
import { PeopleGrid } from './People';

/** 협력 부서로 지정된 부서의 보고를 읽기 전용으로 본다 */
export function Shared() {
  const { snap, me, openDrawer } = useStore();
  if (!snap) return <div className="flex justify-center py-20"><Spinner /></div>;
  const targets = snap.grants.filter((g) => g.viewerDepartmentId === me.departmentId).map((g) => g.targetDepartmentId);
  const depts = snap.departments.filter((d) => targets.includes(d.id));
  const siteDepts = depts.filter((d) => d.writesSites);
  const otherDepts = depts.filter((d) => !d.writesSites);

  return (
    <div className="mx-auto max-w-[1300px]">
      <PageHeader title="함께 보는 부서" right={<WeekSwitcher />}>
        {depts.map((d) => <Badge key={d.id} tone="neutral" className="!py-1">{d.name}</Badge>)}
        <span className="text-[12.5px] text-ink-3">관리자가 지정한 협력 부서의 보고를 볼 수 있습니다 (보기 전용)</span>
      </PageHeader>
      {!depts.length && <Empty title="지정된 협력 부서가 없습니다">필요하면 관리자에게 요청하세요.</Empty>}
      {siteDepts.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-[16px] font-bold">현장별 보고 · {siteDepts.map((d) => d.name).join(', ')}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleSites(snap).map((s) => <SiteCard key={s.id} site={s} snap={snap} onOpen={() => openDrawer({ type: 'site', id: s.id })} />)}
          </div>
        </section>
      )}
      {otherDepts.length > 0 && (
        <section>
          <h2 className="mb-3 text-[16px] font-bold">부서 업무보고</h2>
          <PeopleGrid onlyDepartments={otherDepts.map((d) => d.id)} />
        </section>
      )}
    </div>
  );
}
