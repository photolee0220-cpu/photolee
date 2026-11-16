import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Download, FileText, FolderOpen, Image as ImageIcon, List, Megaphone, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../lib/client';
import { visibleSites } from '../../lib/derive';
import { pdfThumb, renderPdfPages } from '../../lib/pdfPages';
import { MINUTES, type ChatRoom, type SiteDoc, type TalkSnapshot } from '../../lib/talkTypes';
import { dayLabel, dowOf, shiftDay, todayIso } from '../../lib/week';
import { useStore } from '../../state/store';
import { Badge, Button, Card, cx, Empty, Field, IconButton, Input, Modal, Select, Spinner } from '../../components/ui';
import { refreshTalk } from './useTalk';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** 매일 쓰는 자료: 달력으로 먼저 보여 준다 */
const DAILY_LOG = '공사일보';

/** 검색어: 제목·메모·파일 이름은 바로, 본문(PDF 글자)은 서버에서 찾는다. 검색어가 없으면 null */
function useDocSearch(q: string): ((d: SiteDoc) => boolean) | null {
  const [hits, setHits] = useState<Set<string>>(new Set());
  const t = q.trim();
  useEffect(() => {
    if (!t) { setHits(new Set()); return; }
    const timer = setTimeout(() => { api.talk.docs.search(t).then((ids) => setHits(new Set(ids))).catch(() => undefined); }, 350);
    return () => clearTimeout(timer);
  }, [t]);
  if (!t) return null;
  return (d) => `${d.title} ${d.note} ${d.fileName}`.includes(t) || hits.has(d.id);
}

const addMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** 공사일보 달력: 날짜마다 올라온 일보. 하루에 하나면 바로 열고, 여러 개면 고른다 */
function DocCalendar({ docs, siteNames, onOpen }: { docs: SiteDoc[]; siteNames?: Map<string, string>; onOpen(d: SiteDoc): void }) {
  const today = todayIso();
  const [month, setMonth] = useState(() => (docs.map((d) => d.docDate).sort().pop() ?? today).slice(0, 7));
  const [pick, setPick] = useState<string | null>(null);
  const byDay = new Map<string, SiteDoc[]>();
  docs.forEach((d) => byDay.set(d.docDate, [...(byDay.get(d.docDate) ?? []), d]));
  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1).getDay();
  const days = new Date(y, m, 0).getDate();
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const inMonth = [...byDay.keys()].filter((k) => k.startsWith(month)).length;
  const picked = pick ? byDay.get(pick) ?? [] : [];
  return (
    <div>
      <div className="mb-2 flex items-center gap-1">
        <button onClick={() => setMonth(addMonth(month, -1))} className="rounded-lg p-1.5 text-ink-2 hover:bg-sunken" aria-label="지난달"><ChevronLeft size={18} /></button>
        <p className="min-w-[96px] text-center text-[15px] font-bold tabular">{y}년 {m}월</p>
        <button onClick={() => setMonth(addMonth(month, 1))} className="rounded-lg p-1.5 text-ink-2 hover:bg-sunken" aria-label="다음 달"><ChevronRight size={18} /></button>
        {month !== today.slice(0, 7) && <button onClick={() => setMonth(today.slice(0, 7))} className="ml-1 rounded-full bg-sunken px-2.5 py-0.5 text-[12px] font-semibold text-ink-2">이번 달</button>}
        <span className="ml-auto text-[12.5px] text-ink-3">이번 달 {inMonth}일 올라옴</span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center">
        {DOW.map((d, i) => <p key={d} className={cx('py-1 text-[12px] font-semibold', i === 0 ? 'text-danger' : i === 6 ? 'text-brand-ink' : 'text-ink-3')}>{d}</p>)}
        {cells.map((iso, i) => {
          if (!iso) return <div key={`e${i}`} />;
          const list = byDay.get(iso) ?? [];
          const dow = (first + Number(iso.slice(8)) - 1) % 7;
          return (
            <button key={iso} disabled={!list.length} onClick={() => (list.length === 1 ? onOpen(list[0]) : setPick(iso))}
              className={cx('flex min-h-[56px] flex-col items-center justify-start rounded-lg border px-0.5 py-1 sm:min-h-[64px]',
                list.length ? 'border-brand/40 bg-brand-soft hover:border-brand' : 'border-transparent',
                iso === today && 'ring-2 ring-brand/50')}>
              <span className={cx('text-[13px] font-semibold tabular', dow === 0 ? 'text-danger' : list.length ? 'text-ink' : 'text-ink-3')}>{Number(iso.slice(8))}</span>
              {list.length > 0 && (
                <span className="mt-0.5 flex items-center gap-0.5 text-[11px] font-bold text-brand-ink">
                  <FileText size={11} />{siteNames ? `${new Set(list.map((d) => d.siteId)).size}곳` : list.length > 1 ? list.length : ''}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {pick && (
        <Modal open onClose={() => setPick(null)} title={`${dayLabel(pick)} 공사일보`} width={440}>
          <ul className="divide-y divide-line">
            {picked.map((d) => (
              <li key={d.id}>
                <button onClick={() => { setPick(null); onOpen(d); }} className="flex w-full items-center gap-2 py-2.5 text-left hover:bg-sunken/60">
                  <FileText size={16} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{siteNames?.get(d.siteId) ? `${siteNames.get(d.siteId)} · ` : ''}{d.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: 'cal' | 'list'; onChange(v: 'cal' | 'list'): void }) {
  return (
    <div className="flex rounded-lg bg-sunken p-0.5">
      {([['cal', '달력', CalendarDays], ['list', '목록', List]] as const).map(([id, label, Icon]) => (
        <button key={id} onClick={() => onChange(id)} className={cx('flex items-center gap-1 rounded-md px-2.5 py-1 text-[12.5px] font-semibold', value === id ? 'bg-surface text-ink shadow-card' : 'text-ink-3')}>
          <Icon size={14} />{label}
        </button>
      ))}
    </div>
  );
}

/** 가장 최근 정기회의 날 (오늘 포함) */
export function lastMeetingDate(dow: number, today = todayIso()): string {
  return shiftDay(today, -((dowOf(today) - dow + 7) % 7));
}

/** 정기회의 다음 날부터 그 회의 회의록이 없으면 '미등록' (그 회의 날짜를 돌려준다) */
export function minutesMissing(room: ChatRoom, docs: SiteDoc[], today = todayIso()): string | null {
  if (room.meetingDow == null || !room.siteId) return null;
  const last = lastMeetingDate(room.meetingDow, today);
  if (last === today) return null;
  return docs.some((d) => d.siteId === room.siteId && d.category === MINUTES && d.docDate >= last) ? null : last;
}

function useCategories(data?: TalkSnapshot | null) {
  return data?.settings.docCategories ?? [MINUTES, '공사일보', '주간공정표', '월간공정표', '기타'];
}

/* ───────────── 현장방 [자료] 칸 ───────────── */

export function DocsTab({ room, docs, data }: { room: ChatRoom; docs: SiteDoc[]; data: TalkSnapshot }) {
  const { toast } = useStore();
  const cats = useCategories(data);
  const [cat, setCat] = useState<string>('전체');
  const [upload, setUpload] = useState(false);
  const [view, setView] = useState<SiteDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'cal' | 'list'>('cal');
  const match = useDocSearch(q);
  const missing = minutesMissing(room, docs);
  const list = docs.filter((d) => (cat === '전체' || d.category === cat) && (!match || match(d)));
  const calendar = cat === DAILY_LOG && !match && mode === 'cal';
  const request = async () => {
    setBusy(true);
    try { await api.talk.docs.requestMinutes(room.siteId!); await refreshTalk(); toast('현장방에 회의록 요청을 남기고 알림을 보냈습니다.'); } catch (e) { toast(e instanceof Error ? e.message : '요청하지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="h-full overflow-y-auto px-3 py-3 scrollbar-thin sm:px-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {['전체', ...cats].map((c) => {
            const n = c === '전체' ? docs.length : docs.filter((d) => d.category === c).length;
            return <button key={c} onClick={() => setCat(c)} className={cx('rounded-full px-2.5 py-1 text-[12.5px] font-semibold', cat === c ? 'bg-ink text-bg' : 'bg-sunken text-ink-2 hover:text-ink')}>{c}{n > 0 && <span className="ml-1 opacity-70">{n}</span>}</button>;
          })}
        </div>
        <Button size="sm" tone="primary" className="ml-auto" onClick={() => setUpload(true)}><Upload size={15} />자료 올리기</Button>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-[320px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="자료 검색 (제목·내용)" className="!h-9 pl-8" />
        </div>
        {cat === DAILY_LOG && !match && <ViewToggle value={mode} onChange={setMode} />}
      </div>
      <p className="mb-3 text-[12.5px] text-ink-3">{room.meetingDow != null ? <>정기회의 <b className="text-ink-2">매주 {DOW[room.meetingDow]}요일</b> · </> : null}채팅에 붙인 파일도 종류를 고르면 여기에 모입니다.</p>
      {missing && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-warn/10 px-3.5 py-2.5">
          <AlertTriangle size={16} className="shrink-0 text-warn" />
          <p className="min-w-0 flex-1 text-[13px] font-semibold">{dayLabel(missing)} 정기회의 회의록이 아직 없습니다.</p>
          <Button size="sm" disabled={busy} onClick={() => void request()}>{busy ? <Spinner /> : <Megaphone size={14} />}회의록 요청</Button>
        </div>
      )}
      {calendar ? <DocCalendar docs={list} onOpen={setView} /> : (
        <>
          {!list.length && <Empty title={match ? '찾는 말이 들어간 자료가 없습니다' : '올라온 자료가 없습니다'}>{match ? 'PDF 안의 글자까지 찾습니다. 다른 말로 찾아보세요.' : 'PDF·사진을 올리면 휴대폰에서도 그림으로 바로 보입니다.'}</Empty>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((d) => <DocCard key={d.id} d={d} onOpen={() => setView(d)} />)}
          </div>
        </>
      )}
      {upload && <UploadModal siteId={room.siteId!} cats={cats} defaultCat={cat === '전체' ? cats[0] : cat}
        defaultDate={(c) => (c === MINUTES && room.meetingDow != null ? lastMeetingDate(room.meetingDow) : todayIso())} onClose={() => setUpload(false)} />}
      {view && <DocViewer d={view} onClose={() => setView(null)} />}
    </div>
  );
}

function DocCard({ d, onOpen, siteName }: { d: SiteDoc; onOpen(): void; siteName?: string }) {
  const { snap } = useStore();
  const [thumb, setThumb] = useState<string | null>(d.fileType === 'image' ? d.url : null);
  useEffect(() => {
    if (d.fileType !== 'pdf') return;
    let alive = true;
    pdfThumb(d.url).then((t) => { if (alive) setThumb(t); }).catch(() => undefined);
    return () => { alive = false; };
  }, [d.url, d.fileType]);
  const who = snap?.members.find((x) => x.id === d.uploadedBy);
  return (
    <Card className="overflow-hidden" onClick={onOpen}>
      <div className="flex h-36 items-start justify-center overflow-hidden bg-sunken">
        {thumb ? <img src={thumb} alt="" className="w-full object-cover object-top" /> : <div className="flex h-full items-center"><FileText size={28} className="text-ink-3" /></div>}
      </div>
      <div className="p-3">
        <p className="flex items-center gap-1.5"><Badge tone={d.category === MINUTES ? 'brand' : 'neutral'}>{d.category}</Badge><span className="truncate text-[14px] font-bold">{d.title}</span></p>
        <p className="mt-1 truncate text-[12.5px] text-ink-3">{siteName ? `${siteName} · ` : ''}{dayLabel(d.docDate)} · {who?.name ?? ''}</p>
        {d.note && <p className="mt-1 line-clamp-1 text-[12.5px] text-ink-2">{d.note}</p>}
      </div>
    </Card>
  );
}

function UploadModal({ siteId, cats, defaultCat, defaultDate, onClose, sites }: {
  siteId: string | null; cats: string[]; defaultCat: string; defaultDate(c: string): string; onClose(): void; sites?: { id: string; name: string }[];
}) {
  const { toast } = useStore();
  const [site, setSite] = useState(siteId ?? sites?.[0]?.id ?? '');
  const [cat, setCat] = useState(defaultCat);
  const [date, setDate] = useState(defaultDate(defaultCat));
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const save = async () => {
    if (!file || !site) return;
    setBusy(true);
    try {
      await api.talk.docs.upload({ siteId: site, category: cat, docDate: date, title: title || (cat === MINUTES ? '주간 공정회의 (감리단·협력업체)' : cat), note, file });
      await refreshTalk();
      toast(`${cat}를 올렸습니다.`);
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : '올리지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="자료 올리기" width={480}
      footer={<><Button onClick={onClose}>취소</Button><Button tone="primary" disabled={busy || !file || !site} onClick={() => void save()}>{busy && <Spinner />}올리기</Button></>}>
      <div className="space-y-3">
        {sites && (
          <Field label="현장"><Select value={site} onChange={(e) => setSite(e.target.value)}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        )}
        <div>
          <p className="mb-1.5 text-[13px] font-semibold text-ink-2">종류</p>
          <div className="flex flex-wrap gap-1.5">
            {cats.map((c) => (
              <button key={c} onClick={() => { setCat(c); setDate(defaultDate(c)); }} className={cx('rounded-full border px-3 py-1 text-[13px] font-semibold', cat === c ? 'border-brand bg-brand text-on-brand' : 'border-line-strong text-ink-2 hover:border-brand')}>{c}</button>
            ))}
          </div>
        </div>
        <button onClick={() => input.current?.click()} className={cx('flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center', file ? 'border-brand bg-brand-soft/50' : 'border-line-strong hover:border-brand')}>
          <Upload size={22} className="text-brand" />
          <span className="text-[14px] font-bold">{file ? file.name : 'PDF·사진·엑셀 고르기'}</span>
          <span className="text-[12px] text-ink-3">PDF는 쪽마다 그림으로 보여 주고, 글자는 대표님 AI 검색에 쓰입니다.</span>
        </button>
        <input ref={input} type="file" hidden accept="application/pdf,image/*,.xlsx,.xls,.hwp,.hwpx,.docx" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
        <Field label={cat === MINUTES ? '회의한 날' : '자료 날짜'}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="제목 (비우면 종류 이름)"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={cat === MINUTES ? '주간 공정회의 (감리단·협력업체)' : cat} /></Field>
        <Field label="한 줄 메모 (선택)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 감리 지적 3건, 타설 일정 확정" /></Field>
      </div>
    </Modal>
  );
}

/* ───────────── 자료실 (전체 목록) ───────────── */

type Period = '30' | '90' | '365' | '0';

export function DocsLibrary({ data }: { data: TalkSnapshot }) {
  const { snap, me } = useStore();
  const cats = useCategories(data);
  const [site, setSite] = useState('');
  const [cat, setCat] = useState('전체');
  const [period, setPeriod] = useState<Period>('90');
  const [q, setQ] = useState('');
  const [view, setView] = useState<SiteDoc | null>(null);
  const [upload, setUpload] = useState(false);
  const [mode, setMode] = useState<'cal' | 'list'>('cal');
  const match = useDocSearch(q);
  const allSites = useMemo(() => (snap ? visibleSites(snap) : []), [snap]);
  const sites = allSites.filter((s) => data.docs.some((d) => d.siteId === s.id) || data.rooms.some((r) => r.room.siteId === s.id));
  const names = new Map(allSites.map((s) => [s.id, s.name]));
  const from = period === '0' ? '' : shiftDay(todayIso(), -Number(period));
  const list = data.docs.filter((d) => (!site || d.siteId === site) && (cat === '전체' || d.category === cat) && (!from || d.docDate >= from)
    && (!match || match(d)));
  // 공사일보는 달력으로 (달을 넘겨 보므로 기간 필터는 쓰지 않는다)
  const calendar = cat === DAILY_LOG && !match && mode === 'cal';
  const calDocs = data.docs.filter((d) => d.category === DAILY_LOG && (!site || d.siteId === site));
  // 회의록 미등록 현장 (정기회의 요일이 정해진 현장방)
  const missing = data.rooms.map((r) => r.room).filter((r) => r.kind === 'site').map((r) => ({ r, day: minutesMissing(r, data.docs) })).filter((x) => x.day);
  const uploadable = allSites.filter((s) => me.isCeo || me.isAdmin || data.rooms.some((r) => r.room.siteId === s.id));

  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={site} onChange={(e) => setSite(e.target.value)} className="!h-9 !w-auto text-[13px]">
          <option value="">모든 현장</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="!h-9 !w-auto text-[13px]">
          <option value="30">최근 1개월</option><option value="90">최근 3개월</option><option value="365">최근 1년</option><option value="0">전체 기간</option>
        </Select>
        <div className="relative min-w-[180px] flex-1 sm:max-w-[280px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색 (제목·메모·PDF 내용)" className="!h-9 pl-8" />
        </div>
        {uploadable.length > 0 && <Button size="sm" tone="primary" className="ml-auto" onClick={() => setUpload(true)}><Upload size={15} />자료 올리기</Button>}
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {['전체', ...cats].map((c) => (
          <button key={c} onClick={() => setCat(c)} className={cx('rounded-full px-3 py-1 text-[13px] font-semibold', cat === c ? 'bg-ink text-bg' : 'bg-sunken text-ink-2 hover:text-ink')}>{c}</button>
        ))}
        {cat === DAILY_LOG && !match && <span className="ml-auto"><ViewToggle value={mode} onChange={setMode} /></span>}
      </div>
      {missing.length > 0 && (
        <div className="mb-4 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[13.5px] font-bold"><AlertTriangle size={15} className="text-warn" />회의록 미등록 {missing.length}곳</p>
          <div className="flex flex-wrap gap-1.5">
            {missing.map(({ r, day }) => <span key={r.id} className="rounded-full bg-surface px-2.5 py-0.5 text-[12.5px] font-semibold">{r.name} · {dayLabel(day!)}</span>)}
          </div>
        </div>
      )}
      {calendar ? <Card className="p-4"><DocCalendar docs={calDocs} siteNames={site ? undefined : names} onOpen={setView} /></Card> : !list.length ? <Empty title="조건에 맞는 자료가 없습니다" icon={<FolderOpen size={22} />} /> : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {list.map((d) => {
              const who = snap?.members.find((x) => x.id === d.uploadedBy);
              return (
                <li key={d.id}>
                  <button onClick={() => setView(d)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sunken/60">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sunken text-ink-2">{d.fileType === 'image' ? <ImageIcon size={17} /> : <FileText size={17} />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5"><Badge tone={d.category === MINUTES ? 'brand' : 'neutral'}>{d.category}</Badge><span className="truncate text-[14px] font-bold">{d.title}</span></span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">{names.get(d.siteId) ?? '현장'} · {dayLabel(d.docDate)} · {who?.name ?? ''}{d.note ? ` · ${d.note}` : ''}</span>
                    </span>
                    <span className="hidden shrink-0 text-[12px] text-ink-3 sm:block">{d.fileName}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <p className="mt-3 text-[12px] text-ink-3">{me.isCeo || me.isAdmin || me.isExecutive ? '모든 현장의 자료가 보입니다.' : '내가 들어가 있는 현장방의 자료만 보입니다.'} 파일은 회사 서버 저장 공간에 현장·종류별로 보관됩니다.</p>
      {view && <DocViewer d={view} onClose={() => setView(null)} />}
      {upload && <UploadModal siteId={null} sites={uploadable} cats={cats} defaultCat={cat === '전체' ? cats[0] : cat} defaultDate={() => todayIso()} onClose={() => setUpload(false)} />}
    </div>
  );
}

/* ───────────── 보기 ───────────── */

/** 자료 보기: PDF는 쪽을 그림으로 차례로 보여 준다 */
export function DocViewer({ d, onClose }: { d: SiteDoc; onClose(): void }) {
  const { me, snap, toast } = useStore();
  const [pages, setPages] = useState<string[]>(d.fileType === 'image' ? [d.url] : []);
  const [total, setTotal] = useState<number | null>(d.fileType === 'pdf' ? null : d.fileType === 'image' ? 1 : 0);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (d.fileType !== 'pdf') return;
    let alive = true;
    const width = Math.min(1600, Math.round(Math.min(window.innerWidth, 900) * (window.devicePixelRatio || 1)));
    renderPdfPages(d.url, width, (i, t, img) => { if (!alive) return; setTotal(t); setPages((p) => { const n = [...p]; n[i] = img; return n; }); })
      .catch(() => alive && setErr('PDF를 그림으로 바꾸지 못했습니다. 원본 내려받기로 열어 보세요.'));
    return () => { alive = false; };
  }, [d.url, d.fileType]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const site = snap?.sites.find((s) => s.id === d.siteId);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col bg-[#111]" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      <header className="flex items-center gap-2 px-3 py-2 text-white">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold">{d.category} · {d.title}</p>
          <p className="truncate text-[12px] text-white/70">{site?.name} · {dayLabel(d.docDate)}{total ? ` · ${total}쪽` : ''}</p>
        </div>
        <a href={d.url} target="_blank" rel="noopener noreferrer" className="flex h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-[13px] font-semibold hover:bg-white/25"><Download size={15} />원본</a>
        {(d.uploadedBy === me.id || me.isAdmin || me.isCeo) && (
          <IconButton label="지우기" className="!text-white hover:!bg-white/15" onClick={() => {
            if (!confirm('이 자료를 지울까요?')) return;
            void api.talk.docs.remove(d.id).then(() => { onClose(); return refreshTalk(); }).catch((e) => toast(e.message, 'error'));
          }}><Trash2 size={17} /></IconButton>
        )}
        <button onClick={onClose} className="flex h-9 items-center rounded-lg bg-white/15 px-3 text-[13px] font-semibold hover:bg-white/25">닫기</button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-6 sm:px-6">
        <div className="mx-auto max-w-[900px] space-y-3">
          {pages.map((src, i) => src && <img key={i} src={src} alt={`${i + 1}쪽`} className="w-full rounded-md bg-white shadow-lg" />)}
          {d.fileType === 'file' && <p className="py-16 text-center text-[14px] text-white/80">미리 볼 수 없는 파일입니다. [원본]으로 내려받아 여세요.</p>}
          {err && <p className="py-10 text-center text-[14px] text-white/80">{err}</p>}
          {!err && d.fileType === 'pdf' && (total == null || pages.filter(Boolean).length < total) && <div className="flex justify-center py-8"><Spinner className="h-6 w-6 text-white" /></div>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
