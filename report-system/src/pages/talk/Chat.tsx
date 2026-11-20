import {
  Bell, BellOff, Church, ClipboardCheck, Copy, CornerUpLeft, FileText, HardHat, MessageCircle, MoreHorizontal, Paperclip, Pencil, Pin, Plus,
  Search, Send, Settings2, ShieldAlert, Trash2, Users, X, Eye, EyeOff, FolderOpen, Star, CalendarPlus,
} from 'lucide-react';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../../lib/client';
import { byId } from '../../lib/derive';
import type { ChatMessage, ChatRoom, RoomSummary, TalkSnapshot } from '../../lib/talkTypes';
import type { Member } from '../../lib/types';
import { dayLabel, toIsoDate } from '../../lib/week';
import { useStore } from '../../state/store';
import { ImageViewer } from '../../components/Photos';
import { Avatar, Button, cx, Empty, IconButton, Input, Modal, Segmented, Spinner } from '../../components/ui';
import { InquiryBoard } from './Inquiries';
import { DocsTab } from './Docs';
import { RoomEditor } from './RoomEditor';
import { refreshTalk, talkExtras, useTalk } from './useTalk';
import { AlbumTab, EventFromChat, GlobalSearchResults } from './Extras';

/* ───────────── 공통 ───────────── */

export function roomTitle(room: ChatRoom, members: Map<string, Member>, meId: string): string {
  if (room.kind !== 'dm') return room.name;
  const other = members.get(room.memberIds.find((id) => id !== meId) ?? '');
  return other ? `${other.name} ${other.title}` : '대화 상대';
}

export function RoomIcon({ room, size = 18 }: { room: ChatRoom; size?: number }) {
  const map = { group: Users, site: HardHat, inquiry: Church, safety: ShieldAlert, dm: MessageCircle } as const;
  const Icon = map[room.kind];
  const tone = room.kind === 'safety' ? 'bg-danger/10 text-danger' : room.kind === 'site' ? 'bg-warn/15 text-warn' : room.kind === 'inquiry' ? 'bg-ok-soft text-ok' : 'bg-brand-soft text-brand-ink';
  return <span className={cx('flex shrink-0 items-center justify-center rounded-xl', tone)} style={{ width: size + 18, height: size + 18 }}><Icon size={size} /></span>;
}

