import { AlarmClock, ChevronDown, ChevronRight, ClipboardPaste, Lock, NotebookPen, Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/client';
import type { MemoData, MemoTodo } from '../lib/types';
import { dayLabel, shiftDay, todayIso } from '../lib/week';
import { useStore } from '../state/store';
import { Button, Card, cx, Input, Modal, Spinner } from './ui';

const EMPTY: MemoData = { text: '', todos: [], updatedAt: null };
const OPEN_KEY = 'memo-open';

function whenLabel(at: string) {
  const [d, t] = at.split('T');
  return `${dayLabel(d).replace(/^\d+월 /, `${Number(d.slice(5, 7))}/`).replace('일 ', ' ')} ${t?.slice(0, 5) ?? ''}`;
}

/** 나만 보는 메모: 할 일(체크·알림 예약) + 자유 메모. 보고 화면 아래에 둔다 */
export function MemoPanel({ onInsert, insertLabel = '보고에 넣기', className }: { onInsert?: (text: string) => Promise<void>; insertLabel?: string; className?: string }) {
  const { toast } = useStore();
  const [data, setData] = useState<MemoData | null>(null);
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; } });
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [newTodo, setNewTodo] = useState('');
  const [remindOf, setRemindOf] = useState<MemoTodo | null>(null);
  const [inserting, setInserting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef<MemoData>(EMPTY);

  useEffect(() => { api.memo.load().then((d) => { latest.current = d; setData(d); }).catch(() => setData(EMPTY)); }, []);
  const persist = async (d: MemoData) => {
    setState('saving');
    try { await api.memo.save(d); setState('saved'); } catch (e) { setState('error'); toast(e instanceof Error ? e.message : '메모를 저장하지 못했습니다.', 'error'); }
  };
  /** 할 일은 바로, 메모 글은 입력을 멈추면 저장 */
  const update = (d: MemoData, later = false) => {
    latest.current = d;
    setData(d);
    clearTimeout(timer.current);
    if (later) { setState('saving'); timer.current = setTimeout(() => void persist(latest.current), 800); } else void persist(d);
  };
  // 화면을 떠나거나 휴대폰 화면이 꺼질 때 저장 안 된 메모를 마저 저장
  useEffect(() => {
    const flush = () => { if (timer.current) { clearTimeout(timer.current); timer.current = undefined; void persist(latest.current); } };
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleOpen = () => { const v = !open; setOpen(v); try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* 무시 */ } };
  if (!data) return null;
  const todos = data.todos;
  const left = todos.filter((t) => !t.done);
  const doneN = todos.length - left.length;
  const addTodo = () => {
    const t = newTodo.trim();
    if (!t) return;
    update({ ...data, todos: [...todos, { id: `t${Date.now().toString(36)}`, text: t, done: false, remindAt: null }] });
    setNewTodo('');
  };
  const setTodo = (id: string, patch: Partial<MemoTodo>) => update({ ...data, todos: todos.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

  return (
    <Card className={cx('p-4 sm:p-5', className)}>
      <button type="button" onClick={toggleOpen} className="flex w-full items-center gap-2 text-left">
        <NotebookPen size={17} className="text-brand" />
        <span className="text-[15.5px] font-bold">내 메모</span>
        <span className="flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[11.5px] font-semibold text-ink-3"><Lock size={11} />나만 보기</span>
        {!open && left.length > 0 && <span className="text-[12.5px] text-ink-3">할 일 {left.length}개</span>}
        <span className="ml-auto text-[11.5px] text-ink-3">{state === 'saving' ? '저장 중' : state === 'saved' ? '저장됨' : state === 'error' ? <span className="text-danger">저장 못 함</span> : ''}</span>
        {open ? <ChevronDown size={18} className="text-ink-3" /> : <ChevronRight size={18} className="text-ink-3" />}
      </button>

      {open && (
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1.5 text-[13px] font-bold text-ink-2">할 일</p>
            <ul className="space-y-1">
              {todos.map((t) => (
                <li key={t.id} className="group flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-sunken/60">
                  <input type="checkbox" checked={t.done} onChange={(e) => setTodo(t.id, { done: e.target.checked })} className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" aria-label="끝냄" />
                  <span className="min-w-0 flex-1">
                    <span className={cx('block break-words text-[14px]', t.done && 'text-ink-3 line-through')}>{t.text}</span>
                    {t.remindAt && (
                      <button type="button" onClick={() => setRemindOf(t)} className={cx('mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold', t.done ? 'bg-sunken text-ink-3' : 'bg-brand-soft text-brand-ink')}>
                        <AlarmClock size={11} />{whenLabel(t.remindAt)} 알림
                      </button>
                    )}
                  </span>
                  {!t.remindAt && !t.done && (
                    <button type="button" onClick={() => setRemindOf(t)} className="rounded p-1 text-ink-3 hover:bg-surface hover:text-brand-ink" aria-label="알림 예약" title="알림 예약"><AlarmClock size={15} /></button>
                  )}
                  <button type="button" onClick={() => update({ ...data, todos: todos.filter((x) => x.id !== t.id) })} className="rounded p-1 text-ink-3 hover:bg-surface hover:text-danger" aria-label="지우기" title="지우기"><X size={15} /></button>
                </li>
              ))}
              {!todos.length && <li className="px-1.5 py-1 text-[13px] text-ink-3">다음 주 할 일, 잊으면 안 될 일을 적어 두세요</li>}
            </ul>
            <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); addTodo(); }}>
              <Input value={newTodo} onChange={(e) => setNewTodo(e.target.value)} placeholder="할 일 추가" className="!h-9" />
              <Button size="sm" type="submit" disabled={!newTodo.trim()} className="!h-9"><Plus size={15} />추가</Button>
            </form>
            {doneN > 0 && <button type="button" onClick={() => update({ ...data, todos: left })} className="mt-1.5 text-[12px] font-semibold text-ink-3 hover:text-ink">끝난 일 {doneN}개 지우기</button>}
          </div>
          <div className="min-w-0">
            <p className="mb-1.5 text-[13px] font-bold text-ink-2">메모</p>
            <textarea value={data.text} onChange={(e) => update({ ...data, text: e.target.value }, true)} rows={6}
              placeholder="자유롭게 적어 두세요. 입력하면 자동으로 저장됩니다."
              className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[14px] leading-[1.65] focus:border-brand focus:outline-none" />
          </div>
        </div>
      )}
      {open && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <p className="min-w-0 flex-1 text-[12px] text-ink-3">대표님·관리자도 볼 수 없습니다. 알림을 예약하면 그 시간에 휴대폰으로 알려 드립니다.</p>
          {onInsert && (left.length > 0 || data.text.trim()) && <Button size="sm" onClick={() => setInserting(true)}><ClipboardPaste size={14} />{insertLabel}</Button>}
        </div>
      )}
      {remindOf && <RemindModal todo={remindOf} onClose={() => setRemindOf(null)} onSave={(at) => { setTodo(remindOf.id, { remindAt: at }); setRemindOf(null); if (at) toast(`${whenLabel(at)}에 알려 드립니다.`); }} />}
      {inserting && onInsert && <InsertModal data={data} label={insertLabel} onClose={() => setInserting(false)}
        onDone={async (text, doneIds) => {
          await onInsert(text);
          if (doneIds.length) update({ ...latest.current, todos: latest.current.todos.map((t) => (doneIds.includes(t.id) ? { ...t, done: true } : t)) });
          setInserting(false);
          toast('보고에 넣었습니다.');
        }} />}
    </Card>
  );
}

