import { ArrowDown, ArrowUp, Check, CornerDownRight, History, MessageSquareText, Plus, Send, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { canEditEntry, canSetDirectiveStatus, isReviewer } from '../lib/access';
import { api } from '../lib/client';
import { lineDiff } from '../lib/diff';
import { byId, commentsFor, has } from '../lib/derive';
import { DIRECTIVE_STATUS, type Directive, type DirectiveStatus, type Entry, type EntryVersion } from '../lib/types';
import { hasSections, headingText, isHeading, parseSections, serializeSections, type Section } from '../lib/sections';
import { relativeTime } from '../lib/week';
import { useStore } from '../state/store';
import { DiffText } from './DiffText';
import { Button, cx, Modal, Spinner } from './ui';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function useAutosave(value: string, save: (v: string) => Promise<unknown>) {
  const [text, setText] = useState(value);
  const [state, setState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const dirty = useRef(false);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const latest = useRef(text);
  latest.current = text;
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!dirty.current && !focused.current) setText(value);
  }, [value]);

  const flush = async () => {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setState('saving');
    try {
      await saveRef.current(latest.current);
      setState('saved');
      setSavedAt(new Date());
    } catch {
      dirty.current = true;
      setState('error');
    }
  };

  useEffect(() => () => { void flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    text,
    state,
    savedAt,
    change(v: string) {
      setText(v);
      dirty.current = true;
      setState('idle');
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 900);
    },
    focus() { focused.current = true; },
    blur() { focused.current = false; void flush(); },
    replace(v: string) {
      setText(v);
      dirty.current = true;
      void Promise.resolve().then(flush);
    },
  };
}

function SaveIndicator({ state, savedAt }: { state: SaveState; savedAt: Date | null }) {
  if (state === 'saving') return <span className="inline-flex items-center gap-1.5 text-ink-3"><Spinner className="h-3 w-3" />저장 중</span>;
  if (state === 'error') return <span className="text-danger">저장하지 못했습니다. 인터넷 연결을 확인해 주세요.</span>;
  if (state === 'saved' && savedAt)
    return <span className="inline-flex items-center gap-1 text-ok"><Check size={13} />저장됨 {String(savedAt.getHours()).padStart(2, '0')}:{String(savedAt.getMinutes()).padStart(2, '0')}</span>;
  return null;
}

