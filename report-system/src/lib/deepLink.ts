/** 알림을 눌러 들어왔을 때 열 화면 (?open=talk&room=… / ?open=notice) */
export interface OpenRequest { view: 'talk'; room?: string; tab?: 'chat' | 'notice' | 'docs' }

function parse(search: string): OpenRequest | null {
  const p = new URLSearchParams(search);
  const open = p.get('open');
  if (open === 'talk') return { view: 'talk', room: p.get('room') ?? undefined, tab: 'chat' };
  if (open === 'notice') return { view: 'talk', tab: 'notice' };
  return null;
}

let pending: OpenRequest | null = (() => {
  try {
    const r = parse(window.location.search);
    if (r) window.history.replaceState(null, '', window.location.pathname);
    return r;
  } catch { return null; }
})();
const listeners = new Set<(r: OpenRequest) => void>();

// 앱이 열린 채로 알림을 누르면 서비스 워커가 알려 준다
try {
  navigator.serviceWorker?.addEventListener('message', (e) => {
    const d = e.data as { type?: string; url?: string } | null;
    if (d?.type !== 'open' || !d.url) return;
    const r = parse(new URL(d.url).search);
    if (!r) return;
    pending = r;
    listeners.forEach((l) => l(r));
  });
} catch { /* 서비스 워커 없음 */ }

/** 열 화면 요청을 꺼낸다 (한 번만) */
export function takeOpen(): OpenRequest | null {
  const r = pending;
  pending = null;
  return r;
}
/** 열 화면 요청이 아직 남아 있는지 보기만 한다 */
export function peekOpen(): OpenRequest | null { return pending; }

export function onOpen(fn: (r: OpenRequest) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
