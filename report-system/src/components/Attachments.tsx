import { Download, FileArchive, FileImage, FileSpreadsheet, FileText, Paperclip, Presentation, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../lib/client';
import { ATTACH_ACCEPT, checkAttachable, fileKind, formatBytes } from '../lib/fileTypes';
import type { Attachment, EntryKind } from '../lib/types';
import { relativeTime } from '../lib/week';
import { useStore } from '../state/store';
import { cx, IconButton, Spinner } from './ui';

export interface AttachTarget {
  kind: EntryKind;
  siteId: string | null;
  departmentId: string;
  authorId: string | null;
}

export function attachmentsFor(list: Attachment[] | undefined, t: AttachTarget): Attachment[] {
  return (list ?? []).filter((a) => a.kind === t.kind && a.departmentId === t.departmentId
    && (t.kind === 'site' ? a.siteId === t.siteId : t.kind === 'dept' ? a.authorId === t.authorId : true));
}

const ICON = {
  pdf: { Icon: FileText, cls: 'text-danger bg-danger/10' },
  sheet: { Icon: FileSpreadsheet, cls: 'text-ok bg-ok/10' },
  doc: { Icon: FileText, cls: 'text-brand bg-brand-soft' },
  hwp: { Icon: FileText, cls: 'text-brand bg-brand-soft' },
  slide: { Icon: Presentation, cls: 'text-warn bg-warn/10' },
  image: { Icon: FileImage, cls: 'text-ink-2 bg-sunken' },
  zip: { Icon: FileArchive, cls: 'text-ink-2 bg-sunken' },
  other: { Icon: Paperclip, cls: 'text-ink-2 bg-sunken' },
};

/** 보고 칸에 붙인 파일 목록. editable이면 바로 추가할 수 있다 */
export function AttachmentList({ target, editable, className }: { target: AttachTarget; editable: boolean; className?: string }) {
  const { snap, weekId, reload, toast } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const files = attachmentsFor(snap?.attachments, target);
  if (!editable && !files.length) return null;

  const add = async (list: FileList | null) => {
    if (!list?.length) return;
    const picked = [...list];
    setBusy(picked.length);
    let ok = 0;
    for (const f of picked) {
      try {
        const bad = checkAttachable(f);
        if (bad) throw new Error(bad);
        await api.uploadAttachment({ weekId, ...target, file: f });
        ok++;
      } catch (e) {
        toast(e instanceof Error ? e.message : '파일을 올리지 못했습니다.', 'error');
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (input.current) input.current.value = '';
    await reload();
    if (ok) toast(`파일 ${ok}개를 올렸습니다`);
  };

  return (
    <div className={cx('mt-3', className)}>
      {files.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {files.map((f) => <FileRow key={f.id} file={f} />)}
        </ul>
      )}
      {busy > 0 && <p className="mb-2 flex items-center gap-2 text-[12.5px] text-ink-3"><Spinner className="h-4 w-4" />파일 {busy}개 올리는 중…</p>}
      {editable && (
        <>
          <button type="button" onClick={() => input.current?.click()} disabled={busy > 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 py-1.5 text-[12.5px] font-semibold text-ink-3 hover:border-brand hover:text-brand-ink">
            <Paperclip size={14} />파일 첨부 <span className="font-normal">(PDF·엑셀·한글 등, 20MB까지)</span>
          </button>
          <input ref={input} type="file" accept={ATTACH_ACCEPT} multiple hidden onChange={(e) => void add(e.target.files)} />
        </>
      )}
    </div>
  );
}

function FileRow({ file }: { file: Attachment }) {
  const { snap, me, reload, toast } = useStore();
  const [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const who = snap?.members.find((m) => m.id === file.uploadedBy);
  const { Icon, cls } = ICON[fileKind(file.fileName)];
  const canDelete = file.uploadedBy === me.id || me.isAdmin;

  const download = async () => {
    setLoading(true);
    try { await api.downloadAttachment(file); } catch (e) { toast(e instanceof Error ? e.message : '내려받지 못했습니다.', 'error'); } finally { setLoading(false); }
  };

  return (
    <li className="flex items-center gap-2.5 rounded-xl border border-line bg-surface px-2.5 py-2">
      <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', cls)}><Icon size={16} /></span>
      <button type="button" onClick={download} className="min-w-0 flex-1 text-left">
        <p className="truncate text-[13.5px] font-semibold hover:text-brand-ink hover:underline">{file.fileName}</p>
        <p className="text-[12px] text-ink-3">{formatBytes(file.sizeBytes)} · {who?.name ?? ''} · {relativeTime(file.createdAt)}</p>
      </button>
      <IconButton label="내려받기" onClick={download} disabled={loading}>{loading ? <Spinner className="h-4 w-4" /> : <Download size={16} />}</IconButton>
      {canDelete && (confirm ? (
        <button className="shrink-0 rounded-md bg-danger px-2.5 py-1 text-[12px] font-semibold text-white"
          onClick={async () => {
            try { await api.deleteAttachment(file.id); await reload(); toast('파일을 지웠습니다'); } catch (e) { toast(e instanceof Error ? e.message : '지우지 못했습니다.', 'error'); }
          }}>지우기</button>
      ) : (
        <IconButton label="파일 지우기" onClick={() => setConfirm(true)}><Trash2 size={15} /></IconButton>
      ))}
    </li>
  );
}

export function FileCount({ count }: { count: number }) {
  if (!count) return null;
  return <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2"><Paperclip size={13} />{count}</span>;
}