/** "■ 제목" 줄은 대주제 제목으로 보여준다 */
export function SectionHeading({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  return (
    <p className={cx('mt-3 flex items-center gap-2 text-[14.5px] font-bold text-ink first:mt-0', className)}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-sm bg-brand" aria-hidden />{text}
    </p>
  );
}

export function TextBlock({ text, empty = '작성된 내용이 없습니다', className }: { text: string | undefined; empty?: string; className?: string }) {
  if (!has(text)) return <p className={cx('text-[13px] text-ink-3', className)}>{empty}</p>;
  if (!hasSections(text)) return <p className={cx('whitespace-pre-wrap text-[14px] leading-[1.7] text-ink', className)}>{text}</p>;
  return (
    <div className={cx('text-[14px] leading-[1.7] text-ink', className)}>
      {text!.split('\n').map((line, i) => isHeading(line)
        ? <SectionHeading key={i} text={headingText(line)} />
        : <p key={i} className="whitespace-pre-wrap">{line || '\u00a0'}</p>)}
    </div>
  );
}

/** 보고 칸: 권한이 있으면 바로 고치고 자동 저장 */
export function EntryEditor({ value, editable, onSave, placeholder, prevContent, meta, compact }: {
  value: string;
  editable: boolean;
  onSave(v: string): Promise<unknown>;
  placeholder?: string;
  prevContent?: string;
  meta?: React.ReactNode;
  compact?: boolean;
}) {
  const a = useAutosave(value, onSave);
  if (!editable) {
    return (
      <div>
        <DiffText text={value} prev={prevContent} />
        {meta && <div className="mt-2 text-[12px] text-ink-3">{meta}</div>}
      </div>
    );
  }
  return (
    <div>
      <textarea
        value={a.text}
        onChange={(e) => a.change(e.target.value)}
        onFocus={a.focus}
        onBlur={a.blur}
        placeholder={placeholder ?? '이번 주 진행 내용을 적어주세요'}
        className={cx(
          'block w-full resize-y rounded-xl border border-line bg-surface px-3.5 py-3 text-[14.5px] leading-[1.75] text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong',
          'focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10',
          compact ? 'min-h-[88px]' : 'min-h-[120px]',
        )}
      />
      <div className="mt-1.5 flex min-h-[20px] flex-wrap items-center justify-between gap-2 text-[12px]">
        <div className="text-ink-3">{meta}</div>
        <div className="flex items-center gap-3">
          <SaveIndicator state={a.state} savedAt={a.savedAt} />
          {has(prevContent) && !has(a.text) && (
            <button type="button" onClick={() => a.replace(prevContent!)} className="inline-flex items-center gap-1 font-semibold text-brand-ink hover:underline">
              <History size={13} />지난주 내용 불러오기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type Block = Section & { key: number };
let blockKey = 1;
const toBlocks = (text: string): Block[] => parseSections(text).map((s) => ({ ...s, key: blockKey++ }));

/** 대주제별로 나눠 쓰는 보고 칸. "+ 대주제 추가"로 제목과 내용 칸을 늘린다 */
export function SectionEditor({ value, onSave, prevContent, meta, placeholder }: {
  value: string;
  onSave(v: string): Promise<unknown>;
  prevContent?: string;
  meta?: React.ReactNode;
  placeholder?: string;
}) {
  const a = useAutosave(value, onSave);
  const [blocks, setBlocks] = useState<Block[]>(() => toBlocks(value));
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [forced, setForced] = useState(false);
  const written = useRef(a.text);

  useEffect(() => {
    if (a.text !== written.current) {
      written.current = a.text;
      setBlocks(toBlocks(a.text));
    }
  }, [a.text]);

  const commit = (next: Block[]) => {
    setBlocks(next);
    const text = serializeSections(next);
    written.current = text;
    a.change(text);
  };
  const patch = (i: number, p: Partial<Section>) => commit(blocks.map((b, j) => (j === i ? { ...b, ...p } : b)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...blocks];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    commit(next);
  };
  const remove = (i: number) => {
    setConfirmDel(null);
    const next = blocks.filter((_, j) => j !== i);
    commit(next.length ? next : [{ title: '', body: '', key: blockKey++ }]);
  };
  const add = () => {
    if (blocks.length === 1 && !blocks[0].title && !blocks[0].body.trim() && !forced) { setForced(true); return; }
    commit([...blocks, { title: '', body: '', key: blockKey++ }]);
  };
  const sectioned = forced || blocks.length > 1 || !!blocks[0]?.title;
  const field = 'block w-full bg-transparent placeholder:text-ink-3 focus:outline-none';

  return (
    <div>
      <div className="space-y-3">
        {blocks.map((b, i) => (
          <div key={b.key} className={cx(sectioned && 'rounded-xl border border-line bg-surface px-3.5 pb-1 pt-2.5 transition-colors focus-within:border-brand focus-within:ring-4 focus-within:ring-brand/10')}>
            {sectioned && (
              <div className="flex items-center gap-2 border-b border-line pb-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-sm bg-brand" aria-hidden />
                <input
                  id={`section-title-${b.key}`}
                  value={b.title}
                  onChange={(e) => patch(i, { title: e.target.value.replace(/^■\s*/, '') })}
                  onFocus={a.focus}
                  onBlur={a.blur}
                  placeholder={i === 0 ? '대제목 (선택)' : '대제목 (예: 공공입찰)'}
                  className={cx(field, 'flex-1 text-[15px] font-bold text-ink')}
                />
                <div className="flex shrink-0 items-center text-ink-3">
                  <button type="button" aria-label="위로" disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 hover:bg-sunken hover:text-ink disabled:opacity-25"><ArrowUp size={14} /></button>
                  <button type="button" aria-label="아래로" disabled={i === blocks.length - 1} onClick={() => move(i, 1)} className="rounded p-1 hover:bg-sunken hover:text-ink disabled:opacity-25"><ArrowDown size={14} /></button>
                  {confirmDel === i ? (
                    <button type="button" onClick={() => remove(i)} className="ml-1 rounded-md bg-danger-soft px-2 py-0.5 text-[12px] font-semibold text-danger">삭제</button>
                  ) : (
                    <button type="button" aria-label="대주제 삭제" onClick={() => (b.body.trim() || b.title.trim() ? setConfirmDel(i) : remove(i))} className="rounded p-1 hover:bg-sunken hover:text-danger"><Trash2 size={14} /></button>
                  )}
                </div>
              </div>
            )}
            <textarea
              id={`section-body-${b.key}`}
              value={b.body}
              onChange={(e) => patch(i, { body: e.target.value })}
              onFocus={a.focus}
              onBlur={a.blur}
              placeholder={sectioned ? '내용' : placeholder ?? '이번 주 진행 내용을 적어주세요'}
              className={cx(
                field,
                'resize-y text-[14.5px] leading-[1.75] text-ink',
                sectioned ? 'min-h-[72px] py-2' : 'min-h-[120px] rounded-xl border border-line bg-surface px-3.5 py-3 transition-colors hover:border-line-strong focus:border-brand focus:ring-4 focus:ring-brand/10',
              )}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex min-h-[20px] flex-wrap items-center justify-between gap-2 text-[12px]">
        <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] font-semibold text-brand-ink hover:bg-brand-soft">
          <Plus size={15} />{sectioned ? '대주제 추가' : '대주제로 나눠 쓰기'}
        </button>
        <div className="flex items-center gap-3">
          <span className="text-ink-3">{meta}</span>
          <SaveIndicator state={a.state} savedAt={a.savedAt} />
          {has(prevContent) && !has(a.text) && (
            <button type="button" onClick={() => a.replace(prevContent!)} className="inline-flex items-center gap-1 font-semibold text-brand-ink hover:underline">
              <History size={13} />지난주 내용 불러오기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ClampedText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.split('\n').length > 6 || text.length > 360;
  return (
    <>
      <TextBlock text={text} empty="이번 주 지시사항이 없습니다" className={cx('!text-[14px]', long && !open && 'line-clamp-6')} />
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 text-[12.5px] font-semibold text-note-ink hover:underline">
          {open ? '접기' : '더 보기'}
        </button>
      )}
    </>
  );
}

/** 대표님 지시사항 메모 */
export function DirectiveBox({ value, editable, onSave, label = '대표님 지시사항', hideWhenEmpty, prevContent, directive }: {
  value: string; editable: boolean; onSave(v: string): Promise<unknown>; label?: string; hideWhenEmpty?: boolean; prevContent?: string;
  /** 있으면 처리 상태(대기·진행 중·완료)를 보여주고 담당자가 바꿀 수 있다 */
  directive?: Directive;
}) {
  const a = useAutosave(value, onSave);
  if (!editable && hideWhenEmpty && !has(value)) return null;
  return (
    <div className="rounded-xl border border-note-line bg-note px-3.5 py-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[12px] font-bold tracking-wide text-note-ink">{label}</span>
        {editable && <span className="text-[12px]"><SaveIndicator state={a.state} savedAt={a.savedAt} /></span>}
      </div>
      {editable ? (
        <>
          <textarea
            value={a.text}
            onChange={(e) => a.change(e.target.value)}
            onFocus={a.focus}
            onBlur={a.blur}
            placeholder="지시사항을 입력하면 담당자에게 바로 보입니다"
            className="block min-h-[64px] w-full resize-y rounded-md bg-transparent text-[14px] leading-[1.65] text-ink placeholder:text-note-ink/60 focus:outline-none"
          />
          {has(prevContent) && !has(a.text) && (
            <button type="button" onClick={() => a.replace(prevContent!)} className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-note-ink hover:underline">
              <History size={13} />지난주 지시 불러오기
            </button>
          )}
        </>
      ) : (
        <ClampedText text={value} />
      )}
      {directive && has(directive.content) && <DirectiveStatusBar directive={directive} />}
    </div>
  );
}

const STATUS_TONE: Record<DirectiveStatus, string> = {
  open: 'bg-surface text-ink-2 border-line-strong',
  doing: 'bg-brand-soft text-brand-ink border-brand/40',
  done: 'bg-ok/10 text-ok border-ok/40',
};

/** 지시사항 처리 상태. 담당자·대표·관리자는 눌러서 바꾼다 */
export function DirectiveStatusBar({ directive }: { directive: Directive }) {
  const { me, snap, setDirectiveStatus, toast } = useStore();
  const [busy, setBusy] = useState(false);
  if (!snap) return null;
  const writesSites = !!snap.departments.find((d) => d.id === me.departmentId)?.writesSites;
  const can = canSetDirectiveStatus(me, directive, writesSites);
  const who = directive.statusBy ? snap.members.find((m) => m.id === directive.statusBy)?.name : null;
  const set = async (s: DirectiveStatus) => {
    if (s === directive.status || busy) return;
    setBusy(true);
    try { await setDirectiveStatus(directive.id, s); } catch (e) { toast(e instanceof Error ? e.message : '바꾸지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-note-line pt-2.5">
      <span className="mr-0.5 text-[12px] font-semibold text-note-ink">처리</span>
      {can ? DIRECTIVE_STATUS.map((s) => (
        <button key={s.id} type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); void set(s.id); }}
          className={cx('rounded-full border px-2.5 py-0.5 text-[12px] font-semibold transition-colors',
            directive.status === s.id ? STATUS_TONE[s.id] : 'border-transparent text-ink-3 hover:text-ink')}>
          {s.id === 'done' && directive.status === 'done' && <Check size={11} className="mr-0.5 inline" />}{s.label}
        </button>
      )) : <span className={cx('rounded-full border px-2.5 py-0.5 text-[12px] font-semibold', STATUS_TONE[directive.status])}>{DIRECTIVE_STATUS.find((s) => s.id === directive.status)?.label}</span>}
      {who && directive.statusAt && <span className="text-[11.5px] text-ink-3">{who} · {relativeTime(directive.statusAt)}</span>}
    </div>
  );
}

/** 보고 칸의 예전 내용 보기 */
export function EntryHistoryLink({ entry }: { entry: Entry }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-3 hover:text-ink">
        <History size={12} />수정 기록
      </button>
      {open && <EntryHistoryModal entry={entry} onClose={() => setOpen(false)} />}
    </>
  );
}

function EntryHistoryModal({ entry, onClose }: { entry: Entry; onClose(): void }) {
  const { snap } = useStore();
  const [versions, setVersions] = useState<EntryVersion[] | null>(null);
  useEffect(() => { api.entryHistory(entry.id).then(setVersions).catch(() => setVersions([])); }, [entry.id]);
  const name = (id: string | null) => (id ? snap?.members.find((m) => m.id === id)?.name ?? '' : '');
  const all: (EntryVersion & { current?: boolean })[] = [{ content: entry.content, editedBy: entry.updatedBy, editedAt: entry.updatedAt, current: true }, ...(versions ?? [])];

  return (
    <Modal open onClose={onClose} title="수정 기록" width={620} footer={<Button onClick={onClose}>닫기</Button>}>
      {versions == null ? <div className="flex justify-center py-6"><Spinner /></div> : (
        <div className="space-y-3">
          {versions.length === 0 && <p className="text-[13px] text-ink-3">이전에 고친 기록이 없습니다. 처음 쓴 내용 그대로입니다.</p>}
          {all.map((v, i) => {
            const older = all[i + 1];
            const d = older ? lineDiff(v.content, older.content) : null;
            return (
              <div key={`${v.editedAt}-${i}`} className={cx('rounded-xl border px-3.5 py-3', v.current ? 'border-brand/40 bg-brand-soft/40' : 'border-line bg-surface')}>
                <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[12.5px]">
                  <b>{v.current ? '지금 내용' : i === 1 ? '직전 내용' : `${i}번 전 내용`}</b>
                  <span className="text-ink-3">{name(v.editedBy)} · {v.editedAt ? relativeTime(v.editedAt) : ''}</span>
                  {d && !d.same && <span className="text-[12px] font-semibold text-brand-ink">바뀐 줄 {d.addedCount}</span>}
                </p>
                <div className="text-[13.5px] leading-[1.65]">
                  {(d ? d.lines : v.content.split('\n').map((t) => ({ text: t, added: false }))).map((l, j) => (
                    <p key={j} className={cx('whitespace-pre-wrap', l.added && 'rounded bg-brand-soft px-1 -mx-1')}>{l.text || '\u00a0'}</p>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/** 칸별 피드백 대화 */
export function Feedback({ entry }: { entry: Entry | undefined }) {
  const { me, snap, addComment, acknowledge, deleteComment, toast } = useStore();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  if (!snap || !entry) return null;
  const members = byId(snap.members);
  const list = commentsFor(snap.comments, entry.id);
  // 보고 글을 지운 뒤에도 이미 달린 피드백은 보여서 확인·삭제할 수 있어야 한다. 새로 쓰는 칸만 글이 있을 때
  if (!has(entry.content) && !list.length) return null;
  const canWrite = has(entry.content) && (isReviewer(me) || canEditEntry(me, entry));
  const owner = !isReviewer(me) && (entry.kind === 'dept' ? entry.authorId === me.id : me.departmentId === entry.departmentId);
  const history = <div className="flex justify-end"><EntryHistoryLink entry={entry} /></div>;
  if (!list.length && !canWrite) return <div className="mt-2">{history}</div>;

  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await addComment(entry.id, draft.trim());
      setDraft('');
    } catch (e) {
      toast(e instanceof Error ? e.message : '보내지 못했습니다.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      {history}
      {list.map((c) => {
        const author = members.get(c.authorId);
        // 대표·본부장 코멘트는 담당자가 확인한다
        const fromCeo = isReviewer(author);
        return (
          <div key={c.id} className={cx('flex gap-2.5 rounded-lg px-3 py-2.5', fromCeo ? 'bg-brand-soft' : 'bg-sunken')}>
            {fromCeo ? <MessageSquareText size={16} className="mt-0.5 shrink-0 text-brand-ink" /> : <CornerDownRight size={16} className="mt-0.5 shrink-0 text-ink-3" />}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 text-[12px]">
                <span className="font-bold text-ink">{author?.name ?? '알 수 없음'}{fromCeo && (author?.isCeo ? ' · 피드백' : ` ${author?.title ?? ''} · 코멘트`)}</span>
                <span className="text-ink-3">{relativeTime(c.createdAt)}</span>
                {c.authorId === me.id && (
                  <button onClick={() => deleteComment(c.id).catch(() => toast('지우지 못했습니다.', 'error'))} className="ml-auto text-ink-3 hover:text-danger" aria-label="삭제"><Trash2 size={13} /></button>
                )}
              </div>
              <p className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-[1.6]">{c.content}</p>
              {fromCeo && (
                c.acknowledgedAt ? (
                  <p className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-ok"><Check size={13} />{members.get(c.acknowledgedBy ?? '')?.name ?? ''} 확인 · {relativeTime(c.acknowledgedAt)}</p>
                ) : owner ? (
                  <Button size="sm" tone="secondary" className="mt-1.5" onClick={() => acknowledge(c.id).catch(() => toast('처리하지 못했습니다.', 'error'))}>
                    <Check size={14} />확인했습니다
                  </Button>
                ) : (
                  <p className="mt-1 text-[12px] font-semibold text-warn">담당자 확인 전</p>
                )
              )}
            </div>
          </div>
        );
      })}
      {canWrite && (
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send(); }}
            placeholder={me.isCeo ? '이 내용에 피드백 남기기' : isReviewer(me) ? '이 내용에 코멘트 남기기' : '답글 남기기'}
            rows={1}
            className="min-h-[40px] flex-1 resize-none rounded-lg border border-line-strong bg-surface px-3 py-2 text-[13.5px] placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <Button tone="primary" size="md" onClick={send} disabled={busy || !draft.trim()} aria-label="보내기">
            <Send size={15} />
          </Button>
        </div>
      )}
    </div>
  );
}
