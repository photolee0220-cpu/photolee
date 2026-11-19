import { MessagesSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/AppShell';
import { Empty, Segmented, Spinner } from '../../components/ui';
import { useStore } from '../../state/store';
import { RoomList, RoomView } from './Chat';
import { NoticeList } from './Notices';
import { DocsLibrary } from './Docs';
import { noticeOpen, useTalk } from './useTalk';
import { onOpen, peekOpen, takeOpen } from '../../lib/deepLink';

function useDesktop() {
  const q = '(min-width: 1024px)';
  const [d, setD] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setD(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return d;
}

/** 소통: [공지] [채팅방] */
export function TalkPage() {
  const { me } = useStore();
  const { data } = useTalk();
  const desktop = useDesktop();
  const [tab, setTab] = useState<'chat' | 'notice' | 'docs'>(() => peekOpen()?.tab ?? 'chat');
  const [roomId, setRoomIdState] = useState<string | null>(() => peekOpen()?.room ?? null);
  const [jumpQuery, setJumpQuery] = useState<string | undefined>();
  const setRoomId = (id: string | null, query?: string) => { setRoomIdState(id); setJumpQuery(query); };
  // 알림으로 들어온 요청은 여기서 꺼내 쓴다. 앱이 열린 채로 알림을 눌러도 그 방으로 간다
  useEffect(() => { takeOpen(); return onOpen((r) => { takeOpen(); if (r.tab) setTab(r.tab); if (r.room) setRoomId(r.room); }); }, []);
  useEffect(() => {
    if (desktop && !roomId && data?.rooms.length) setRoomId(data.rooms[0].room.id);
  }, [desktop, roomId, data]);
  // 공지를 아직 확인 안 했으면 공지 탭부터
  useEffect(() => {
    if (data && !roomId && data.notices.some((n) => n.requireAck && !n.acks[me.id])) setTab('notice');
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data]);
  if (!data) return <div className="flex justify-center py-20"><Spinner /></div>;

  const unreadMsgs = data.rooms.filter((r) => !r.room.mutedBy.includes(me.id)).reduce((n, r) => n + r.unread, 0);
  const openNotices = data.notices.filter((n) => noticeOpen(n, me)).length;
  const tabs = (
    <Segmented<'chat' | 'notice' | 'docs'> value={tab} onChange={setTab} options={[
      { id: 'chat', label: `채팅방${unreadMsgs ? ` ${unreadMsgs}` : ''}` },
      { id: 'notice', label: `공지${openNotices ? ` ${openNotices}` : ''}` },
      { id: 'docs', label: '자료실' },
    ]} />
  );

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="소통" right={tabs}>
        <span className="text-[13px] text-ink-3">공지·채팅방·문의·회의록을 한곳에서</span>
      </PageHeader>
      {tab === 'notice' && <NoticeList notices={data.notices} />}
      {tab === 'docs' && <DocsLibrary data={data} />}
      {tab === 'chat' && (desktop ? (
        <div className="grid h-[calc(100dvh-190px)] min-h-[560px] grid-cols-[320px_1fr] overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="min-h-0 border-r border-line"><RoomList data={data} activeId={roomId} onOpen={(id, q) => setRoomId(id, q)} /></div>
          <div className="min-h-0">
            {roomId && data.rooms.some((r) => r.room.id === roomId)
              ? <RoomView data={data} roomId={roomId} onRoom={(id) => setRoomId(id)} initialQuery={jumpQuery} />
              : <div className="flex h-full items-center justify-center"><Empty title="왼쪽에서 방을 고르세요" icon={<MessagesSquare size={22} />} /></div>}
          </div>
        </div>
      ) : (
        <>
          <div className="-mx-4 h-[calc(100dvh-250px)] min-h-[420px] overflow-hidden border-y border-line bg-surface sm:mx-0 sm:rounded-2xl sm:border">
            <RoomList data={data} activeId={roomId} onOpen={(id, q) => setRoomId(id, q)} />
          </div>
          {roomId && data.rooms.some((r) => r.room.id === roomId) && (
            <div className="fixed inset-0 z-50 bg-bg" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
              <RoomView data={data} roomId={roomId} onBack={() => setRoomId(null)} onRoom={(id) => setRoomId(id)} initialQuery={jumpQuery} />
            </div>
          )}
        </>
      ))}
    </div>
  );
}
