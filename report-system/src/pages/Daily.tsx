import { Building2, Check, ChevronLeft, ChevronRight, CornerDownRight, HardHat, ImagePlus, Lock, MapPin, MessageSquareText, Send, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { EntryEditor, TextBlock } from '../components/editors';
import { ImageViewer } from '../components/Photos';
import { RichEditor, type RichEditorHandle } from '../components/RichEditor';
import { MarkToolbar, RichLines } from '../components/RichText';
import { Avatar, Badge, Button, Card, cx, Empty, IconButton, Segmented, Select, Spinner, StageChip } from '../components/ui';
import { affiliationOf, canEditDaily, canViewDept, isReviewer, isWorkday, writesDaily } from '../lib/access';
import { api } from '../lib/client';
import { activeDepartments, byId, has, visibleSites } from '../lib/derive';
import { shrinkImage } from '../lib/image';
import type { Affiliation, DailyComment, DailyPhoto, DailySnapshot, Member, Site, Snapshot } from '../lib/types';
import { dayLabel, dowOf, relativeTime, shiftDay, todayIso } from '../lib/week';
import { useStore } from '../state/store';

/* ───────────── 데이터 ───────────── */

export function useDaily(date: string) {
  const { toast } = useStore();
  const [data, setData] = useState<DailySnapshot | null>(null);
  const load = useCallback(async () => {
    try { setData(await api.daily.load(date)); } catch (e) { toast(e instanceof Error ? e.message : '불러오지 못했습니다.', 'error'); }
  }, [date, toast]);
  useEffect(() => { setData(null); void load(); }, [load]);
  useEffect(() => api.subscribe(() => void load()), [load]);
  return { data, reload: load, setData };
}

const wrote = (d: DailySnapshot, memberId: string) =>
  d.reports.some((r) => r.authorId === memberId && has(r.content)) || d.photos.some((p) => p.authorId === memberId);

/** 볼 수 있는 일일보고 작성 대상자 */
function dailyPeople(snap: Snapshot, me: Member): Member[] {
  const order = new Map(snap.departments.map((d) => [d.id, d.sort]));
  return snap.members
    .filter((m) => writesDaily(m) && canViewDept(me, m.departmentId, snap.grants))
    .sort((a, b) => (order.get(a.departmentId!) ?? 0) - (order.get(b.departmentId!) ?? 0) || a.name.localeCompare(b.name));
}

/* ───────────── 날짜 이동 ───────────── */

export function DateSwitcher({ date, onChange }: { date: string; onChange(d: string): void }) {
  const today = todayIso();
  return (
    <div className="flex items-center gap-1">
      <IconButton label="전날" onClick={() => onChange(shiftDay(date, -1))}><ChevronLeft size={18} /></IconButton>
      <span className="min-w-[112px] text-center text-[14px] font-bold tabular">{dayLabel(date)}</span>
      <IconButton label="다음날" onClick={() => onChange(shiftDay(date, 1))} disabled={date >= today} className="disabled:opacity-30"><ChevronRight size={18} /></IconButton>
      {date !== today && <button onClick={() => onChange(today)} className="ml-1 rounded-md bg-brand-soft px-2 py-1 text-[12px] font-bold text-brand-ink">오늘</button>}
    </div>
  );
}

/* ───────────── 직원: 일일보고 화면 ───────────── */

export function DailyPage() {
  const { snap, me } = useStore();
  const [date, setDate] = useState(todayIso);
  const { data, reload, setData } = useDaily(date);
  if (!snap) return <div className="flex justify-center py-20"><Spinner /></div>;
  const mine = writesDaily(me);

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="일일보고" right={<DateSwitcher date={date} onChange={setDate} />}>
        <span className="text-[13px] text-ink-3">당일에만 쓰고 고칠 수 있습니다 · 본사 월~금, 현장 월~토</span>
      </PageHeader>
      {mine && <PendingDailyFeedback onGo={setDate} refreshKey={data} />}
      {!data ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <>
          {mine && <MyDaily date={date} data={data} setData={setData} reload={reload} />}
          <section className="mt-10">
            <h2 className="mb-3 text-[17px] font-bold">{mine ? '함께 보는 일일보고' : '일일보고'}</h2>
            <DailyBoard date={date} data={data} reload={reload} />
          </section>
        </>
      )}
    </div>
  );
}

