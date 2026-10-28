import { Download } from 'lucide-react';
import { DeadlineBadge, PageHeader, WeekSwitcher } from '../components/AppShell';
import { Button, cx, Spinner } from '../components/ui';
import { canViewDept } from '../lib/access';
import {
  has, memberDirective, miscDirective, miscEntry, personEntry, reporters, siteDepartments, siteDirective, siteEntry, visibleSites,
} from '../lib/derive';
import { STAGES } from '../lib/types';
import { formatDate, weekLabel } from '../lib/week';
import { useStore } from '../state/store';
import { useExport } from './useExport';
import { DiffModeSwitch, DiffText } from '../components/DiffText';

/** 기존 엑셀과 같은 배치의 표 */
export function TableView() {
  const { snap, me, weekId, openDrawer } = useStore();
  const exportWeek = useExport();
  if (!snap) return <div className="flex justify-center py-20"><Spinner /></div>;
  const depts = siteDepartments(snap).filter((d) => canViewDept(me, d.id, snap.grants));
  const people = (id: string) => snap.members.filter((m) => m.active && m.departmentId === id).map((m) => m.name).join(', ');
  const sites = visibleSites(snap);

  const th = 'sticky top-0 z-10 border-b border-r border-line bg-sunken px-3 py-2.5 text-left text-[12px] font-bold text-ink-2 whitespace-nowrap';
  const td = 'border-b border-r border-line px-3 py-2.5 align-top text-[13px] leading-[1.55]';
  const Clip = ({ text, prev, diff }: { text?: string; prev?: string; diff?: boolean }) => !has(text)
    ? <span className="text-ink-3/60">—</span>
    : diff ? <DiffText text={text} prev={prev} clamp={6} className="text-[13px] [&_p]:text-[13px] [&_p]:leading-[1.55]" />
      : <div className="line-clamp-5 whitespace-pre-line">{text}</div>;

  return (
    <div className="mx-auto max-w-[1800px]">
      <PageHeader title={`${weekLabel(weekId)} · 표 보기`} right={<>
        <WeekSwitcher />
        <Button onClick={() => exportWeek(snap)}><Download size={16} />엑셀 내려받기</Button>
      </>}>
        <DeadlineBadge />
        <span className="text-[12.5px] text-ink-3">행을 누르면 현장 상세가 열립니다</span>
        <DiffModeSwitch />
      </PageHeader>

      <div className="space-y-6">
        {STAGES.map((stage) => {
          const list = sites.filter((s) => s.stage === stage.id);
          if (!list.length) return null;
          const cons = stage.id === 'construction';
          return (
            <section key={stage.id}>
              <h2 className="mb-2 text-[15px] font-bold">{stage.label} <span className="text-ink-3">{list.length}</span></h2>
              <div className="max-h-[75vh] overflow-auto rounded-2xl border border-line bg-surface shadow-card scrollbar-thin">
                <table className="w-max min-w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className={cx(th, 'left-0 z-20 w-10 text-center')}>NO</th>
                      <th className={cx(th, 'left-10 z-20 min-w-[180px]')}>현장명</th>
                      <th className={th}>{cons ? '준공예상일' : '착공예상일'}</th>
                      <th className={th}>{cons ? '주요공정' : '주요진행사항'}</th>
                      <th className={th}>{cons ? '공정율' : '연면적'}</th>
                      <th className={cx(th, 'min-w-[240px] bg-note text-note-ink')}>대표님 지시사항</th>
                      {depts.map((d) => <th key={d.id} className={cx(th, 'min-w-[280px]')}>{d.name} <span className="font-medium text-ink-3">({people(d.id)})</span></th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((s, i) => (
                      <tr key={s.id} onClick={() => openDrawer({ type: 'site', id: s.id })} className="cursor-pointer hover:[&>td]:bg-sunken/60">
                        <td className={cx(td, 'sticky left-0 bg-surface text-center tabular text-ink-3')}>{i + 1}</td>
                        <td className={cx(td, 'sticky left-10 bg-surface')}>
                          <p className="font-bold">{s.name}</p>
                          {s.note && <p className="text-[12px] text-ink-3">{s.note}</p>}
                        </td>
                        <td className={cx(td, 'whitespace-nowrap tabular')}>{s.dueDate ? formatDate(s.dueDate) : s.dueText || '—'}</td>
                        <td className={cx(td, 'min-w-[96px]')}>{s.process || '—'}</td>
                        <td className={cx(td, 'whitespace-nowrap text-right font-semibold tabular')}>{s.progress != null ? `${s.progress}%` : s.scale || '—'}</td>
                        <td className={cx(td, 'bg-note/50 max-w-[320px]')}><Clip text={siteDirective(snap.directives, s.id)?.content} /></td>
                        {depts.map((d) => <td key={d.id} className={cx(td, 'max-w-[360px]')}><Clip diff text={siteEntry(snap.entries, s.id, d.id)?.content} prev={siteEntry(snap.prevEntries, s.id, d.id)?.content} /></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

        <section>
          <h2 className="mb-2 text-[15px] font-bold">기타사항</h2>
          <div role="button" tabIndex={0} onClick={() => openDrawer({ type: 'misc' })} onKeyDown={(e) => e.key === 'Enter' && openDrawer({ type: 'misc' })} className="w-full cursor-pointer overflow-x-auto rounded-2xl border border-line bg-surface text-left shadow-card hover:border-line-strong">
            <table className="w-max min-w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  {(me.isCeo || me.isAdmin) && <th className={cx(th, 'min-w-[260px] bg-note text-note-ink')}>대표 진행사항</th>}
                  {(me.isCeo || me.isAdmin) && <th className={cx(th, 'min-w-[260px] bg-note text-note-ink')}>의뢰 진행 내용</th>}
                  <th className={cx(th, 'min-w-[260px] bg-note text-note-ink')}>주간 특별 지시사항</th>
                  {depts.map((d) => <th key={d.id} className={cx(th, 'min-w-[280px]')}>{d.name}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {(me.isCeo || me.isAdmin) && <td className={td}><Clip text={miscDirective(snap.directives, 'ceo_progress')?.content} /></td>}
                  {(me.isCeo || me.isAdmin) && <td className={td}><Clip text={miscDirective(snap.directives, 'requests')?.content} /></td>}
                  <td className={td}><Clip text={miscDirective(snap.directives, 'special')?.content} /></td>
                  {depts.map((d) => <td key={d.id} className={cx(td, 'max-w-[360px]')}><Clip diff text={miscEntry(snap.entries, d.id)?.content} prev={miscEntry(snap.prevEntries, d.id)?.content} /></td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[15px] font-bold">현장 외 부서별 보고</h2>
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
            <table className="w-full min-w-[760px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className={cx(th, 'w-[120px]')}>부서</th>
                  <th className={cx(th, 'w-[110px]')}>보고인</th>
                  <th className={cx(th, 'w-[32%] bg-note text-note-ink')}>대표님 지시사항</th>
                  <th className={th}>업무진행사항</th>
                </tr>
              </thead>
              <tbody>
                {reporters(snap).filter((m) => canViewDept(me, m.departmentId, snap.grants) && !snap.departments.find((d) => d.id === m.departmentId)?.writesSites).map((m) => (
                  <tr key={m.id} onClick={() => openDrawer({ type: 'person', id: m.id })} className="cursor-pointer hover:[&>td]:bg-sunken/60">
                    <td className={cx(td, 'font-semibold')}>{snap.departments.find((d) => d.id === m.departmentId)?.name}</td>
                    <td className={td}>{m.name} {m.title}</td>
                    <td className={cx(td, 'bg-note/50')}><Clip text={memberDirective(snap.directives, m.id)?.content} /></td>
                    <td className={td}><Clip diff text={personEntry(snap.entries, m.id)?.content} prev={personEntry(snap.prevEntries, m.id)?.content} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
