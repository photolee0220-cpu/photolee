import { Bell, BellOff, BellRing, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/client';
import { useStore } from '../state/store';
import { Button, IconButton, Modal, Spinner } from './ui';

type PushState = 'loading' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

function keyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  return existing ?? navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL });
}

async function currentState(): Promise<PushState> {
  if (!api.push.available) return isIos() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

/** 사이드바·휴대폰 머리글의 알림 버튼 */
export function NotificationButton({ className, size = 17 }: { className?: string; size?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="알림 설정" onClick={() => setOpen(true)} className={className}><Bell size={size} /></IconButton>
      {open && <NotificationSettings onClose={() => setOpen(false)} />}
    </>
  );
}

function NotificationSettings({ onClose }: { onClose(): void }) {
  const { toast } = useStore();
  const [state, setState] = useState<PushState>('loading');
  const [busy, setBusy] = useState(false);
  useEffect(() => { currentState().then(setState).catch(() => setState('unsupported')); }, []);

  const turnOn = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return; }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await api.push.publicKey()) });
      await api.push.save(sub.toJSON());
      setState('on');
      toast('이 기기에서 알림을 켰습니다');
    } catch (e) {
      toast(e instanceof Error ? e.message : '알림을 켜지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration(import.meta.env.BASE_URL);
      const sub = await reg?.pushManager.getSubscription();
      if (sub) { await api.push.remove(sub.endpoint); await sub.unsubscribe(); }
      setState('off');
      toast('이 기기의 알림을 껐습니다');
    } catch {
      toast('알림을 끄지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const test = async () => {
    setBusy(true);
    try {
      const n = await api.push.test();
      toast(n ? `시험 알림을 보냈습니다 (${n}대)` : '보낼 기기가 없습니다. 알림을 다시 켜 주세요.', n ? 'ok' : 'error');
    } catch (e) {
      toast(e instanceof Error ? e.message : '보내지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="알림" width={480} footer={<Button onClick={onClose}>닫기</Button>}>
      <div className="space-y-4 text-[14px] leading-[1.7]">
        <AlertList />
        {state === 'loading' && <Spinner />}
        {state === 'on' && (
          <div className="space-y-3">
            <p className="flex items-center gap-2 font-semibold text-ok"><BellRing size={18} />이 기기에서 알림을 받고 있습니다</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={test} disabled={busy}>시험 알림 보내기</Button>
              <Button tone="ghost" onClick={turnOff} disabled={busy}><BellOff size={15} />이 기기 알림 끄기</Button>
            </div>
          </div>
        )}
        {state === 'off' && (
          <div className="space-y-2">
            <p className="text-ink-2">알림을 켜면 위 두 경우에 휴대폰·컴퓨터로 알려드립니다. 기기마다 한 번씩 켜 주세요.</p>
            <Button tone="primary" onClick={turnOn} disabled={busy}>{busy ? <Spinner /> : <Bell size={15} />}이 기기에서 알림 켜기</Button>
          </div>
        )}
        {state === 'denied' && (
          <p className="text-ink-2">이 브라우저에서 알림이 <b>차단</b>되어 있습니다. 주소창 왼쪽 자물쇠(또는 설정) → 알림 → <b>허용</b>으로 바꾼 뒤 이 창을 다시 열어 주세요.</p>
        )}
        {state === 'ios-install' && (
          <div className="space-y-2 text-ink-2">
            <p className="flex items-center gap-2 font-semibold text-ink"><Smartphone size={17} />아이폰은 홈 화면에 추가해야 알림을 받을 수 있습니다</p>
            <ol className="list-decimal space-y-0.5 pl-5 text-[13.5px]">
              <li>사파리 아래쪽 <b>공유</b> 버튼 → <b>홈 화면에 추가</b></li>
              <li>홈 화면에 생긴 <b>업무보고</b> 아이콘으로 열기</li>
              <li>다시 이 알림 창에서 <b>알림 켜기</b> (iOS 16.4 이상)</li>
            </ol>
          </div>
        )}
        {state === 'unsupported' && (
          <p className="text-ink-2">{api.mode === 'demo' ? '체험판에서는 알림을 쓸 수 없습니다. 실제 사이트에서 켜 주세요.' : '이 브라우저는 알림을 지원하지 않습니다. 크롬·엣지·사파리(최신)에서 열어 주세요.'}</p>
        )}
      </div>
    </Modal>
  );
}

function AlertList() {
  return (
    <ul className="space-y-1 rounded-xl bg-sunken px-4 py-3 text-[13.5px] text-ink-2">
      <li>• 평일 오후 6시: <b className="text-ink">그날 일일보고를 아직 안 쓴 경우</b>에만</li>
      <li>• 금요일 오후 3시, 토요일 오전 8시 30분: <b className="text-ink">이번 주 주간보고를 안 쓴 경우</b>에만</li>
      <li>• 내 일일보고·주간보고에 <b className="text-ink">피드백이 달렸을 때</b></li>
    </ul>
  );
}

const SKIP_KEY = 'notify-gate-skip';

/** 알림 필수 안내: 알림이 꺼져 있으면 켤 때까지 화면을 가린다. 켤 수 없는 기기(차단·미지원)만 이번 접속 동안 넘어갈 수 있다 */
export function NotificationGate() {
  const { toast } = useStore();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipped, setSkipped] = useState(() => { try { return sessionStorage.getItem(SKIP_KEY) === '1'; } catch { return false; } });
  useEffect(() => {
    if (api.mode === 'demo') return;
    currentState().then(setState).catch(() => setState('unsupported'));
  }, []);
  if (api.mode === 'demo' || skipped || !state || state === 'on' || state === 'unsupported' || state === 'loading') return null;
  const skip = () => { try { sessionStorage.setItem(SKIP_KEY, '1'); } catch { /* 무시 */ } setSkipped(true); };

  const turnOn = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'denied' : 'off'); return; }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(await api.push.publicKey()) });
      await api.push.save(sub.toJSON());
      setState('on');
      toast('알림을 켰습니다');
    } catch (e) {
      toast(e instanceof Error ? e.message : '알림을 켜지 못했습니다.', 'error');
      setState('denied');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 px-4 animate-fade-in">
      <div className="w-full max-w-[440px] rounded-2xl border border-line bg-surface p-6 shadow-pop">
        <p className="flex items-center gap-2 text-[18px] font-extrabold"><BellRing size={22} className="text-brand" />알림을 켜 주세요</p>
        <p className="mt-2 text-[14px] leading-[1.7] text-ink-2">업무보고 시스템은 마감과 피드백을 휴대폰 알림으로 알려 드립니다. 모든 직원이 켜야 하는 설정입니다.</p>
        <div className="mt-3"><AlertList /></div>
        <div className="mt-4 space-y-3 text-[14px] leading-[1.7]">
          {state === 'off' && (
            <Button tone="primary" className="w-full justify-center" onClick={turnOn} disabled={busy}>{busy ? <Spinner /> : <Bell size={16} />}알림 켜기</Button>
          )}
          {state === 'ios-install' && (
            <div className="space-y-2 text-ink-2">
              <p className="flex items-center gap-2 font-semibold text-ink"><Smartphone size={17} />아이폰은 먼저 홈 화면에 추가해야 합니다</p>
              <ol className="list-decimal space-y-0.5 pl-5 text-[13.5px]">
                <li>사파리 아래쪽 <b>공유</b> 버튼 → <b>홈 화면에 추가</b></li>
                <li>홈 화면에 생긴 <b>업무보고</b> 아이콘으로 열기</li>
                <li>로그인하면 이 창이 다시 뜹니다 → <b>알림 켜기</b></li>
              </ol>
            </div>
          )}
          {state === 'denied' && (
            <p className="text-ink-2">이 브라우저에서 알림이 <b>차단</b>되어 있습니다. 주소창 왼쪽 자물쇠(또는 휴대폰 설정 → 앱 → 브라우저 → 알림)에서 <b>허용</b>으로 바꾼 뒤 새로고침해 주세요.</p>
          )}
          {(state === 'ios-install' || state === 'denied') && (
            <button onClick={skip} className="w-full text-center text-[12.5px] font-semibold text-ink-3 hover:underline">지금은 넘어가기 (다음 접속 때 다시 안내합니다)</button>
          )}
        </div>
      </div>
    </div>
  );
}