function MyDaily({ date, data, setData, reload }: { date: string; data: DailySnapshot; setData(d: DailySnapshot): void; reload(): Promise<void> }) {
  const { snap, me, toast } = useStore();
  const editable = canEditDaily(me, me.id, date);
  const kind = affiliationOf(me);
  const myRows = data.reports.filter((r) => r.authorId === me.id);
  const [added, setAdded] = useState<string[]>([]);
  useEffect(() => setAdded([]), [date]);
  if (!snap) return null;
  const sites = byId(snap.sites);

  const save = (siteId: string | null) => async (content: string) => {
    const r = await api.daily.save({ date, siteId, content });
    const rest = data.reports.filter((x) => !(x.authorId === me.id && x.siteId === siteId));
    setData({ ...data, reports: r ? [...rest, r] : rest });
  };
  const content = (siteId: string | null) => myRows.find((r) => r.siteId === siteId)?.content ?? '';
  const comments = data.comments.filter((c) => c.memberId === me.id);
  const dayOff = !isWorkday(date, kind);

  const header = (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <h2 className="text-[17px] font-bold">내 일일보고</h2>
      <Badge tone="neutral">{kind === 'site' ? '현장' : '본사'}</Badge>
      {wrote(data, me.id) ? <Badge tone="brand">작성</Badge> : dayOff ? <Badge>휴무일</Badge> : <Badge tone="warn">미작성</Badge>}
      {!editable && <span className="ml-auto inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink-3"><Lock size={13} />지난 날짜는 볼 수만 있습니다</span>}
    </div>
  );

  if (kind === 'site') {
    const site = me.homeSiteId ? sites.get(me.homeSiteId) : undefined;
    return (
      <Card className="p-5">
        {header}
        {!site ? (
          <p className="rounded-xl bg-note px-4 py-3 text-[13.5px] text-note-ink">근무 현장이 정해지지 않았습니다. 관리자에게 소속 현장 지정을 요청해 주세요.</p>
        ) : (
          <SiteBlockTitle site={site}>
            <EntryEditor key={`${date}-${site.id}`} value={content(site.id)} editable={editable} onSave={save(site.id)}
              placeholder={'오늘 작업 내용, 투입 인원·장비, 특이사항, 내일 계획 등을 적어 주세요'} />
            <DailyPhotos date={date} siteId={site.id} authorId={me.id} photos={data.photos} editable={editable} onChanged={reload} />
          </SiteBlockTitle>
        )}
        <DailyFeedback date={date} member={me} comments={comments} onChanged={reload} />
      </Card>
    );
  }

  const siteIds = [...new Set([...myRows.filter((r) => r.siteId).map((r) => r.siteId!), ...added])];
  const remaining = visibleSites(snap).filter((s) => !siteIds.includes(s.id));
  const removeSite = async (id: string) => {
    if (has(content(id)) && !window.confirm('이 현장 칸을 지울까요? 쓴 내용도 함께 지워집니다.')) return;
    try { await save(id)(''); setAdded((a) => a.filter((x) => x !== id)); } catch (e) { toast(e instanceof Error ? e.message : '지우지 못했습니다.', 'error'); }
  };

  return (
    <Card className="p-5">
      {header}
      <p className="mb-1.5 text-[13px] font-bold text-ink-2">오늘 한 일</p>
      <EntryEditor key={`${date}-general`} value={content(null)} editable={editable} onSave={save(null)}
        placeholder="오늘 한 일, 특이사항, 내일 할 일 등을 적어 주세요" />
      <DailyPhotos date={date} siteId={null} authorId={me.id} photos={data.photos} editable={editable} onChanged={reload} />

      {(siteIds.length > 0 || editable) && (
        <div className="mt-6 border-t border-line pt-5">
          <p className="mb-1 text-[13px] font-bold text-ink-2">현장 관련 내용 <span className="font-normal text-ink-3">· 대표님 화면의 현장 탭에 그 현장 보고로 함께 나옵니다</span></p>
          <div className="mt-3 space-y-4">
            {siteIds.map((id) => {
              const site = sites.get(id);
              if (!site) return null;
              return (
                <SiteBlockTitle key={id} site={site} onRemove={editable ? () => void removeSite(id) : undefined}>
                  <EntryEditor key={`${date}-${id}`} value={content(id)} editable={editable} onSave={save(id)} compact
                    placeholder={`${site.name} 관련해서 오늘 한 일을 적어 주세요`} />
                  <DailyPhotos date={date} siteId={id} authorId={me.id} photos={data.photos} editable={editable} onChanged={reload} />
                </SiteBlockTitle>
              );
            })}
          </div>
          {editable && remaining.length > 0 && (
            <Select aria-label="현장 추가" value="" onChange={(e) => { if (e.target.value) setAdded((a) => [...a, e.target.value]); }}
              className="mt-3 !w-auto min-w-[220px] font-semibold text-brand-ink">
              <option value="">+ 현장 추가</option>
              {remaining.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
        </div>
      )}
      <DailyFeedback date={date} member={me} comments={comments} onChanged={reload} />
    </Card>
  );
}

function SiteBlockTitle({ site, onRemove, children }: { site: Site; onRemove?(): void; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-sunken/40 p-3.5">
      <div className="mb-2 flex items-center gap-2">
        <MapPin size={15} className="shrink-0 text-brand" />
        <span className="font-bold">{site.name}</span>
        <StageChip stage={site.stage} />
        {onRemove && <IconButton label={`${site.name} 칸 지우기`} onClick={onRemove} className="ml-auto h-7 w-7"><X size={15} /></IconButton>}
      </div>
      {children}
    </div>
  );
}

/** 확인 전인 일일보고 피드백 */
function PendingDailyFeedback({ onGo, refreshKey }: { onGo(date: string): void; refreshKey: unknown }) {
  const { snap } = useStore();
  const [list, setList] = useState<DailyComment[]>([]);
  const load = useCallback(() => { api.daily.pending().then(setList).catch(() => undefined); }, []);
  useEffect(() => api.subscribe(load), [load]);
  // 이 화면에서 확인·답글을 하면 일일보고 데이터가 다시 읽히므로 그때 같이 새로 읽는다
  useEffect(() => { load(); }, [load, refreshKey]);
  if (!list.length || !snap) return null;
  const members = byId(snap.members);
  return (
    <div className="mb-5 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3">
      <p className="mb-2 flex items-center gap-2 text-[13.5px] font-bold text-brand-ink"><MessageSquareText size={17} />확인하지 않은 일일보고 피드백 {list.length}건</p>
      <ul className="space-y-1.5">
        {list.map((c) => (
          <li key={c.id} className="flex flex-wrap items-baseline gap-x-2 text-[13.5px]">
            <button onClick={() => onGo(c.date)} className="shrink-0 font-semibold text-brand-ink hover:underline">{dayLabel(c.date)}</button>
            <span className="min-w-0 flex-1"><RichLines text={c.content} /></span>
            <span className="text-[12px] text-ink-3">{members.get(c.authorId)?.isCeo ? '대표님' : members.get(c.authorId)?.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ───────────── 사진 ───────────── */

function DailyPhotos({ date, siteId, authorId, photos, editable, onChanged }: {
  date: string; siteId: string | null; authorId: string; photos: DailyPhoto[]; editable: boolean; onChanged(): Promise<void> | void;
}) {
  const { me, toast } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const list = photos.filter((p) => p.authorId === authorId && p.siteId === siteId);
  if (!editable && !list.length) return null;

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const items = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    setBusy(items.length);
    for (const f of items) {
      try {
        const small = await shrinkImage(f, api.mode === 'demo' ? 1024 : 1920, api.mode === 'demo' ? 0.7 : 0.82);
        await api.daily.uploadPhoto({ date, siteId, ...small });
      } catch (e) {
        toast(e instanceof Error ? e.message : '사진을 올리지 못했습니다.', 'error');
        if (api.mode === 'demo') break;
      } finally { setBusy((n) => n - 1); }
    }
    if (input.current) input.current.value = '';
    await onChanged();
  };

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap gap-2">
        {list.map((p, i) => (
          <button key={p.id} type="button" onClick={() => setOpen(i)} className="h-16 w-16 overflow-hidden rounded-lg border border-line bg-sunken sm:h-20 sm:w-20">
            <img src={p.url} alt="사진" loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
        {Array.from({ length: busy }).map((_, i) => <div key={i} className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-line-strong sm:h-20 sm:w-20"><Spinner /></div>)}
        {editable && (
          <button type="button" onClick={() => input.current?.click()} disabled={busy > 0}
            className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-line-strong text-[11.5px] font-semibold text-ink-3 hover:border-brand hover:text-brand-ink sm:h-20 sm:w-20">
            <ImagePlus size={18} />사진
          </button>
        )}
      </div>
      {editable && <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files)} />}
      {open != null && list[open] && (
        <ImageViewer urls={list.map((p) => p.url)} index={open} onIndex={setOpen} onClose={() => setOpen(null)} meta={dayLabel(date)}
          onDelete={canEditDaily(me, list[open].authorId, date) ? async () => {
            try { await api.daily.deletePhoto(list[open].id); setOpen(null); await onChanged(); } catch (e) { toast(e instanceof Error ? e.message : '지우지 못했습니다.', 'error'); }
          } : undefined} />
      )}
    </div>
  );
}

/* ───────────── 피드백 ───────────── */

function DailyFeedback({ date, member, comments, onChanged, compact }: {
  date: string; member: Member; comments: DailyComment[]; onChanged(): Promise<void> | void; compact?: boolean;
}) {
  const { me, snap, toast } = useStore();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const box = useRef<RichEditorHandle>(null);
  if (!snap) return null;
  const members = byId(snap.members);
  const list = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const owner = member.id === me.id;
  const canWrite = isReviewer(me) || (owner && list.length > 0);
  if (!list.length && !canWrite) return null;
  if (compact && !list.length && !open) {
    return <button type="button" onClick={() => setOpen(true)} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-semibold text-brand-ink hover:underline"><MessageSquareText size={13} />피드백</button>;
  }
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try { await fn(); await onChanged(); } catch (e) { toast(e instanceof Error ? e.message : '처리하지 못했습니다.', 'error'); } finally { setBusy(false); }
  };

  return (
    <div className="mt-3 space-y-2">
      {list.map((c) => {
        const a = members.get(c.authorId);
        const fromReviewer = isReviewer(a);
        return (
          <div key={c.id} className={cx('flex gap-2.5 rounded-lg px-3 py-2.5', fromReviewer ? 'bg-brand-soft' : 'bg-sunken')}>
            {fromReviewer ? <MessageSquareText size={16} className="mt-0.5 shrink-0 text-brand-ink" /> : <CornerDownRight size={16} className="mt-0.5 shrink-0 text-ink-3" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-[12px]">
                <span className="font-bold text-ink">{a?.isCeo ? '대표님 · 피드백' : `${a?.name ?? ''}${fromReviewer ? ` ${a?.title ?? ''} · 코멘트` : ''}`}</span>
                <span className="text-ink-3">{relativeTime(c.createdAt)}</span>
                {c.authorId === me.id && (
                  <button onClick={() => void act(() => api.daily.deleteComment(c.id))} className="ml-auto text-ink-3 hover:text-danger" aria-label="삭제"><Trash2 size={13} /></button>
                )}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-[1.6]"><RichLines text={c.content} /></p>
              {fromReviewer && (c.acknowledgedAt ? (
                <p className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-ok"><Check size={13} />{member.name} 확인 · {relativeTime(c.acknowledgedAt)}</p>
              ) : owner ? (
                <Button size="sm" className="mt-1.5" disabled={busy} onClick={() => void act(() => api.daily.acknowledge(c.id))}><Check size={14} />확인했습니다</Button>
              ) : <p className="mt-1 text-[12px] font-semibold text-warn">확인 전</p>)}
            </div>
          </div>
        );
      })}
      {canWrite && (
        <>
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <RichEditor ref={box} value={draft} onChange={setDraft}
                onSubmit={() => void act(async () => { if (draft.trim()) { await api.daily.addComment(date, member.id, draft.trim()); setDraft(''); } })}
                placeholder={me.isCeo ? `${member.name}님 일일보고에 피드백 남기기` : isReviewer(me) ? '코멘트 남기기' : '답글 남기기'}
                className="min-h-[40px] rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13.5px] leading-[1.5] focus:border-brand focus:ring-2 focus:ring-brand/20" />
            </div>
            <Button tone="primary" aria-label="보내기" disabled={busy || !draft.trim()}
              onClick={() => void act(async () => { await api.daily.addComment(date, member.id, draft.trim()); setDraft(''); })}><Send size={15} /></Button>
          </div>
          {draft.trim() && <MarkToolbar onApply={(m) => box.current?.applyMark(m)} />}
        </>
      )}
    </div>
  );
}

/* ───────────── 모아보기: 본사 / 현장 ───────────── */

type BoardTab = 'hq' | 'site';
const TAB_KEY = 'daily-board-tab';

export function DailyBoard({ date, data, reload }: { date: string; data: DailySnapshot; reload(): Promise<void> }) {
  const { snap, me, openDrawer } = useStore();
  const [saved, setTabState] = useState<BoardTab | null>(() => {
    try { const v = localStorage.getItem(TAB_KEY); return v === 'site' || v === 'hq' ? v : null; } catch { return null; }
  });
  const setTab = (t: BoardTab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* 무시 */ } };
  if (!snap) return null;

  const people = dailyPeople(snap, me);
  const of = (a: Affiliation) => people.filter((m) => affiliationOf(m) === a);
  const count = (list: Member[]) => {
    const expected = list.filter((m) => isWorkday(date, affiliationOf(m)));
    return { done: list.filter((m) => wrote(data, m.id)).length, expected: expected.length, missing: expected.filter((m) => !wrote(data, m.id)) };
  };
  const hq = count(of('hq'));
  const site = count(of('site'));
  const all = count(people);
  const dow = dowOf(date);
  // 고른 탭이 없거나 볼 사람이 없는 탭이면, 내 소속 탭(또는 사람이 있는 탭)으로
  let tab: BoardTab = saved ?? (affiliationOf(me) === 'site' && writesDaily(me) ? 'site' : 'hq');
  if (!of(tab).length && of(tab === 'hq' ? 'site' : 'hq').length) tab = tab === 'hq' ? 'site' : 'hq';

  return (
    <div>
      <Card className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div>
          <p className="text-[12.5px] font-bold text-ink-3">{dayLabel(date)} 작성</p>
          <p className="mt-1 text-[24px] font-extrabold tabular leading-none">{all.done}<span className="text-[14px] font-bold text-ink-3"> / {all.expected}명</span></p>
        </div>
        <div className="min-w-0 flex-1">
          {all.expected === 0 ? (
            <p className="text-[13px] text-ink-3">{dow === 0 ? '일요일' : '토요일'}은 {dow === 6 ? '현장만 작성하는 날입니다' : '작성하지 않는 날입니다'}</p>
          ) : all.missing.length ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-[12px] font-semibold text-ink-3">미작성</span>
              {all.missing.map((m) => (
                <button key={m.id} onClick={() => openDrawer({ type: 'person', id: m.id })} className="rounded-md bg-sunken px-1.5 py-0.5 text-[12px] font-semibold text-ink-2 hover:bg-line">{m.name}</button>
              ))}
            </div>
          ) : <p className="text-[13px] font-semibold text-ok">모두 작성했습니다</p>}
        </div>
      </Card>

      <Segmented<BoardTab> value={tab} onChange={setTab} className="mb-4" options={[
        { id: 'hq', label: <span className="inline-flex items-center gap-1.5"><Building2 size={14} />본사 {hq.done}/{hq.expected}</span> },
        { id: 'site', label: <span className="inline-flex items-center gap-1.5"><HardHat size={14} />현장 {site.done}/{site.expected}</span> },
      ]} />

      {tab === 'hq' ? <HqBoard date={date} data={data} people={of('hq')} reload={reload} /> : <SiteBoard date={date} data={data} people={of('site')} reload={reload} />}
    </div>
  );
}

function StatusBadge({ date, member, data }: { date: string; member: Member; data: DailySnapshot }) {
  if (wrote(data, member.id)) return <Badge tone="brand">작성</Badge>;
  return isWorkday(date, affiliationOf(member)) ? <Badge tone="warn">미작성</Badge> : <Badge>휴무</Badge>;
}

function HqBoard({ date, data, people, reload }: { date: string; data: DailySnapshot; people: Member[]; reload(): Promise<void> }) {
  const { snap } = useStore();
  if (!snap) return null;
  if (!people.length) return <Empty title="볼 수 있는 본사 인원이 없습니다" />;
  const sites = byId(snap.sites);
  const depts = byId(activeDepartments(snap));
  // 부서 순서대로 한 격자에. 작성한 사람이 앞에
  const order = new Map(activeDepartments(snap).map((d, i) => [d.id, i]));
  const list = [...people].sort((a, b) => Number(wrote(data, b.id)) - Number(wrote(data, a.id)) || (order.get(a.departmentId!) ?? 0) - (order.get(b.departmentId!) ?? 0));
  return (
    <div className="grid items-start gap-3 md:grid-cols-2 xl:grid-cols-3">
      {list.map((m) => {
        const rows = data.reports.filter((r) => r.authorId === m.id);
        const general = rows.find((r) => !r.siteId);
        const siteRows = rows.filter((r) => r.siteId);
        const latest = rows.map((r) => r.updatedAt).sort().pop();
        const written = wrote(data, m.id);
        return (
          <Card key={m.id} className="p-4">
            <div className="flex items-center gap-2.5">
              <Avatar id={m.id} name={m.name} size={30} muted={!written} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate font-bold">{m.name} <span className="font-medium text-ink-3">{m.title}</span></p>
                <p className="truncate text-[12px] text-ink-3">{depts.get(m.departmentId!)?.name}</p>
              </div>
              <StatusBadge date={date} member={m} data={data} />
            </div>
            {written ? (
              <div className="mt-3 space-y-3">
                {general && <TextBlock text={general.content} className="!text-[13.5px]" />}
                <PhotoRow data={data} authorId={m.id} siteId={null} />
                {siteRows.map((r) => (
                  <div key={r.id} className="rounded-lg border border-line bg-sunken/50 px-3 py-2">
                    <p className="mb-1 flex items-center gap-1 text-[12.5px] font-bold text-brand-ink"><MapPin size={12} />{sites.get(r.siteId!)?.name ?? '현장'}</p>
                    <TextBlock text={r.content} className="!text-[13.5px]" />
                    <PhotoRow data={data} authorId={m.id} siteId={r.siteId} />
                  </div>
                ))}
                {latest && <p className="text-[11.5px] text-ink-3">{relativeTime(latest)} 저장</p>}
              </div>
            ) : <p className="mt-3 text-[13px] text-ink-3">아직 작성하지 않았습니다</p>}
            <DailyFeedback date={date} member={m} comments={data.comments.filter((c) => c.memberId === m.id)} onChanged={reload} compact />
          </Card>
        );
      })}
    </div>
  );
}

function SiteBoard({ date, data, people, reload }: { date: string; data: DailySnapshot; people: Member[]; reload(): Promise<void> }) {
  const { snap, me } = useStore();
  if (!snap) return null;
  const members = byId(snap.members);
  const depts = byId(snap.departments);
  const order = new Map(snap.stages.map((s, i) => [s.id, i]));
  const blocks = visibleSites(snap)
    .map((site) => ({
      site,
      staff: people.filter((m) => m.homeSiteId === site.id),
      // 이 현장에 대한 보고: 현장 직원 칸(소속이 바뀌었어도 그날 쓴 그대로)과 본사 직원의 현장 칸
      staffRows: data.reports.filter((r) => r.siteId === site.id && r.authorKind === 'site'),
      hqRows: data.reports.filter((r) => r.siteId === site.id && r.authorKind === 'hq' && canViewDept(me, r.departmentId, snap.grants)),
    }))
    .filter((b) => b.staff.length || b.staffRows.length || b.hqRows.length)
    .sort((a, b) => (order.get(a.site.stage) ?? 0) - (order.get(b.site.stage) ?? 0) || a.site.sort - b.site.sort);

  if (!blocks.length) return <Empty title="이 날짜에 현장 보고가 없습니다">현장 직원은 관리자 페이지에서 소속을 '현장'으로 정하면 여기에 나옵니다.</Empty>;

  return (
    <div className="space-y-4">
      {blocks.map(({ site, staff, staffRows, hqRows }) => {
        // 그날 쓴 사람 + 지금 소속된 사람 (안 쓴 사람은 미작성으로)
        const staffIds = [...new Set([...staff.map((m) => m.id), ...staffRows.map((r) => r.authorId)])];
        const done = staffIds.filter((id) => staffRows.some((r) => r.authorId === id && has(r.content)) || data.photos.some((p) => p.authorId === id && p.siteId === site.id)).length;
        return (
          <Card key={site.id} className="p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <MapPin size={17} className="text-brand" />
              <h3 className="text-[17px] font-extrabold tracking-tight">{site.name}</h3>
              <StageChip stage={site.stage} />
              <span className="ml-auto text-[12.5px] text-ink-3">현장 직원 {done}/{staffIds.length} 작성 · 본사 {hqRows.length}건</span>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink-2"><HardHat size={14} />현장 직원</p>
                {staffIds.length === 0 ? <p className="text-[13px] text-ink-3">소속된 현장 직원이 없습니다</p> : (
                  <div className="space-y-2.5">
                    {staffIds.map((id) => {
                      const m = members.get(id);
                      if (!m) return null;
                      const row = staffRows.find((r) => r.authorId === id);
                      return (
                        <div key={id} className="rounded-xl border border-line px-3.5 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar id={m.id} name={m.name} size={26} muted={!row} />
                            <p className="min-w-0 flex-1 truncate text-[14px] font-bold">{m.name} <span className="font-medium text-ink-3">{m.title}</span></p>
                            <StatusBadge date={date} member={m} data={data} />
                          </div>
                          {row ? <TextBlock text={row.content} className="mt-2 !text-[13.5px]" /> : null}
                          <PhotoRow data={data} authorId={id} siteId={site.id} />
                          <DailyFeedback date={date} member={m} comments={data.comments.filter((c) => c.memberId === id)} onChanged={reload} compact />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink-2"><Building2 size={14} />본사</p>
                {hqRows.length === 0 ? <p className="text-[13px] text-ink-3">이 현장에 대한 본사 보고가 없습니다</p> : (
                  <div className="space-y-2.5">
                    {hqRows.map((r) => {
                      const m = members.get(r.authorId);
                      return (
                        <div key={r.id} className="rounded-xl border border-line bg-sunken/40 px-3.5 py-3">
                          <p className="flex items-center gap-2 text-[13.5px]">
                            <b>{m?.name}</b><span className="text-ink-3">{m?.title} · {depts.get(r.departmentId)?.name}</span>
                            <span className="ml-auto text-[11.5px] text-ink-3">{relativeTime(r.updatedAt)}</span>
                          </p>
                          <TextBlock text={r.content} className="mt-1.5 !text-[13.5px]" />
                          <PhotoRow data={data} authorId={r.authorId} siteId={site.id} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function PhotoRow({ data, authorId, siteId }: { data: DailySnapshot; authorId: string; siteId: string | null }) {
  const [open, setOpen] = useState<number | null>(null);
  const list = data.photos.filter((p) => p.authorId === authorId && p.siteId === siteId);
  if (!list.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {list.map((p, i) => (
        <button key={p.id} type="button" onClick={() => setOpen(i)} className="h-14 w-14 overflow-hidden rounded-md border border-line bg-sunken">
          <img src={p.url} alt="사진" loading="lazy" className="h-full w-full object-cover" />
        </button>
      ))}
      {open != null && <ImageViewer urls={list.map((p) => p.url)} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