function timeOf(iso: string) {
  const d = new Date(iso);
  return `${d.getHours() < 12 ? '오전' : '오후'} ${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function shortWhen(iso: string) {
  const d = new Date(iso);
  if (toIsoDate(d) === toIsoDate(new Date())) return timeOf(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function preview(m: ChatMessage | null, members: Map<string, Member>) {
  if (!m) return '아직 대화가 없습니다';
  if (m.deleted) return '삭제된 메시지';
  const who = m.system ? '' : `${members.get(m.authorId)?.name ?? ''}: `;
  const body = m.text || (m.attachments.length ? (m.attachments[0].kind === 'image' ? '사진' : '파일') : '');
  return `${m.safety ? '[안전] ' : ''}${who}${body}`.replace(/\n/g, ' ');
}

/* ───────────── 방 목록 ───────────── */

type RoomFilter = 'all' | 'site' | 'group' | 'dm';

export function RoomList({ data, activeId, onOpen }: { data: TalkSnapshot; activeId: string | null; onOpen(id: string, query?: string): void }) {
  const { me, snap } = useStore();
  const members = useMemo(() => byId(snap?.members ?? []), [snap]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<RoomFilter>('all');
  const [dm, setDm] = useState(false);
  const list = data.rooms.filter((r) => {
    if (filter === 'site' && r.room.kind !== 'site') return false;
    if (filter === 'dm' && r.room.kind !== 'dm') return false;
    if (filter === 'group' && (r.room.kind === 'site' || r.room.kind === 'dm')) return false;
    return !q.trim() || roomTitle(r.room, members, me.id).includes(q.trim());
  }).sort((a, b) => Number(!!b.starred) - Number(!!a.starred));
  const unreadOf = (k: RoomFilter) => data.rooms.filter((r) => (k === 'site' ? r.room.kind === 'site' : k === 'dm' ? r.room.kind === 'dm' : r.room.kind !== 'site' && r.room.kind !== 'dm')).reduce((n, r) => n + r.unread, 0);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 p-3">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={talkExtras() ? '방 이름·대화 내용 검색' : '방 이름 검색'} className="!h-9 pl-9" />
        </div>
        <Button size="sm" onClick={() => setDm(true)} title="1:1 대화 시작"><Plus size={15} />1:1</Button>
      </div>
      <div className="flex gap-1 px-3 pb-2">
        {([['all', '전체'], ['site', '현장'], ['group', '부서·기타'], ['dm', '1:1']] as [RoomFilter, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setFilter(id)} className={cx('rounded-full px-2.5 py-1 text-[12px] font-semibold', filter === id ? 'bg-ink text-bg' : 'bg-sunken text-ink-2 hover:text-ink')}>
            {label}{id !== 'all' && unreadOf(id) > 0 && <span className="ml-1 text-danger">{unreadOf(id)}</span>}
          </button>
        ))}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3 scrollbar-thin">
        {list.map((r) => <RoomRow key={r.room.id} r={r} active={r.room.id === activeId} members={members} meId={me.id} onOpen={() => onOpen(r.room.id)} />)}
        {!list.length && <li className="px-4 py-10 text-center text-[13px] text-ink-3">{data.rooms.length ? '이름이 맞는 방이 없습니다' : '아직 들어가 있는 방이 없습니다. 관리자가 방에 넣어 주면 여기에 보입니다.'}</li>}
        {talkExtras() && <GlobalSearchResults q={q} data={data} onOpen={onOpen} />}
      </ul>
      {dm && <NewDmModal onClose={() => setDm(false)} onOpened={(id) => { setDm(false); onOpen(id); }} />}
    </div>
  );
}

function RoomRow({ r, active, members, meId, onOpen }: { r: RoomSummary; active: boolean; members: Map<string, Member>; meId: string; onOpen(): void }) {
  const muted = r.room.mutedBy.includes(meId);
  const other = r.room.kind === 'dm' ? members.get(r.room.memberIds.find((id) => id !== meId) ?? '') : null;
  return (
    <li>
      <button onClick={onOpen} className={cx('flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors', active ? 'bg-brand-soft' : 'hover:bg-sunken')}>
        {other ? <Avatar id={other.id} name={other.name} size={36} /> : <RoomIcon room={r.room} />}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-bold">{roomTitle(r.room, members, meId)}</span>
            {r.room.kind !== 'dm' && <span className="shrink-0 text-[12px] text-ink-3">{r.room.memberIds.length}</span>}
            {muted && <BellOff size={12} className="shrink-0 text-ink-3" />}
            {r.starred && <Star size={12} className="shrink-0 fill-warn text-warn" />}
            <span className="ml-auto shrink-0 text-[11.5px] text-ink-3">{r.last ? shortWhen(r.last.createdAt) : ''}</span>
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            <span className="truncate text-[12.5px] text-ink-3">{preview(r.last, members)}</span>
            {r.unread > 0 && <span className={cx('ml-auto shrink-0 rounded-full px-1.5 text-[11px] font-bold leading-[18px] text-white', muted ? 'bg-ink-3' : 'bg-danger')}>{r.unread > 99 ? '99+' : r.unread}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

function NewDmModal({ onClose, onOpened }: { onClose(): void; onOpened(id: string): void }) {
  const { me, snap, toast } = useStore();
  const [q, setQ] = useState('');
  const depts = byId(snap?.departments ?? []);
  const people = (snap?.members ?? []).filter((m) => m.active && m.id !== me.id && (!q.trim() || `${m.name}${m.title}${depts.get(m.departmentId ?? '')?.name ?? ''}`.includes(q.trim())));
  const open = async (id: string) => {
    try { const r = await api.talk.openDm(id); await refreshTalk(); onOpened(r.id); } catch (e) { toast(e instanceof Error ? e.message : '열지 못했습니다.', 'error'); }
  };
  return (
    <Modal open onClose={onClose} title="1:1 대화" width={420}>
      <p className="mb-3 text-[12.5px] text-ink-3">1:1 대화는 두 사람만 볼 수 있습니다. 관리자도 볼 수 없습니다.</p>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·부서 검색" />
      <ul className="mt-2 max-h-[50vh] overflow-y-auto">
        {people.map((m) => (
          <li key={m.id}>
            <button onClick={() => void open(m.id)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-sunken">
              <Avatar id={m.id} name={m.name} size={32} />
              <span className="text-[14px] font-semibold">{m.name} <span className="font-normal text-ink-3">{m.title}</span></span>
              <span className="ml-auto text-[12px] text-ink-3">{m.isCeo ? '대표' : depts.get(m.departmentId ?? '')?.name ?? ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ───────────── 방 화면 ───────────── */

export function RoomView({ data, roomId, onBack, onRoom, initialQuery }: { data: TalkSnapshot; roomId: string; onBack?: () => void; onRoom(id: string): void; initialQuery?: string }) {
  const { me, snap } = useStore();
  const members = useMemo(() => byId(snap?.members ?? []), [snap]);
  const summary = data.rooms.find((r) => r.room.id === roomId);
  const [tab, setTab] = useState<'chat' | 'docs' | 'cards' | 'album'>('chat');
  const [showMembers, setShowMembers] = useState(false);
  const [edit, setEdit] = useState(false);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const { toast } = useStore();
  // 전체 검색에서 들어오면 그 말로 방 안을 찾은 채로 연다
  useEffect(() => { setTab(summary?.room.kind === 'inquiry' && !initialQuery ? 'cards' : 'chat'); setSearching(!!initialQuery); setQ(initialQuery ?? ''); }, [roomId, summary?.room.kind, initialQuery]);
  if (!summary) return <Empty title="방을 찾을 수 없습니다" />;
  const room = summary.room;
  const muted = room.mutedBy.includes(me.id);
  const other = room.kind === 'dm' ? members.get(room.memberIds.find((id) => id !== me.id) ?? '') : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <header className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5">
        {onBack && <IconButton label="뒤로" onClick={onBack}><span className="text-[20px] leading-none">‹</span></IconButton>}
        {other ? <Avatar id={other.id} name={other.name} size={32} /> : <RoomIcon room={room} size={16} />}
        <button className="min-w-0 flex-1 text-left" onClick={() => room.kind !== 'dm' && setShowMembers(true)}>
          <p className="truncate text-[15px] font-bold leading-tight">{roomTitle(room, members, me.id)}</p>
          <p className="truncate text-[12px] text-ink-3">{room.kind === 'dm' ? '두 사람만 볼 수 있는 대화' : `${room.memberIds.length}명 · 인원 보기`}</p>
        </button>
        {talkExtras() && (
          <IconButton label={summary.starred ? '고정 풀기' : '목록 맨 위에 고정'} onClick={() => void api.talk.setStarred(room.id, !summary.starred).then(refresh).catch((e) => toast(e.message, 'error'))}>
            <Star size={17} className={summary.starred ? 'fill-warn text-warn' : ''} />
          </IconButton>
        )}
        <IconButton label="대화 검색" onClick={() => { setSearching((v) => !v); setQ(''); }}><Search size={17} /></IconButton>
        <IconButton label={muted ? '알림 켜기' : '알림 끄기'} onClick={() => void api.talk.setMuted(room.id, !muted).then(refresh).catch((e) => toast(e.message, 'error'))}>
          {muted ? <BellOff size={17} /> : <Bell size={17} />}
        </IconButton>
        {me.isAdmin && room.kind !== 'dm' && <IconButton label="방 관리" onClick={() => setEdit(true)}><Settings2 size={17} /></IconButton>}
      </header>
      {searching && (
        <div className="border-b border-line bg-surface px-3 py-2">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="이 방 대화에서 찾기" className="!h-9" />
        </div>
      )}
      {(room.kind === 'site' || room.kind === 'inquiry' || talkExtras()) && (
        <div className="border-b border-line bg-surface px-3 py-2">
          <Segmented value={tab} onChange={(v) => setTab(v)} options={[
            ...(room.kind === 'inquiry' ? [{ id: 'cards' as const, label: `문의 카드 ${data.inquiries.filter((x) => !['won', 'closed', 'lost'].includes(x.stage)).length}` }] : []),
            { id: 'chat' as const, label: room.kind === 'inquiry' ? '전체 대화' : '대화' },
            ...(room.kind === 'site' ? [{ id: 'docs' as const, label: `자료 ${data.docs.filter((x) => x.siteId === room.siteId).length}` }] : []),
            ...(talkExtras() ? [{ id: 'album' as const, label: '사진' }] : []),
          ]} />
        </div>
      )}
      {tab === 'chat' && <PinnedBar room={room} />}
      <div className="min-h-0 flex-1">
        {tab === 'chat' && <Conversation key={room.id} summary={summary} query={q} onRoom={onRoom} />}
        {tab === 'docs' && room.siteId && <DocsTab room={room} data={data} docs={data.docs.filter((x) => x.siteId === room.siteId)} />}
        {tab === 'album' && <AlbumTab room={room} />}
        {tab === 'cards' && <InquiryBoard room={room} summary={summary} inquiries={data.inquiries} onRoom={onRoom} />}
      </div>
      {showMembers && <MembersModal room={room} onClose={() => setShowMembers(false)} onDm={(id) => { setShowMembers(false); void api.talk.openDm(id).then(async (r) => { await refresh(); onRoom(r.id); }); }} onManage={me.isAdmin ? () => { setShowMembers(false); setEdit(true); } : undefined} />}
      {edit && <RoomEditor room={room} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); void refresh(); }} />}
    </div>
  );
}

const refresh = () => refreshTalk();

function PinnedBar({ room }: { room: ChatRoom }) {
  const { snap, toast } = useStore();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(room.pinned);
  useEffect(() => setText(room.pinned), [room.pinned]);
  const save = (t: string) => api.talk.pin(room.id, t).then(() => { setEditing(false); return refresh(); }).catch((e) => toast(e.message, 'error'));
  if (editing) {
    return (
      <div className="flex items-center gap-2 border-b border-line bg-note/10 px-3 py-2">
        <Pin size={15} className="shrink-0 text-note" />
        <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="방 공지 (비우면 내림)" className="!h-9" onKeyDown={(e) => { if (e.key === 'Enter') void save(text); }} />
        <Button size="sm" tone="primary" onClick={() => void save(text)}>고정</Button>
        <Button size="sm" onClick={() => setEditing(false)}>취소</Button>
      </div>
    );
  }
  if (!room.pinned) {
    return room.kind === 'dm' ? null : (
      <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 border-b border-line bg-surface px-4 py-1.5 text-left text-[12px] text-ink-3 hover:text-ink-2"><Pin size={12} />방 공지 고정하기</button>
    );
  }
  const by = snap?.members.find((m) => m.id === room.pinnedBy);
  return (
    <button onClick={() => setEditing(true)} className="flex items-start gap-2 border-b border-line bg-note/10 px-4 py-2 text-left">
      <Pin size={14} className="mt-0.5 shrink-0 text-note" />
      <span className="min-w-0 flex-1 text-[13px] font-semibold leading-snug">{room.pinned}</span>
      {by && <span className="shrink-0 text-[11.5px] text-ink-3">{by.name}</span>}
    </button>
  );
}

function MembersModal({ room, onClose, onDm, onManage }: { room: ChatRoom; onClose(): void; onDm(id: string): void; onManage?: () => void }) {
  const { me, snap } = useStore();
  const depts = byId(snap?.departments ?? []);
  const people = (snap?.members ?? []).filter((m) => room.memberIds.includes(m.id));
  return (
    <Modal open onClose={onClose} title={`${room.name} · ${people.length}명`} width={420}
      footer={onManage ? <Button onClick={onManage}><Settings2 size={15} />인원·방 관리</Button> : undefined}>
      <p className="mb-2 text-[12.5px] text-ink-3">방 인원은 관리자가 넣고 뺍니다.</p>
      <ul>
        {people.map((m) => (
          <li key={m.id} className="flex items-center gap-3 rounded-lg px-1 py-2">
            <Avatar id={m.id} name={m.name} size={32} />
            <span className="min-w-0 flex-1 text-[14px] font-semibold">{m.name} <span className="font-normal text-ink-3">{m.title}</span>
              <span className="block text-[12px] font-normal text-ink-3">{m.isCeo ? '대표' : depts.get(m.departmentId ?? '')?.name ?? ''}</span></span>
            {m.id !== me.id && <Button size="sm" tone="ghost" onClick={() => onDm(m.id)}><MessageCircle size={14} />1:1</Button>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ───────────── 대화 ───────────── */

export function Conversation({ summary, query = '', inquiryId, onRoom }: { summary: RoomSummary; query?: string; inquiryId?: string; onRoom(id: string): void }) {
  const { me, snap, toast } = useStore();
  const members = useMemo(() => byId(snap?.members ?? []), [snap]);
  const room = summary.room;
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [reply, setReply] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menu, setMenu] = useState<{ msg: ChatMessage; x: number; y: number; touch: boolean } | null>(null);
  const [directive, setDirective] = useState<ChatMessage | null>(null);
  const [eventOf, setEventOf] = useState<ChatMessage | null>(null);
  const [viewer, setViewer] = useState<{ urls: string[]; i: number } | null>(null);
  const { data: talk } = useTalk();
  const deleteMs = (talk?.settings.deleteMinutes ?? 5) * 60000;
  const bottom = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  const load = useCallback(async () => {
    try {
      const list = await api.talk.messages(room.id);
      setMsgs(list);
      if (document.visibilityState === 'visible') await api.talk.markRead(room.id);
    } catch (e) { toast(e instanceof Error ? e.message : '불러오지 못했습니다.', 'error'); }
  }, [room.id, toast]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => api.talk.subscribe(() => void load()), [load]);
  const shown = useMemo(() => (msgs ?? []).filter((m) => (!inquiryId || m.inquiryId === inquiryId) && (!query.trim() || m.text.includes(query.trim()))), [msgs, inquiryId, query]);
  useEffect(() => {
    const el = scroller.current;
    if (!el || query) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (first.current || near) bottom.current?.scrollIntoView({ block: 'end' });
    if (shown.length) first.current = false;
  }, [shown.length, query]);

  const byMsg = useMemo(() => new Map((msgs ?? []).map((m) => [m.id, m])), [msgs]);
  const unreadFor = (m: ChatMessage) => room.memberIds.filter((id) => id !== m.authorId && (summary.reads[id] ?? '') < m.createdAt).length;
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); await load(); void refresh(); } catch (e) { toast(e instanceof Error ? e.message : '처리하지 못했습니다.', 'error'); } };

  if (!msgs) return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  let lastDay = '';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 scrollbar-thin sm:px-5">
        {!shown.length && <p className="py-16 text-center text-[13px] text-ink-3">{query ? '찾는 말이 들어간 대화가 없습니다' : '첫 메시지를 남겨 보세요'}</p>}
        {shown.map((m, i) => {
          const day = toIsoDate(new Date(m.createdAt));
          const sep = day !== lastDay ? <DaySep key={`d-${day}`} iso={day} /> : null;
          lastDay = day;
          const prev = shown[i - 1];
          const grouped = !!prev && prev.authorId === m.authorId && !prev.system && !m.system && toIsoDate(new Date(prev.createdAt)) === day
            && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < 5 * 60000;
          return (
            <Fragment key={m.id}>
              {sep}
              <MessageRow m={m} mine={m.authorId === me.id} grouped={grouped} author={members.get(m.authorId)} members={members} quoted={m.replyToId ? byMsg.get(m.replyToId) : undefined}
                unread={unreadFor(m)} highlight={query} onMenu={(x, y, touch) => setMenu({ msg: m, x, y, touch })} onImage={(urls, idx) => setViewer({ urls, i: idx })} />
            </Fragment>
          );
        })}
        <div ref={bottom} />
      </div>
      <Composer room={room} reply={reply} editing={editing} inquiryId={inquiryId ?? null} members={members}
        onCancel={() => { setReply(null); setEditing(null); }} onSent={() => { setReply(null); setEditing(null); first.current = true; void load(); void refresh(); }} />
      {menu && (
        <MessageMenu at={menu} onClose={() => setMenu(null)} items={[
          !menu.msg.system && !menu.msg.deleted && { icon: <CornerUpLeft size={16} />, label: '답장', run: () => { setEditing(null); setReply(menu.msg); } },
          !!menu.msg.text && { icon: <Copy size={16} />, label: '복사', run: () => { void navigator.clipboard?.writeText(menu.msg.text); toast('복사했습니다.'); } },
          me.isCeo && !menu.msg.system && !menu.msg.deleted && { icon: <ClipboardCheck size={16} />, label: menu.msg.directive ? '지시로 다시 등록' : '지시로 등록', run: () => setDirective(menu.msg) },
          menu.msg.authorId === me.id && !menu.msg.system && !menu.msg.deleted && { icon: <Pencil size={16} />, label: '고치기', run: () => { setReply(null); setEditing(menu.msg); } },
          menu.msg.authorId === me.id && !me.isAdmin && !menu.msg.deleted && Date.now() - Date.parse(menu.msg.createdAt) < deleteMs && { icon: <Trash2 size={16} />, label: '지우기', danger: true, run: () => void act(() => api.talk.deleteMessage(menu.msg.id)) },
          me.isAdmin && !menu.msg.deleted && !menu.msg.system && { icon: menu.msg.hidden ? <Eye size={16} /> : <EyeOff size={16} />, label: menu.msg.hidden ? '다시 보이기 (관리자)' : '가리기 (관리자)', run: () => void act(() => api.talk.hideMessage(menu.msg.id, !menu.msg.hidden)) },
          me.isAdmin && !menu.msg.deleted && { icon: <Trash2 size={16} />, label: '지우기 (관리자)', danger: true, run: () => { if (confirm('이 메시지를 지울까요? 되돌릴 수 없습니다.')) void act(() => api.talk.deleteMessage(menu.msg.id)); } },
          talkExtras() && !menu.msg.system && !menu.msg.deleted && !!menu.msg.text && { icon: <CalendarPlus size={16} />, label: '일정으로 등록', run: () => setEventOf(menu.msg) },
          menu.msg.authorId !== me.id && room.kind !== 'dm' && !menu.msg.system && { icon: <MessageCircle size={16} />, label: `${members.get(menu.msg.authorId)?.name ?? ''}님과 1:1`, run: () => void api.talk.openDm(menu.msg.authorId).then(async (r) => { await refresh(); onRoom(r.id); }) },
        ].filter(Boolean) as MenuItem[]} />
      )}
      {eventOf && <EventFromChat msg={eventOf} room={room} onClose={() => { setEventOf(null); void load(); }} />}
      {directive && <DirectiveModal msg={directive} room={room} onClose={() => setDirective(null)} onDone={() => { setDirective(null); void load(); }} />}
      {viewer && <ImageViewer urls={viewer.urls} index={viewer.i} onIndex={(i) => setViewer({ ...viewer, i })} onClose={() => setViewer(null)} />}
    </div>
  );
}

function DaySep({ iso }: { iso: string }) {
  return (
    <div className="my-4 flex items-center gap-3 text-[11.5px] font-semibold text-ink-3">
      <span className="h-px flex-1 bg-line" />{dayLabel(iso)}<span className="h-px flex-1 bg-line" />
    </div>
  );
}

function MessageText({ text, members, highlight, onDark }: { text: string; members: Map<string, Member>; highlight: string; onDark?: boolean }) {
  const names = [...members.values()].map((m) => m.name).sort((a, b) => b.length - a.length);
  const pattern = [names.length ? `@(?:${names.map(esc).join('|')})` : '', highlight.trim() ? esc(highlight.trim()) : ''].filter(Boolean).join('|');
  if (!pattern) return <>{text}</>;
  const re = new RegExp(`(${pattern})`, 'g');
  return <>{text.split(re).map((part, i) => (i % 2 === 1
    ? part.startsWith('@') ? <b key={i} className={onDark ? 'underline decoration-on-brand/60 underline-offset-2' : 'text-brand-ink'}>{part}</b> : <mark key={i} className="rounded bg-em-hl px-0.5 text-ink">{part}</mark>
    : part))}</>;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function MessageRow({ m, mine, grouped, author, members, quoted, unread, highlight, onMenu, onImage }: {
  m: ChatMessage; mine: boolean; grouped: boolean; author?: Member; members: Map<string, Member>; quoted?: ChatMessage; unread: number; highlight: string;
  onMenu(x: number, y: number, touch: boolean): void; onImage(urls: string[], i: number): void;
}) {
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // 손가락으로 누르는 중에는 안드로이드 기본 길게 누르기 메뉴(contextmenu)를 막는다
  const touching = useRef(false);
  if (m.system) {
    return (
      <div className="my-2 flex justify-center">
        <span className="max-w-[90%] rounded-full bg-sunken px-3 py-1 text-center text-[12px] text-ink-2">
          {author && <b className="mr-1">{author.name}</b>}<MessageText text={m.text} members={members} highlight={highlight} />
        </span>
      </div>
    );
  }
  const handlers = {
    onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); if (!touching.current) onMenu(e.clientX, e.clientY, false); },
    onTouchStart: (e: React.TouchEvent) => {
      touching.current = true;
      const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY };
      press.current = setTimeout(() => { press.current = null; navigator.vibrate?.(15); onMenu(t.clientX, t.clientY, true); }, 480);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (press.current && start.current && Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > 10) { clearTimeout(press.current); press.current = null; }
    },
    onTouchEnd: () => {
      if (press.current) { clearTimeout(press.current); press.current = null; }
      setTimeout(() => { touching.current = false; }, 700);
    },
  };
  const images = m.attachments.filter((a) => a.kind === 'image');
  const files = m.attachments.filter((a) => a.kind === 'file');
  // 가린 메시지: 관리자는 흐리게 내용을 보고, 다른 사람은 안내만 본다
  const veiled = !!m.hidden && !m.text && !m.attachments.length;
  const bubble = cx('relative max-w-full rounded-2xl px-3.5 py-2 text-[14px] leading-[1.6] shadow-sm',
    m.safety ? 'border-2 border-danger/50 bg-danger/5 text-ink' : mine ? 'bg-brand text-on-brand' : 'border border-line bg-surface text-ink',
    (m.deleted || veiled) && '!border-line !bg-sunken !text-ink-3 italic', m.hidden && !veiled && 'opacity-60 ring-2 ring-warn/50');
  return (
    <div className={cx('group flex gap-2', mine ? 'flex-row-reverse' : 'flex-row', grouped ? 'mt-1' : 'mt-3')}>
      {!mine && <div className="w-9 shrink-0">{!grouped && author && <Avatar id={author.id} name={author.name} size={36} />}</div>}
      <div className={cx('flex min-w-0 max-w-[78%] flex-col sm:max-w-[68%]', mine ? 'items-end' : 'items-start')}>
        {!mine && !grouped && <p className="mb-1 text-[12.5px] font-semibold text-ink-2">{author?.name ?? '알 수 없음'} <span className="font-normal text-ink-3">{author?.title}</span></p>}
        <div className={cx('flex items-end gap-1.5', mine ? 'flex-row-reverse' : 'flex-row')}>
          <div {...handlers} className={cx(bubble, 'select-text')} style={{ WebkitTouchCallout: 'none' }}>
            {m.safety && <p className="mb-1 flex items-center gap-1 text-[12px] font-bold text-danger"><ShieldAlert size={13} />안전 당부</p>}
            {quoted && (
              <div className={cx('mb-1.5 rounded-lg border-l-2 px-2 py-1 text-[12px]', mine && !m.safety ? 'border-on-brand/60 bg-white/15' : 'border-brand/50 bg-sunken')}>
                <b>{members.get(quoted.authorId)?.name}</b> <span className="opacity-80">{quoted.deleted ? '삭제된 메시지' : (quoted.text || '사진·파일').slice(0, 60)}</span>
              </div>
            )}
            {m.hidden && !veiled && <p className="mb-1 flex items-center gap-1 text-[11.5px] font-bold not-italic"><EyeOff size={12} />가린 메시지 (관리자만 보임)</p>}
            {m.deleted ? '삭제된 메시지입니다' : veiled ? '관리자가 가린 메시지입니다' : (
              <>
                {images.length > 0 && (
                  <div className={cx('mb-1 grid gap-1', images.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
                    {images.map((a, i) => (
                      <button key={a.id} onClick={() => onImage(images.map((x) => x.url), i)} className="overflow-hidden rounded-lg">
                        <img src={a.url} alt={a.name} className="max-h-60 w-full object-cover" loading="lazy" />
                      </button>
                    ))}
                  </div>
                )}
                {files.map((a) => (
                  <a key={a.id} href={a.url} target="_blank" rel="noopener noreferrer" className={cx('mb-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-semibold', mine && !m.safety ? 'bg-white/15' : 'bg-sunken')}>
                    <FileText size={15} className="shrink-0" /><span className="truncate">{a.name}</span><span className="shrink-0 text-[11px] opacity-70">{Math.max(1, Math.round(a.size / 1024))}KB</span>
                  </a>
                ))}
                {m.text && <p className="whitespace-pre-wrap break-words"><MessageText text={m.text} members={members} highlight={highlight} onDark={mine && !m.safety} /></p>}
              </>
            )}
            {m.docCategory && !m.deleted && !veiled && <p className={cx('mt-1 flex items-center gap-1 text-[11.5px] font-bold', mine && !m.safety ? 'text-on-brand/90' : 'text-brand-ink')}><FolderOpen size={12} />자료실: {m.docCategory}</p>}
            {m.directive && <p className={cx('mt-1 flex items-center gap-1 text-[11.5px] font-bold', mine && !m.safety ? 'text-on-brand/90' : 'text-note')}><ClipboardCheck size={12} />지시 등록됨</p>}
          </div>
          <div className={cx('flex shrink-0 flex-col pb-0.5 text-[10.5px] leading-tight text-ink-3', mine ? 'items-end' : 'items-start')}>
            <button onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu(r.left, r.bottom, false); }}
              className="mb-0.5 hidden rounded p-0.5 text-ink-3 hover:bg-sunken hover:text-ink group-hover:block" aria-label="메시지 메뉴"><MoreHorizontal size={15} /></button>
            {unread > 0 && !m.deleted && <span className="font-bold text-warn">{unread}</span>}
            {m.editedAt && !m.deleted && <span>수정됨</span>}
            <span>{timeOf(m.createdAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

type MenuItem = { icon: ReactNode; label: string; run(): void; danger?: boolean };

function MessageMenu({ at, items, onClose: close }: { at: { x: number; y: number; touch: boolean }; items: MenuItem[]; onClose(): void }) {
  // 길게 누른 손가락을 뗄 때 생기는 클릭으로 바로 닫히지 않게 잠깐 무시한다
  const opened = useRef(Date.now());
  const onClose = useCallback(() => { if (!at.touch || Date.now() - opened.current > 450) close(); }, [close, at.touch]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [close]);
  const list = (
    <ul className="p-1.5">
      {items.map((it) => (
        <li key={it.label}>
          <button onClick={() => { close(); it.run(); }} className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] font-semibold hover:bg-sunken', it.danger ? 'text-danger' : 'text-ink')}>
            {it.icon}{it.label}
          </button>
        </li>
      ))}
    </ul>
  );
  if (at.touch) {
    return (
      <div className="fixed inset-0 z-[60] flex items-end bg-black/30" onClick={onClose}>
        <div className="w-full rounded-t-2xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-pop animate-pop-in" onClick={(e) => e.stopPropagation()}>{list}</div>
      </div>
    );
  }
  const left = Math.min(at.x, window.innerWidth - 230);
  const top = Math.min(at.y, window.innerHeight - items.length * 44 - 20);
  return (
    <div className="fixed inset-0 z-[60]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }}>
      <div className="absolute w-[220px] rounded-xl border border-line bg-surface shadow-pop animate-pop-in" style={{ left, top }} onClick={(e) => e.stopPropagation()}>{list}</div>
    </div>
  );
}

/* ───────────── 입력창 ───────────── */

function Composer({ room, reply, editing, inquiryId, members, onCancel, onSent }: {
  room: ChatRoom; reply: ChatMessage | null; editing: ChatMessage | null; inquiryId: string | null; members: Map<string, Member>; onCancel(): void; onSent(): void;
}) {
  const { me, toast } = useStore();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [docCat, setDocCat] = useState('');
  const [busy, setBusy] = useState(false);
  const [caret, setCaret] = useState(0);
  const { data: talk } = useTalk();
  const cats = talk?.settings.docCategories ?? [];
  // 현장방에서 PDF·문서를 붙이면 자료실 저장을 기본으로 제안한다 (사진은 고를 때만)
  useEffect(() => {
    if (!room.siteId || !files.length) { setDocCat(''); return; }
    if (!docCat && files.some((f) => !f.type.startsWith('image/'))) setDocCat(cats.includes('기타') ? '기타' : cats[0] ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.length, room.siteId]);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) { setText(editing.text); ta.current?.focus(); } }, [editing]);
  useEffect(() => { if (reply) ta.current?.focus(); }, [reply]);
  useEffect(() => {
    const el = ta.current; if (!el) return;
    el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const mention = /@([^\s@]*)$/.exec(text.slice(0, caret));
  const candidates = mention ? room.memberIds.map((id) => members.get(id)).filter((m): m is Member => !!m && m.id !== me.id && m.name.includes(mention[1])).slice(0, 6) : [];
  const pick = (m: Member) => {
    const start = caret - (mention?.[0].length ?? 0);
    const next = `${text.slice(0, start)}@${m.name} ${text.slice(caret)}`;
    setText(next);
    const pos = start + m.name.length + 2;
    requestAnimationFrame(() => { ta.current?.focus(); ta.current?.setSelectionRange(pos, pos); setCaret(pos); });
  };

  const send = async () => {
    if (busy || (!text.trim() && !files.length)) return;
    setBusy(true);
    try {
      if (editing) await api.talk.editMessage(editing.id, text);
      else await api.talk.send({ roomId: room.id, text, files, replyToId: reply?.id ?? null, inquiryId, docCategory: room.siteId && docCat ? docCat : null });
      setText(''); setFiles([]); setDocCat(''); onSent();
    } catch (e) { toast(e instanceof Error ? e.message : '보내지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  const desktop = typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches;

  return (
    <div className="relative border-t border-line bg-surface px-3 pb-[max(10px,env(safe-area-inset-bottom))] pt-2">
      {candidates.length > 0 && (
        <ul className="absolute bottom-full left-3 mb-1 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
          {candidates.map((m) => (
            <li key={m.id}><button onMouseDown={(e) => { e.preventDefault(); pick(m); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13.5px] hover:bg-sunken">
              <Avatar id={m.id} name={m.name} size={24} /><b>{m.name}</b><span className="text-ink-3">{m.title}</span></button></li>
          ))}
        </ul>
      )}
      {(reply || editing) && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 text-[12.5px]">
          {editing ? <Pencil size={13} /> : <CornerUpLeft size={13} />}
          <span className="min-w-0 flex-1 truncate">{editing ? '메시지 고치는 중' : <><b>{members.get(reply!.authorId)?.name}</b>에게 답장: {reply!.text || '사진·파일'}</>}</span>
          <button onClick={() => { onCancel(); if (editing) setText(''); }} aria-label="취소"><X size={15} /></button>
        </div>
      )}
      {files.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span key={i} className="flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-[12px] font-semibold">
              {f.type.startsWith('image/') ? '사진' : '파일'} · <span className="max-w-[140px] truncate">{f.name}</span>
              <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="빼기"><X size={13} /></button>
            </span>
          ))}
          {room.siteId && (
            <label className="ml-auto flex items-center gap-1.5 text-[12px] font-semibold text-ink-2">
              <FolderOpen size={14} className="text-brand" />자료실에도 저장
              <select value={docCat} onChange={(e) => setDocCat(e.target.value)} className="h-7 rounded-md border border-line bg-surface px-1.5 text-[12px]">
                <option value="">저장 안 함</option>
                {cats.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <div className="flex items-end gap-2">
        {!editing && <IconButton label="사진·파일" onClick={() => fileRef.current?.click()}><Paperclip size={18} /></IconButton>}
        <input ref={fileRef} type="file" multiple hidden accept="image/*,.pdf,.xlsx,.xls,.docx,.doc,.hwp,.hwpx,.zip"
          onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])].slice(0, 30)); e.target.value = ''; }} />
        <textarea ref={ta} rows={1} value={text} placeholder={room.kind === 'dm' ? '메시지 입력' : '메시지 입력 · @이름으로 부르기'}
          onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={(e) => {
            if (candidates.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pick(candidates[0]); return; }
            if (e.key === 'Enter' && !e.shiftKey && desktop && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
          }}
          className="max-h-40 min-h-[40px] flex-1 resize-none rounded-xl border border-line bg-bg px-3 py-2 text-[14.5px] leading-[1.5] focus:border-brand focus:outline-none" />
        <Button tone="primary" onClick={() => void send()} disabled={busy || (!text.trim() && !files.length)} className="!h-10 !px-3.5" aria-label="보내기">
          {busy ? <Spinner /> : <Send size={17} />}
        </Button>
      </div>
      {desktop && <p className="mt-1 text-[11px] text-ink-3">Enter 보내기 · Shift+Enter 줄바꿈 · 메시지에 마우스를 올리거나 오른쪽 클릭하면 메뉴</p>}
    </div>
  );
}

/* ───────────── 지시로 등록 ───────────── */

function DirectiveModal({ msg, room, onClose, onDone }: { msg: ChatMessage; room: ChatRoom; onClose(): void; onDone(): void }) {
  const { me, snap, toast } = useStore();
  const depts = byId(snap?.departments ?? []);
  const people = (snap?.members ?? []).filter((m) => room.memberIds.includes(m.id) && m.id !== me.id && m.active);
  const sites = (snap?.sites ?? []).filter((s) => !s.archived);
  const defaultTo = room.kind === 'dm' ? people.map((m) => m.id) : msg.authorId !== me.id ? [msg.authorId] : msg.mentions.filter((id) => id !== me.id);
  const [text, setText] = useState(msg.text);
  const [to, setTo] = useState<string[]>(defaultTo);
  const [siteId, setSiteId] = useState<string>(room.kind === 'site' && room.siteId ? room.siteId : '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.talk.toDirective({ messageId: msg.id, text, memberIds: to, siteId: siteId || null });
      toast('지시사항으로 등록했습니다.'); onDone(); void refresh();
    } catch (e) { toast(e instanceof Error ? e.message : '등록하지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="지시사항으로 등록" width={480}
      footer={<><Button onClick={onClose}>취소</Button><Button tone="primary" disabled={busy || !text.trim() || (!to.length && !siteId)} onClick={() => void save()}>{busy && <Spinner />}등록</Button></>}>
      <p className="mb-3 text-[12.5px] leading-relaxed text-ink-3">이번 주 지시사항에 한 줄로 들어갑니다. 받는 사람의 [지시사항] 탭과 보고 화면에 보이고, 대기 → 진행 중 → 완료로 처리 상태를 관리합니다.</p>
      <label className="mb-1.5 block text-[13px] font-semibold text-ink-2">지시 내용</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] focus:border-brand focus:outline-none" />
      <p className="mb-1.5 mt-4 text-[13px] font-semibold text-ink-2">받는 사람 <span className="font-normal text-ink-3">(이 방 인원 중에서, 여러 명 가능)</span></p>
      <div className="flex flex-wrap gap-1.5">
        {people.map((m) => {
          const on = to.includes(m.id);
          return (
            <button key={m.id} onClick={() => setTo(on ? to.filter((x) => x !== m.id) : [...to, m.id])}
              className={cx('flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] font-semibold', on ? 'border-brand bg-brand text-on-brand' : 'border-line-strong bg-surface text-ink-2 hover:border-brand')}>
              {m.name} <span className={cx('font-normal', on ? 'text-on-brand/80' : 'text-ink-3')}>{depts.get(m.departmentId ?? '')?.name ?? m.title}</span>
            </button>
          );
        })}
        {!people.length && <span className="text-[13px] text-ink-3">이 방에 다른 인원이 없습니다</span>}
      </div>
      <p className="mb-1.5 mt-4 text-[13px] font-semibold text-ink-2">현장 지시로도 등록 <span className="font-normal text-ink-3">(선택: 그 현장을 보고하는 직원에게 보임)</span></p>
      <select value={siteId} onChange={(e) => setSiteId(e.target.value)} className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[14px]">
        <option value="">현장 지시로는 등록 안 함</option>
        {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
    </Modal>
  );
}