function RemindModal({ todo, onClose, onSave }: { todo: MemoTodo; onClose(): void; onSave(at: string | null): void }) {
  const today = todayIso();
  const dow = new Date(`${today}T00:00:00`).getDay();
  const nextMon = shiftDay(today, ((8 - dow) % 7) || 7);
  const [at, setAt] = useState(todo.remindAt ?? `${shiftDay(today, 1)}T09:00`);
  const quick: [string, string][] = [[`${shiftDay(today, 1)}T09:00`, '내일 오전 9시'], [`${nextMon}T08:30`, '다음 주 월요일 8시 30분'], [`${today}T17:00`, '오늘 오후 5시']];
  return (
    <Modal open onClose={onClose} title={<span className="flex items-center gap-2"><AlarmClock size={18} className="text-brand" />알림 예약</span>} width={420}
      footer={<>
        {todo.remindAt && <Button tone="ghost" className="mr-auto" onClick={() => onSave(null)}>알림 지우기</Button>}
        <Button onClick={onClose}>취소</Button>
        <Button tone="primary" disabled={!at} onClick={() => onSave(at)}>예약</Button>
      </>}>
      <p className="mb-3 text-[14px] font-semibold">{todo.text}</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {quick.map(([v, l]) => (
          <button key={l} type="button" onClick={() => setAt(v)} className={cx('rounded-full border px-3 py-1 text-[12.5px] font-semibold', at === v ? 'border-brand bg-brand text-on-brand' : 'border-line-strong text-ink-2 hover:border-brand')}>{l}</button>
        ))}
      </div>
      <label className="block text-[13px] font-semibold text-ink-2">날짜와 시간
        <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="mt-1.5" />
      </label>
      <p className="mt-2 text-[12px] text-ink-3">정한 시간에 휴대폰 알림으로 이 할 일을 알려 드립니다.</p>
    </Modal>
  );
}

