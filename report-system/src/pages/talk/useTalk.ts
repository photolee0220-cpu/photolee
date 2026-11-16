import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/client';
import type { Notice, TalkSnapshot } from '../../lib/talkTypes';
import type { Member } from '../../lib/types';

/** 소통 데이터는 메뉴 배지와 화면이 함께 쓴다: 한 번 읽어 두고 바뀌면 모두 다시 그린다 */
let cache: TalkSnapshot | null = null;
let pending: Promise<TalkSnapshot> | null = null;
const listeners = new Set<(s: TalkSnapshot) => void>();
let unsub: (() => void) | null = null;

export function refreshTalk(): Promise<TalkSnapshot> {
  pending ??= api.talk.load().then((s) => { cache = s; listeners.forEach((l) => l(s)); return s; }).finally(() => { pending = null; });
  return pending;
}

/** 로그아웃·계정 전환 때 비운다 */
export function clearTalk() { cache = null; }

export function useTalk() {
  const [data, setData] = useState<TalkSnapshot | null>(cache);
  useEffect(() => {
    listeners.add(setData);
    unsub ??= api.subscribe(() => void refreshTalk().catch(() => undefined));
    void refreshTalk().catch(() => undefined);
    return () => {
      listeners.delete(setData);
      if (!listeners.size && unsub) { unsub(); unsub = null; }
    };
  }, []);
  const reload = useCallback(() => refreshTalk().then(() => undefined), []);
  return { data, reload };
}

export const noticeOpen = (n: Notice, me: Member) => !n.reads[me.id] || (n.requireAck && !n.acks[me.id]);

/** 메뉴 배지: 안 읽은 메시지 + 읽거나 확인해야 할 공지 */
export function talkBadge(data: TalkSnapshot | null, me: Member): number {
  if (!data) return 0;
  const msgs = data.rooms.filter((r) => !r.room.mutedBy.includes(me.id)).reduce((n, r) => n + r.unread, 0);
  return msgs + data.notices.filter((n) => noticeOpen(n, me)).length;
}

/** 소통 메뉴는 승인 전까지 체험판에서만 보인다 */
export const talkAvailable = () => api.mode === 'demo';
