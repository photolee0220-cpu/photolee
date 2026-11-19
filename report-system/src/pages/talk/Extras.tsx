import JSZip from 'jszip';
import { AlertOctagon, CalendarPlus, Download, Images } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/client';
import { byId } from '../../lib/derive';
import { triggerDownload } from '../../lib/fileTypes';
import type { ChatMessage, ChatRoom, Notice, TalkSnapshot } from '../../lib/talkTypes';
import type { CalendarEvent } from '../../lib/types';
import { dayLabel, shiftDay, todayIso, toIsoDate } from '../../lib/week';
import { useStore } from '../../state/store';
import { ImageViewer } from '../../components/Photos';
import { Button, cx, Empty, Field, Input, Modal, Select, Spinner } from '../../components/ui';
import { refreshTalk, talkExtras, useTalk } from './useTalk';
import { roomTitle } from './Chat';

/* ───────────── 사진 앨범 (방에 올라온 사진을 날짜별로) ───────────── */

interface AlbumPhoto { url: string; name: string; authorId: string; at: string }

export function AlbumTab({ room }: { room: ChatRoom }) {
  const { snap, toast } = useStore();
  const members = byId(snap?.members ?? []);
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [view, setView] = useState<{ urls: string[]; i: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.talk.messages(room.id).then((m) => { if (alive) setMsgs(m); }).catch(() => alive && setMsgs([]));
    void load();
    const off = api.talk.subscribe(() => void load());
    return () => { alive = false; off(); };
  }, [room.id]);
  const days = useMemo(() => {
    const map = new Map<string, AlbumPhoto[]>();
    for (const m of msgs ?? []) {
      if (m.deleted || m.hidden) continue;
      for (const a of m.attachments) {
        if (a.kind !== 'image') continue;
        const d = toIsoDate(new Date(m.createdAt));
        map.set(d, [...(map.get(d) ?? []), { url: a.url, name: a.name, authorId: m.authorId, at: m.createdAt }]);
      }
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [msgs]);

  const zip = async (day: string, list: AlbumPhoto[]) => {
    setBusy(day);
    try {
      const z = new JSZip();
      await Promise.all(list.map(async (p, i) => {
        const b = await (await fetch(p.url)).blob();
        const who = members.get(p.authorId)?.name ?? '';
        z.file(`${String(i + 1).padStart(2, '0')}_${who}_${p.name.replace(/[\\/:*?"<>|]/g, '_')}`.replace(/(\.[a-z]+)?$/i, (m) => m || '.jpg'), b);
      }));
      const url = URL.createObjectURL(await z.generateAsync({ type: 'blob' }));
      triggerDownload(url, `${room.name || '사진'}_${day}.zip`);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch { toast('사진을 받지 못했습니다.', 'error'); } finally { setBusy(null); }
  };

  if (!msgs) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  return (
    <div className="h-full overflow-y-auto px-3 py-3 scrollbar-thin sm:px-5">
      {!days.length && <Empty title="아직 올라온 사진이 없습니다" icon={<Images size={22} />}>채팅에 붙인 사진이 날짜별로 여기에 모입니다.</Empty>}
      <div className="space-y-5">
        {days.map(([day, list]) => (
          <section key={day}>
            <div className="mb-2 flex items-center gap-2">
              <p className="text-[14px] font-bold">{dayLabel(day)}</p>
              <span className="text-[12.5px] text-ink-3">{list.length}장</span>
              <Button size="sm" tone="ghost" className="ml-auto" disabled={busy === day} onClick={() => void zip(day, list)}>
                {busy === day ? <Spinner /> : <Download size={14} />}이 날 사진 모두 받기
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5 lg:grid-cols-6">
              {list.map((p, i) => (
                <button key={`${p.url}${i}`} onClick={() => setView({ urls: list.map((x) => x.url), i })} className="aspect-square overflow-hidden rounded-lg bg-sunken">
                  <img src={p.url} alt={p.name} loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      {view && <ImageViewer urls={view.urls} index={view.i} onIndex={(i) => setView({ ...view, i })} onClose={() => setView(null)} />}
    </div>
  );
}

/* ───────────── 모든 방에서 대화 찾기 ───────────── */

export function GlobalSearchResults({ q, data, onOpen }: { q: string; data: TalkSnapshot; onOpen(roomId: string, q: string): void }) {
  const { me, snap } = useStore();
  const members = byId(snap?.members ?? []);
  const [hits, setHits] = useState<ChatMessage[] | null>(null);
  const t = q.trim();
  useEffect(() => {
    if (t.length < 2) { setHits(null); return; }
    const timer = setTimeout(() => { api.talk.searchMessages(t).then(setHits).catch(() => setHits([])); }, 300);
    return () => clearTimeout(timer);
  }, [t]);
  if (t.length < 2 || !hits) return null;
  const rooms = new Map(data.rooms.map((r) => [r.room.id, r.room]));
  return (
    <li className="mt-2 border-t border-line pt-2">
      <p className="px-2.5 pb-1 text-[12px] font-bold text-ink-3">대화 내용 {hits.length}건</p>
      {!hits.length && <p className="px-2.5 py-3 text-[12.5px] text-ink-3">대화에 이 말이 없습니다</p>}
      <ul>
        {hits.map((m) => {
          const room = rooms.get(m.roomId);
          const i = m.text.indexOf(t);
          const before = m.text.slice(Math.max(0, i - 18), i);
          return (
            <li key={m.id}>
              <button onClick={() => onOpen(m.roomId, t)} className="w-full rounded-xl px-2.5 py-2 text-left hover:bg-sunken">
                <span className="flex items-center gap-1.5 text-[12px] text-ink-3">
                  <b className="truncate text-ink-2">{room ? roomTitle(room, members, me.id) : '방'}</b>
                  <span className="shrink-0">· {members.get(m.authorId)?.name ?? ''}</span>
                  <span className="ml-auto shrink-0">{new Date(m.createdAt).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}</span>
                </span>
                <span className="mt-0.5 block truncate text-[13px]">
                  {i > 18 && '…'}{before}<mark className="rounded bg-em-hl px-0.5 text-ink">{t}</mark>{m.text.slice(i + t.length, i + t.length + 40)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </li>
  );
}

/* ───────────── 채팅 → 캘린더 일정 ───────────── */

const DOWS = ['일', '월', '화', '수', '목', '금', '토'];

/** 메시지에서 날짜를 짐작한다: 10/27, 10월 27일, 내일, 모레, (다음 주) 화요일 */
export function guessDate(text: string, today = todayIso()): string {
  const y = Number(today.slice(0, 4));
  const md = /(\d{1,2})\s*(?:\/|월)\s*(\d{1,2})\s*일?/.exec(text);
  if (md) {
    const m = Number(md[1]); const d = Number(md[2]);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      let iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      if (iso < shiftDay(today, -60)) iso = `${y + 1}${iso.slice(4)}`;
      return iso;
    }
  }
  if (/모레/.test(text)) return shiftDay(today, 2);
  if (/내일/.test(text)) return shiftDay(today, 1);
  const w = /(다음\s*주\s*)?([월화수목금토일])요일/.exec(text);
  if (w) {
    const target = DOWS.indexOf(w[2]);
    const cur = new Date(`${today}T00:00:00`).getDay();
    let add = (target - cur + 7) % 7 || 7;
    if (w[1]) add = ((target === 0 ? 7 : target) - (cur === 0 ? 7 : cur)) + 7;
    return shiftDay(today, add);
  }
  return today;
}

export function EventFromChat({ msg, room, onClose }: { msg: ChatMessage; room: ChatRoom; onClose(): void }) {
  const { me, snap, toast } = useStore();
  const sites = (snap?.sites ?? []).filter((s) => !s.archived);
  const [title, setTitle] = useState(msg.text.replace(/\s+/g, ' ').slice(0, 60));
  const [date, setDate] = useState(() => guessDate(msg.text));
  const [time, setTime] = useState(() => { const t = /(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/.exec(msg.text); return t ? `${t[1].padStart(2, '0')}:${(t[2] ?? '00').padStart(2, '0')}` : ''; });
  const [siteId, setSiteId] = useState(room.siteId ?? '');
  const [scope, setScope] = useState<'all' | 'dept'>(me.departmentId ? 'dept' : 'all');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const e: CalendarEvent = {
        id: `ev_${Date.now().toString(36)}`, title: title.trim(), startDate: date, endDate: date, time, siteId: siteId || null, scope,
        departmentId: me.departmentId ?? null, memo: `소통 ${room.name ? `'${room.name}'` : ''} 대화에서 등록`, createdBy: me.id, updatedAt: new Date().toISOString(),
      };
      await api.calendar.save(e);
      await api.talk.note(room.id, `캘린더에 일정을 등록했습니다: ${dayLabel(date)}${time ? ` ${time}` : ''} ${title.trim()}`, msg.id);
      await refreshTalk();
      toast('캘린더에 등록했습니다.');
      onClose();
    } catch (err) { toast(err instanceof Error ? err.message : '등록하지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><CalendarPlus size={18} className="text-brand" />캘린더에 일정 등록</span>} width={460}
      footer={<><Button onClick={onClose}>취소</Button><Button tone="primary" disabled={busy || !title.trim()} onClick={() => void save()}>{busy && <Spinner />}등록</Button></>}>
      <div className="space-y-3">
        <Field label="일정"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="날짜" hint="메시지에서 날짜를 찾아 넣었습니다"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="시간 (선택)"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
        </div>
        <Field label="현장 (선택)">
          <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">현장 없음</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="누가 볼 일정인가요">
          <Select value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'dept')}>
            {me.departmentId && <option value="dept">우리 부서</option>}
            <option value="all">전체</option>
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

/* ───────────── 긴급 공지: 확인할 때까지 화면을 가린다 ───────────── */

export function UrgentGate() {
  const { me, snap } = useStore();
  const { data } = useTalk();
  const [busy, setBusy] = useState(false);
  if (!talkExtras() || !data) return null;
  const n: Notice | undefined = data.notices.find((x) => x.urgent && x.authorId !== me.id && !x.acks[me.id]);
  if (!n) return null;
  const author = snap?.members.find((m) => m.id === n.authorId);
  const ack = async () => {
    setBusy(true);
    try { await api.talk.notices.ack(n.id); await refreshTalk(); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-danger/85 p-4" role="alertdialog" aria-modal="true">
      <div className="w-full max-w-[520px] overflow-hidden rounded-2xl bg-surface shadow-pop">
        <div className="flex items-center gap-2 bg-danger px-5 py-3 text-white">
          <AlertOctagon size={20} />
          <p className="text-[16px] font-extrabold">긴급 공지</p>
          <span className="ml-auto text-[12.5px] text-white/85">{author?.name} {author?.title} · {new Date(n.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <p className="text-[18px] font-extrabold leading-snug">{n.title}</p>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-[1.75]">{n.body}</p>
        </div>
        <div className="border-t border-line px-5 py-3">
          <Button tone="primary" className={cx('w-full !h-12 !bg-danger text-[15px]')} disabled={busy} onClick={() => void ack()}>{busy && <Spinner />}확인했습니다</Button>
          <p className="mt-2 text-center text-[12px] text-ink-3">확인을 누르기 전까지 이 화면이 닫히지 않습니다. 누가 확인했는지 대표님께 보입니다.</p>
        </div>
      </div>
    </div>
  );
}