function InsertModal({ data, label, onClose, onDone }: { data: MemoData; label: string; onClose(): void; onDone(text: string, doneIds: string[]): Promise<void> }) {
  const left = data.todos.filter((t) => !t.done);
  const [pick, setPick] = useState<string[]>(left.map((t) => t.id));
  const [withText, setWithText] = useState(!left.length && !!data.text.trim());
  const [markDone, setMarkDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const text = [...left.filter((t) => pick.includes(t.id)).map((t) => `- ${t.text}`), ...(withText && data.text.trim() ? [data.text.trim()] : [])].join('\n');
  return (
    <Modal open onClose={onClose} title={label} width={480}
      footer={<><Button onClick={onClose}>취소</Button><Button tone="primary" disabled={busy || !text} onClick={async () => { setBusy(true); try { await onDone(text, markDone ? pick : []); } finally { setBusy(false); } }}>{busy && <Spinner />}넣기</Button></>}>
      <p className="mb-2 text-[13px] text-ink-3">고른 내용을 보고 칸 맨 아래에 붙입니다. 넣은 뒤 보고 칸에서 고칠 수 있습니다.</p>
      <ul className="space-y-1">
        {left.map((t) => (
          <li key={t.id}><label className="flex items-start gap-2 text-[14px]"><input type="checkbox" className="mt-1 h-4 w-4" checked={pick.includes(t.id)} onChange={(e) => setPick(e.target.checked ? [...pick, t.id] : pick.filter((x) => x !== t.id))} />{t.text}</label></li>
        ))}
        {data.text.trim() && <li><label className="flex items-start gap-2 text-[14px]"><input type="checkbox" className="mt-1 h-4 w-4" checked={withText} onChange={(e) => setWithText(e.target.checked)} />메모 내용도 넣기</label></li>}
      </ul>
      {left.length > 0 && <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-2"><input type="checkbox" className="h-4 w-4" checked={markDone} onChange={(e) => setMarkDone(e.target.checked)} />넣은 할 일은 '끝냄'으로 표시</label>}
      {text && <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-sunken px-3 py-2 font-sans text-[13px] text-ink-2">{text}</pre>}
    </Modal>
  );
}
