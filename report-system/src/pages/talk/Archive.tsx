import JSZip from 'jszip';
import { Download, ExternalLink, FileSpreadsheet, FileText, FolderOpen, Images, Lock, MessageSquare, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ImageViewer } from '../../components/Photos';
import { Badge, Button, Card, cx, Empty, Input, Segmented, Select, Spinner } from '../../components/ui';
import { api } from '../../lib/client';
import { byId } from '../../lib/derive';
import { fileKind, formatBytes, triggerDownload } from '../../lib/fileTypes';
import { ARCHIVE_SOURCES, canSeeArchive, type ArchiveItem, type ArchiveSource, type TalkSnapshot } from '../../lib/talkTypes';
import { dayLabel, shiftDay, todayIso, toIsoDate } from '../../lib/week';
import { useStore } from '../../state/store';
import { DocsLibrary } from './Docs';
import { archiveOn } from './useTalk';

/** 자료실: [현장 서류]는 누구나(볼 수 있는 현장만), [전체 사진]·[전체 파일]은 대표님·관리자·권한 받은 사람만 */
export function DocsArea({ data, onOpenRoom }: { data: TalkSnapshot; onOpenRoom(roomId: string): void }) {
  const { me } = useStore();
  const [part, setPart] = useState<'docs' | 'photo' | 'file'>('docs');
  if (!archiveOn() || !canSeeArchive(me, data.settings)) return <DocsLibrary data={data} />;
  return (
    <div className="mx-auto max-w-[1200px]">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented<'docs' | 'photo' | 'file'> value={part} onChange={setPart} options={[
          { id: 'docs', label: '현장 서류' }, { id: 'photo', label: '전체 사진' }, { id: 'file', label: '전체 파일' },
        ]} />
        {part !== 'docs' && <span className="flex items-center gap-1 text-[12.5px] text-ink-3"><Lock size={13} />대표님·관리자·권한 받은 사람만 보는 화면</span>}
      </div>
      {part === 'docs' ? <DocsLibrary data={data} /> : <ArchiveView key={part} kind={part} data={data} onOpenRoom={onOpenRoom} />}
    </div>
  );
}

type Period = '30' | '90' | '365' | '0';
type FileType = 'all' | 'pdf' | 'sheet' | 'hwp' | 'etc';
const FILE_TYPES: { id: FileType; label: string }[] = [
  { id: 'all', label: '모든 종류' }, { id: 'pdf', label: 'PDF' }, { id: 'sheet', label: '엑셀' }, { id: 'hwp', label: '한글·워드' }, { id: 'etc', label: '그 밖의 파일' },
];
const typeOf = (name: string): FileType => {
  const k = fileKind(name);
  return k === 'pdf' ? 'pdf' : k === 'sheet' ? 'sheet' : k === 'hwp' || k === 'doc' ? 'hwp' : 'etc';
};
const sourceLabel = (s: ArchiveSource) => ARCHIVE_SOURCES.find((x) => x.id === s)?.label ?? '';

