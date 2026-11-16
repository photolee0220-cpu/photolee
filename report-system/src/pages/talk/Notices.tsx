import { BellRing, CheckCircle2, Megaphone, Pencil, Pin, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../lib/client';
import { byId } from '../../lib/derive';
import type { Notice } from '../../lib/talkTypes';
import { relativeTime } from '../../lib/week';
import { useStore } from '../../state/store';
import { Avatar, Badge, Button, Card, cx, Empty, Field, Input, Modal, Progress, Segmented, Spinner, Toggle } from '../../components/ui';
import { refreshTalk } from './useTalk';

/** 전체 공지: 대표님·관리자가 쓰고, 확인이 필요한 공지는 직원이 [확인]을 누른다 */
export function NoticeList({ notices }: { notices: Notice[] }) {
  const { me, snap } = useStore();
  const [open, setOpen] = useState<Notice | null>(null);
  const [edit, setEdit] = useState<Notice | 'new' | null>(null);
  const canWrite = me.isCeo || me.isAdmin;
  const people = (snap?.members ?? []).filter((m) => m.active);
  return (
    <div className="mx-auto max-w-[820px]">
      <div className="mb-4 flex items-center justify-between gap-2">
        <p className="text-[13px] text-ink-3">{canWrite ? '공지를 올리면 전 직원 휴대폰에 알림이 갑니다.' : '대표님·관리자가 올린 공지입니다.'}</p>
        {canWrite && <Button tone="primary" onClick={() => setEdit('new')}><Plus size={16} />공지 쓰기</Button>}
      </div>
      {!notices.length && <Empty title="아직 공지가 없습니다" icon={<Megaphone size={22} />} />}
      <div className="space-y-3">
        {notices.map((n) => {
          const author = snap?.members.find((m) => m.id === n.authorId);
          const readN = people.filter((m) => n.reads[m.id]).length;
          const ackN = people.filter((m) => n.acks[m.id]).length;
          const unreadMine = !n.reads[me.id];
          const needAck = n.requireAck && !n.acks[me.id];
          return (
            <Card key={n.id} className={cx('cursor-pointer p-4 transition-shadow hover:shadow-pop sm:p-5', needAck && 'ring-2 ring-warn/40')}>
              <div role="button" tabIndex={0} onClick={() => { setOpen(n); if (unreadMine) void api.talk.notices.read(n.id).then(() => refreshTalk()); }}
                onKeyDown={(e) => { if (e.key === 'Enter') setOpen(n); }}>
              <div className="flex items-start gap-3">
                <span className={cx('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', n.pinned ? 'bg-danger/10 text-danger' : 'bg-brand-soft text-brand-ink')}>{n.pinned ? <Pin size={17} /> : <Megaphone size={17} />}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-[15.5px] font-bold">
                    {unreadMine && <span className="h-2 w-2 rounded-full bg-danger" aria-label="안 읽음" />}
                    {n.title}
                    {n.requireAck && <Badge tone="warn">확인 필요</Badge>}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-3">{author?.name} {author?.title} · {relativeTime(n.createdAt)}</p>
                  <p className="mt-2 line-clamp-2 whitespace-pre-line text-[13.5px] text-ink-2">{n.body}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {canWrite ? (
                      <div className="flex min-w-[200px] flex-1 items-center gap-2 text-[12.5px] font-semibold text-ink-2">
                        <Progress value={people.length ? ((n.requireAck ? ackN : readN) / people.length) * 100 : 0} className="max-w-[160px] flex-1" />
                        {n.requireAck ? `확인 ${ackN} / ${people.length}명` : `읽음 ${readN} / ${people.length}명`}
                      </div>
                    ) : null}
                    {n.requireAck && (n.acks[me.id]
                      ? <span className="flex items-center gap-1 text-[12.5px] font-semibold text-ok"><CheckCircle2 size={15} />확인함</span>
                      : <Button size="sm" tone="primary" onClick={(e) => { e.stopPropagation(); void api.talk.notices.ack(n.id).then(() => refreshTalk()); }}>확인했습니다</Button>)}
                  </div>
                </div>
              </div>
              </div>
            </Card>
          );
        })}
      </div>
      {open && <NoticeModal notice={notices.find((x) => x.id === open.id) ?? open} onClose={() => setOpen(null)} onEdit={() => { setEdit(open); setOpen(null); }} />}
      {edit && <NoticeEditor notice={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function NoticeModal({ notice: n, onClose, onEdit }: { notice: Notice; onClose(): void; onEdit(): void }) {
  const { me, snap, toast } = useStore();
  const canWrite = me.isCeo || me.isAdmin;
  const depts = byId(snap?.departments ?? []);
  const people = (snap?.members ?? []).filter((m) => m.active);
  const done = (id: string) => !!(n.requireAck ? n.acks : n.reads)[id];
  const [tab, setTab] = useState<'no' | 'yes'>('no');
  const [busy, setBusy] = useState(false);
  const list = people.filter((m) => (tab === 'yes') === done(m.id));
  const author = snap?.members.find((m) => m.id === n.authorId);
  return (
    <Modal open onClose={onClose} title={n.title} width={560}
      footer={<>
        {canWrite && <Button tone="ghost" onClick={() => { if (confirm('이 공지를 지울까요?')) void api.talk.notices.remove(n.id).then(() => { onClose(); return refreshTalk(); }); }}><Trash2 size={15} />지우기</Button>}
        {canWrite && <Button onClick={onEdit}><Pencil size={15} />고치기</Button>}
        {n.requireAck && !n.acks[me.id]
          ? <Button tone="primary" onClick={() => void api.talk.notices.ack(n.id).then(() => { onClose(); return refreshTalk(); })}>확인했습니다</Button>
          : <Button tone="primary" onClick={onClose}>닫기</Button>}
      </>}>
      <p className="mb-3 text-[12.5px] text-ink-3">{author?.name} {author?.title} · {new Date(n.createdAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' })}</p>
      <p className="whitespace-pre-line text-[14.5px] leading-[1.75]">{n.body}</p>
      {canWrite && (
        <div className="mt-5 rounded-xl border border-line p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Segmented<'no' | 'yes'> value={tab} onChange={setTab} options={[
              { id: 'no', label: `${n.requireAck ? '아직 확인 안 함' : '아직 안 읽음'} ${people.filter((m) => !done(m.id)).length}` },
              { id: 'yes', label: `${n.requireAck ? '확인함' : '읽음'} ${people.filter((m) => done(m.id)).length}` },
            ]} />
            {tab === 'no' && list.length > 0 && (
              <Button size="sm" disabled={busy} onClick={() => { setBusy(true); void api.talk.notices.remind(n.id).then((c) => toast(`${c}명에게 다시 알림을 보냈습니다.`)).finally(() => setBusy(false)); }}>
                {busy ? <Spinner /> : <BellRing size={14} />}다시 알림
              </Button>
            )}
          </div>
          <ul className="grid max-h-[240px] grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
            {list.map((m) => (
              <li key={m.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1">
                <Avatar id={m.id} name={m.name} size={24} muted={tab === 'no'} />
                <span className="min-w-0 truncate text-[12.5px] font-semibold">{m.name} <span className="font-normal text-ink-3">{depts.get(m.departmentId ?? '')?.name ?? (m.isCeo ? '대표' : '')}</span></span>
              </li>
            ))}
            {!list.length && <li className="col-span-full py-3 text-center text-[12.5px] text-ink-3">{tab === 'no' ? '모두 확인했습니다' : '아직 없습니다'}</li>}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function NoticeEditor({ notice, onClose }: { notice: Notice | null; onClose(): void }) {
  const { toast } = useStore();
  const [title, setTitle] = useState(notice?.title ?? '');
  const [body, setBody] = useState(notice?.body ?? '');
  const [requireAck, setRequireAck] = useState(notice?.requireAck ?? false);
  const [pinned, setPinned] = useState(notice?.pinned ?? false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api.talk.notices.save({ id: notice?.id, title, body, requireAck, pinned });
      await refreshTalk();
      toast(notice ? '공지를 고쳤습니다.' : '공지를 올렸습니다. 전 직원에게 알림이 갑니다.');
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : '저장하지 못했습니다.', 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={notice ? '공지 고치기' : '공지 쓰기'} width={560}
      footer={<><Button onClick={onClose}>취소</Button><Button tone="primary" disabled={busy || !title.trim()} onClick={() => void save()}>{busy && <Spinner />}{notice ? '저장' : '올리기'}</Button></>}>
      <div className="space-y-4">
        <Field label="제목"><Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 연말 현장 일제 안전점검 안내" /></Field>
        <Field label="내용">
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-[14px] leading-[1.7] focus:border-brand focus:outline-none" />
        </Field>
        <Toggle checked={requireAck} onChange={setRequireAck} label={<span><b>확인 받기</b> <span className="text-ink-3">직원이 [확인했습니다]를 눌러야 하고, 누가 확인했는지 남습니다</span></span>} />
        <Toggle checked={pinned} onChange={setPinned} label={<span><b>맨 위 고정</b> <span className="text-ink-3">중요 공지를 목록 맨 위에 둡니다</span></span>} />
      </div>
    </Modal>
  );
}
