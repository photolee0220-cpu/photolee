import { CalendarClock, FileText, MapPin, MessageSquareText, Paperclip, Camera } from 'lucide-react';
import { useState } from 'react';
import { PageHeader, WeekSwitcher } from '../components/AppShell';
import { attachmentsFor } from '../components/Attachments';
import { PhotoStrip } from '../components/Photos';
import { dueInfo } from '../components/SiteCard';
import { Badge, cx, Segmented, Spinner, StageChip } from '../components/ui';
import { isReviewer } from '../lib/access';
import { byId, commentsFor, has, memberDirective, personEntry, siteDirective, visibleSites } from '../lib/derive';
import { headingText, isHeading } from '../lib/sections';
import { DIRECTIVE_STATUS, type Directive, type Entry } from '../lib/types';
import { relativeTime, weekLabel } from '../lib/week';
import { useStore } from '../state/store';

type Size = 'm' | 'l' | 'xl';
const SIZES: Record<Size, string> = { m: '15px', l: '17px', xl: '20px' };
const SIZE_KEY = 'sadakdari-report-font';

function readSize(): Size {
  try { const v = localStorage.getItem(SIZE_KEY); return v === 'm' || v === 'xl' ? v : 'l'; } catch { return 'l'; }
}

/** 내 보고: 월요일 회의 때 휴대폰·태블릿으로 보면서 읽기 좋게, 현장별 보고 다음에 부서 업무보고를 한 화면에 */
export function MyReport() {
  const { snap, me, weekId, setView } = useStore();
  const [size, setSizeState] = useState<Size>(readSize);
  const setSize = (s: Size) => { setSizeState(s); try { localStorage.setItem(SIZE_KEY, s); } catch { /* 저장 안 돼도 화면은 바뀜 */ } };
  if (!snap) return <div className="flex justify-center py-20"><Spinner /></div>;
  const dept = snap.departments.find((d) => d.id === me.departmentId);
  if (!dept || isReviewer(me)) return null;

  const order = new Map(snap.stages.map((s, i) => [s.id, i]));
  // 현장 칸은 부서가 함께 쓰므로 우리 부서가 이번 주에 쓴 현장을 모두 보여준다
  const sites = dept.writesSites
    ? visibleSites(snap)
      .map((site) => ({ site, entry: snap.entries.find((e) => e.kind === 'site' && e.siteId === site.id && e.departmentId === dept.id) }))
      .filter((x) => has(x.entry?.content))
      .sort((a, b) => (order.get(a.site.stage) ?? 0) - (order.get(b.site.stage) ?? 0) || a.site.sort - b.site.sort)
    : [];
  const mine = personEntry(snap.entries, me.id);
  const myDirective = memberDirective(snap.directives, me.id);
  const members = byId(snap.members);
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="mx-auto max-w-[900px]" style={{ ['--rf' as string]: SIZES[size] }}>
      <PageHeader title="내 보고" right={<WeekSwitcher />}>
        <Badge tone="neutral" className="!py-1">{dept.name}</Badge>
        <span className="text-[12.5px] text-ink-3">회의 때 이 화면을 보며 보고하세요</span>
      </PageHeader>

      <div className="sticky top-14 z-20 -mx-4 mb-5 border-b border-line bg-bg/95 px-4 py-2.5 backdrop-blur lg:top-0">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5">
            {sites.map(({ site }) => (
              <button key={site.id} onClick={() => jump(`r-${site.id}`)} className="shrink-0 rounded-full border border-line bg-surface px-3 py-1 text-[13px] font-semibold text-ink-2 hover:border-brand hover:text-brand-ink">{site.name}</button>
            ))}
            <button onClick={() => jump('r-dept')} className="shrink-0 rounded-full border border-brand/40 bg-brand-soft px-3 py-1 text-[13px] font-semibold text-brand-ink">부서 업무보고</button>
          </div>
          <Segmented<Size> value={size} onChange={setSize} options={[
            { id: 'm', label: <span className="text-[12px]">가</span> },
            { id: 'l', label: <span className="text-[14px]">가</span> },
            { id: 'xl', label: <span className="text-[16px] font-bold">가</span> },
          ]} />
        </div>
      </div>

      {dept.writesSites && (
        <section className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-[18px] font-extrabold"><MapPin size={18} className="text-brand" />현장별 보고 <span className="text-ink-3">{sites.length}곳</span></h2>
          {sites.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-strong px-4 py-6 text-center text-[14px] text-ink-3">
              {weekLabel(weekId)}에 우리 부서가 쓴 현장 보고가 없습니다. <button onClick={() => setView('mine')} className="font-semibold text-brand-ink hover:underline">이번 주 작성으로 가기</button>
            </p>
          ) : (
            <div className="space-y-4">
              {sites.map(({ site, entry }) => {
                const due = dueInfo(site);
                const files = attachmentsFor(snap.attachments, { kind: 'site', siteId: site.id, departmentId: dept.id, authorId: null }).length;
                const photos = snap.photos.filter((p) => p.siteId === site.id && p.departmentId === dept.id).length;
                return (
                  <article key={site.id} id={`r-${site.id}`} className="scroll-mt-32 rounded-2xl border border-line bg-surface p-5 shadow-card">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[22px] font-extrabold tracking-tight">{site.name}</h3>
                      <StageChip stage={site.stage} />
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] text-ink-3">
                      {site.progress != null && <b className="text-ink-2">공정 {site.progress}%</b>}
                      <span className="inline-flex items-center gap-1"><CalendarClock size={13} />{due.label}</span>
                      {photos > 0 && <span className="inline-flex items-center gap-1"><Camera size={13} />사진 {photos}</span>}
                      {files > 0 && <span className="inline-flex items-center gap-1"><Paperclip size={13} />파일 {files}</span>}
                      {entry!.updatedBy && entry!.updatedBy !== me.id && <span>작성: {members.get(entry!.updatedBy)?.name}</span>}
                    </p>
                    <DirectiveLine d={siteDirective(snap.directives, site.id)} />
                    <ReportText text={entry!.content} className="mt-3" />
                    {photos > 0 && <PhotoStrip siteId={site.id} departmentId={dept.id} editable={false} />}
                    <Comments entry={entry!} />
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section id="r-dept" className="scroll-mt-32">
        <h2 className="mb-3 flex items-center gap-2 text-[18px] font-extrabold"><FileText size={18} className="text-brand" />부서 업무보고</h2>
        <article className="rounded-2xl border border-line bg-surface p-5 shadow-card">
          <p className="text-[13.5px] text-ink-3">{me.name} {me.title} · {dept.name}{mine && has(mine.content) ? ` · ${relativeTime(mine.updatedAt)} 저장` : ''}</p>
          <DirectiveLine d={myDirective} />
          {has(mine?.content) ? <ReportText text={mine!.content} className="mt-3" /> : (
            <p className="mt-3 text-[14px] text-ink-3">아직 작성하지 않았습니다. <button onClick={() => setView('mine')} className="font-semibold text-brand-ink hover:underline">이번 주 작성으로 가기</button></p>
          )}
          {mine && <Comments entry={mine} />}
        </article>
      </section>
      <p className="mt-8 text-center text-[12px] text-ink-3">{weekLabel(weekId)} · 고칠 내용은 '이번 주 작성'에서 고치면 여기에도 바로 반영됩니다</p>
    </div>
  );
}

/** 글자 크기 설정(--rf)을 따르는 보고 글. '■ 제목' 줄은 대주제로 */
function ReportText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cx('leading-[1.75] text-ink', className)} style={{ fontSize: 'var(--rf)' }}>
      {text.split('\n').map((line, i) => isHeading(line) ? (
        <p key={i} className="mb-1 mt-4 flex items-center gap-2 font-extrabold first:mt-0" style={{ fontSize: 'calc(var(--rf) * 1.08)' }}>
          <span className="h-2 w-2 shrink-0 rounded-sm bg-brand" aria-hidden />{headingText(line)}
        </p>
      ) : <p key={i} className="whitespace-pre-wrap">{line || ' '}</p>)}
    </div>
  );
}

function DirectiveLine({ d }: { d: Directive | undefined }) {
  if (!has(d?.content)) return null;
  const status = DIRECTIVE_STATUS.find((s) => s.id === d!.status);
  return (
    <div className="mt-3 rounded-xl border border-note-line bg-note px-4 py-3">
      <p className="mb-1 flex items-center gap-2 text-[12.5px] font-bold text-note-ink">대표님 지시 <Badge tone={d!.status === 'done' ? 'ok' : d!.status === 'doing' ? 'brand' : 'neutral'}>{status?.label}</Badge></p>
      <p className="whitespace-pre-wrap leading-[1.65]" style={{ fontSize: 'calc(var(--rf) * 0.92)' }}>{d!.content}</p>
    </div>
  );
}

function Comments({ entry }: { entry: Entry }) {
  const { snap } = useStore();
  if (!snap) return null;
  const list = commentsFor(snap.comments, entry.id);
  if (!list.length) return null;
  const members = byId(snap.members);
  return (
    <div className="mt-4 space-y-1.5 border-t border-line pt-3">
      {list.map((c) => {
        const a = members.get(c.authorId);
        return (
          <p key={c.id} className={cx('rounded-lg px-3 py-2 text-[13.5px] leading-[1.6]', isReviewer(a) ? 'bg-brand-soft' : 'bg-sunken')}>
            <span className="font-bold">{isReviewer(a) && <MessageSquareText size={13} className="mr-1 inline text-brand-ink" />}{a?.isCeo ? '대표님' : `${a?.name ?? ''}${isReviewer(a) && a?.title ? ` ${a.title}` : ''}`}</span>
            <span className="ml-1.5 text-[12px] text-ink-3">{relativeTime(c.createdAt)}{isReviewer(a) && (c.acknowledgedAt ? ' · 확인함' : ' · 확인 전')}</span>
            <span className="mt-0.5 block whitespace-pre-wrap">{c.content}</span>
          </p>
        );
      })}
    </div>
  );
}