function ArchiveView({ kind, data, onOpenRoom }: { kind: 'photo' | 'file'; data: TalkSnapshot; onOpenRoom(roomId: string): void }) {
  const { snap, toast } = useStore();
  const members = byId(snap?.members ?? []);
  const siteNames = new Map((snap?.sites ?? []).map((s) => [s.id, s.name]));
  const [items, setItems] = useState<ArchiveItem[] | null>(null);
  const [place, setPlace] = useState('');
  const [source, setSource] = useState<ArchiveSource | 'all'>('all');
  const [period, setPeriod] = useState<Period>('90');
  const [who, setWho] = useState('');
  const [ftype, setFtype] = useState<FileType>('all');
  const [q, setQ] = useState('');
  const [view, setView] = useState<{ list: ArchiveItem[]; i: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.talk.archive.list().then((x) => { if (alive) setItems(x); }).catch((e) => { if (alive) { setItems([]); toast(e instanceof Error ? e.message : '자료를 불러오지 못했습니다.', 'error'); } });
    void load();
    const off = api.talk.subscribe(() => void load());
    return () => { alive = false; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placeOf = (it: ArchiveItem) => (it.siteId ? siteNames.get(it.siteId) ?? '현장' : it.roomName ?? '본사');
  const placeKey = (it: ArchiveItem) => (it.siteId ? `site:${it.siteId}` : it.roomId ? `room:${it.roomId}` : 'none');
  const mine = useMemo(() => (items ?? []).filter((x) => x.kind === kind), [items, kind]);
  const places = useMemo(() => {
    const m = new Map<string, string>();
    mine.forEach((x) => m.set(placeKey(x), placeOf(x)));
    return [...m.entries()].sort((a, b) => (a[0].startsWith('site') === b[0].startsWith('site') ? a[1].localeCompare(b[1]) : a[0].startsWith('site') ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, snap]);
  const people = useMemo(() => [...new Set(mine.map((x) => x.authorId))].map((id) => members.get(id)).filter(Boolean).sort((a, b) => a!.name.localeCompare(b!.name)), [mine, members]);
  const sources = ARCHIVE_SOURCES.filter((s) => mine.some((x) => x.source === s.id));
  const from = period === '0' ? '' : shiftDay(todayIso(), -Number(period));
  const t = q.trim().toLowerCase();
  const list = mine.filter((x) => (!place || placeKey(x) === place) && (source === 'all' || x.source === source) && (!who || x.authorId === who)
    && (!from || toIsoDate(new Date(x.at)) >= from) && (kind === 'photo' || ftype === 'all' || typeOf(x.name) === ftype)
    && (!t || `${x.name} ${placeOf(x)} ${x.category ?? ''} ${members.get(x.authorId)?.name ?? ''}`.toLowerCase().includes(t)));
  const days = useMemo(() => {
    const m = new Map<string, ArchiveItem[]>();
    for (const x of list) { const d = toIsoDate(new Date(x.at)); m.set(d, [...(m.get(d) ?? []), x]); }
    return [...m.entries()];
  }, [list]);
  const canOpen = (roomId: string | null) => !!roomId && data.rooms.some((r) => r.room.id === roomId);

  const zip = async (key: string, xs: ArchiveItem[], name: string) => {
    setBusy(key);
    try {
      const z = new JSZip();
      await Promise.all(xs.map(async (p, i) => {
        const b = await (await fetch(p.url)).blob();
        const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_');
        z.file(`${safe(placeOf(p))}/${String(i + 1).padStart(2, '0')}_${safe(members.get(p.authorId)?.name ?? '')}_${safe(p.name)}`, b);
      }));
      const url = URL.createObjectURL(await z.generateAsync({ type: 'blob' }));
      triggerDownload(url, name);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { toast('내려받지 못했습니다.', 'error'); } finally { setBusy(null); }
  };

  if (!items) return <div className="flex justify-center py-20"><Spinner /></div>;
  const cur = view?.list[view.i];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={place} onChange={(e) => setPlace(e.target.value)} className="!h-9 !w-auto max-w-[220px] text-[13px]" aria-label="현장·방">
          <option value="">모든 현장·방</option>
          {places.map(([k, label]) => <option key={k} value={k}>{k.startsWith('room') ? `${label} (방)` : label}</option>)}
        </Select>
        <Select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="!h-9 !w-auto text-[13px]" aria-label="기간">
          <option value="30">최근 1개월</option><option value="90">최근 3개월</option><option value="365">최근 1년</option><option value="0">전체 기간</option>
        </Select>
        <Select value={who} onChange={(e) => setWho(e.target.value)} className="!h-9 !w-auto text-[13px]" aria-label="올린 사람">
          <option value="">올린 사람 전체</option>
          {people.map((m) => <option key={m!.id} value={m!.id}>{m!.name} {m!.title}</option>)}
        </Select>
        <div className="relative min-w-[160px] flex-1 sm:max-w-[260px]">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'photo' ? '검색 (현장·사람·파일 이름)' : '검색 (파일 이름·현장·사람)'} className="!h-9 pl-8" />
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {[{ id: 'all' as const, label: '전체' }, ...sources].map((s) => (
          <button key={s.id} onClick={() => setSource(s.id)} className={cx('rounded-full px-3 py-1 text-[13px] font-semibold', source === s.id ? 'bg-ink text-bg' : 'bg-sunken text-ink-2 hover:text-ink')}>{s.label}</button>
        ))}
        {kind === 'file' && <span className="mx-1 h-4 w-px bg-line" />}
        {kind === 'file' && FILE_TYPES.map((f) => (
          <button key={f.id} onClick={() => setFtype(f.id)} className={cx('rounded-full px-3 py-1 text-[13px] font-semibold', ftype === f.id ? 'bg-brand text-white' : 'bg-sunken text-ink-2 hover:text-ink')}>{f.label}</button>
        ))}
        <span className="ml-auto text-[13px] font-semibold text-ink-2">
          {kind === 'photo' ? `사진 ${list.length}장` : `파일 ${list.length}개 · ${formatBytes(list.reduce((n, x) => n + x.size, 0))}`}
        </span>
      </div>

      {!list.length ? (
        <Empty title={mine.length ? '조건에 맞는 자료가 없습니다' : kind === 'photo' ? '아직 모인 사진이 없습니다' : '아직 모인 파일이 없습니다'} icon={kind === 'photo' ? <Images size={22} /> : <FolderOpen size={22} />}>
          채팅방(1:1 대화 제외)과 일일·주간보고에 올린 {kind === 'photo' ? '사진' : '파일'}이 여기에 모입니다.
        </Empty>
      ) : kind === 'photo' ? (
        <div className="space-y-5">
          {days.map(([day, xs]) => (
            <section key={day}>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-[14px] font-bold">{dayLabel(day)}</p>
                <span className="text-[12.5px] text-ink-3">{xs.length}장 · {[...new Set(xs.map(placeOf))].slice(0, 3).join(', ')}{new Set(xs.map(placeOf)).size > 3 ? ' 외' : ''}</span>
                <Button size="sm" tone="ghost" className="ml-auto" disabled={busy === day} onClick={() => void zip(day, xs, `사진_${day}.zip`)}>
                  {busy === day ? <Spinner /> : <Download size={14} />}<span className="hidden sm:inline">이 날 사진</span> 모두 받기
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-5 lg:grid-cols-6">
                {xs.map((p, i) => (
                  <button key={p.id} onClick={() => setView({ list: xs, i })} className="min-w-0 text-left" title={`${placeOf(p)} · ${members.get(p.authorId)?.name ?? ''}`}>
                    <span className="relative block aspect-square overflow-hidden rounded-lg bg-sunken">
                      <img src={p.url} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
                      <span className="absolute left-1 top-1 rounded bg-black/55 px-1 text-[10.5px] font-semibold text-white">{sourceLabel(p.source)}</span>
                    </span>
                    <span className="mt-1 block truncate text-[12px] font-semibold text-ink-2">{placeOf(p)}</span>
                    <span className="block truncate text-[11.5px] text-ink-3">{members.get(p.authorId)?.name ?? ''}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {list.map((f) => {
              const tp = typeOf(f.name);
              return (
                <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 sm:px-4">
                  <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', tp === 'pdf' ? 'bg-danger/10 text-danger' : tp === 'sheet' ? 'bg-ok/10 text-ok' : 'bg-sunken text-ink-2')}>
                    {tp === 'sheet' ? <FileSpreadsheet size={17} /> : <FileText size={17} />}
                  </span>
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1 hover:underline">
                    <span className="flex items-center gap-1.5">
                      <Badge tone="neutral">{f.category ?? sourceLabel(f.source)}</Badge>
                      <span className="truncate text-[14px] font-bold">{f.name}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-ink-3">
                      {placeOf(f)} · {dayLabel(toIsoDate(new Date(f.at)))} · {members.get(f.authorId)?.name ?? ''}{f.size ? ` · ${formatBytes(f.size)}` : ''}
                    </span>
                  </a>
                  {canOpen(f.roomId) && (
                    <Button size="sm" tone="ghost" onClick={() => onOpenRoom(f.roomId!)} title="이 파일이 올라온 대화로 가기"><MessageSquare size={14} /><span className="hidden sm:inline">대화 보기</span></Button>
                  )}
                  <a href={f.url} target="_blank" rel="noopener noreferrer" aria-label="새 창으로 열기" className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-sunken hover:text-ink"><ExternalLink size={15} /></a>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
      <p className="mt-3 text-[12px] text-ink-3">1:1 대화와 부서 안 보고의 자료는 넣지 않습니다. 파일을 따로 복사하지 않고 원래 올린 곳의 파일을 보여 주므로 저장 공간이 늘지 않습니다.</p>

      {view && cur && (
        <ImageViewer urls={view.list.map((x) => x.url)} index={view.i} onIndex={(i) => setView({ ...view, i })} onClose={() => setView(null)}
          meta={<>
            <b>{placeOf(cur)}</b> · {members.get(cur.authorId)?.name ?? ''} · {sourceLabel(cur.source)} · {dayLabel(toIsoDate(new Date(cur.at)))}{' '}
            {canOpen(cur.roomId) && <button className="ml-1 rounded bg-white/15 px-2 py-0.5 font-semibold hover:bg-white/25" onClick={() => { setView(null); onOpenRoom(cur.roomId!); }}>대화 보기</button>}
            <a className="ml-1 rounded bg-white/15 px-2 py-0.5 font-semibold hover:bg-white/25" href={cur.url} target="_blank" rel="noopener noreferrer">원본</a>
          </>} />
      )}
    </div>
  );
}
