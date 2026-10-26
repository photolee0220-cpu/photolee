import { Camera, ChevronLeft, ChevronRight, ImagePlus, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/client';
import { shrinkImage } from '../lib/image';
import type { Photo } from '../lib/types';
import { relativeTime } from '../lib/week';
import { useStore } from '../state/store';
import { cx, IconButton, Spinner } from './ui';

/** 현장 칸에 붙은 사진 묶음. editable이면 바로 추가할 수 있다 */
export function PhotoStrip({ siteId, departmentId, editable, photos: given }: {
  siteId: string; departmentId: string; editable: boolean; photos?: Photo[];
}) {
  const { snap, weekId, reload, toast } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const photos = given ?? (snap?.photos ?? []).filter((p) => p.siteId === siteId && p.departmentId === departmentId);
  if (!editable && !photos.length) return null;

  const add = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    setBusy(list.length);
    let ok = 0;
    for (const f of list) {
      try {
        const small = await shrinkImage(f, api.mode === 'demo' ? 1024 : 1920, api.mode === 'demo' ? 0.7 : 0.82);
        await api.uploadPhoto({ weekId, siteId, departmentId, caption: '', ...small });
        ok++;
      } catch (e) {
        toast(e instanceof Error ? e.message : '사진을 올리지 못했습니다.', 'error');
        if (api.mode === 'demo') break;
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (input.current) input.current.value = '';
    await reload();
    if (ok) toast(`사진 ${ok}장을 올렸습니다`);
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <button key={p.id} type="button" onClick={() => setOpen(i)} className="group relative h-20 w-20 overflow-hidden rounded-lg border border-line bg-sunken sm:h-24 sm:w-24">
            <img src={p.url} alt="현장 사진" loading="lazy" decoding="async" className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          </button>
        ))}
        {Array.from({ length: busy }).map((_, i) => (
          <div key={`b${i}`} className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-line-strong sm:h-24 sm:w-24"><Spinner /></div>
        ))}
        {editable && (
          <button type="button" onClick={() => input.current?.click()} disabled={busy > 0}
            className="flex h-20 w-20 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong text-[12px] font-semibold text-ink-3 hover:border-brand hover:text-brand-ink sm:h-24 sm:w-24">
            <ImagePlus size={20} />사진 추가
          </button>
        )}
      </div>
      {editable && <input ref={input} id={`photo-${siteId}-${departmentId}`} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files)} />}
      {open != null && photos[open] && <Lightbox photos={photos} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

export function PhotoCount({ count }: { count: number }) {
  if (!count) return null;
  return <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-2"><Camera size={13} />{count}</span>;
}

function Lightbox({ photos, index, onIndex, onClose }: { photos: Photo[]; index: number; onIndex(i: number): void; onClose(): void }) {
  const { snap, me, reload, toast } = useStore();
  const p = photos[index];
  const who = snap?.members.find((m) => m.id === p.uploadedBy);
  const dept = snap?.departments.find((d) => d.id === p.departmentId);
  const canDelete = p.uploadedBy === me.id || me.isAdmin;
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [index, photos.length, onIndex, onClose]);
  useEffect(() => setConfirm(false), [index]);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-black/90 animate-fade-in" onClick={onClose}
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="flex items-center gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        <p className="min-w-0 flex-1 truncate text-[13px]">
          <b>{who?.name ?? ''}</b> · {dept?.name ?? ''} · {relativeTime(p.createdAt)} <span className="opacity-60">({index + 1}/{photos.length})</span>
        </p>
        {canDelete && (confirm ? (
          <button className="rounded-md bg-danger px-3 py-1.5 text-[13px] font-semibold text-white"
            onClick={async () => {
              try { await api.deletePhoto(p.id); await reload(); toast('사진을 지웠습니다'); onClose(); } catch (e) { toast(e instanceof Error ? e.message : '지우지 못했습니다.', 'error'); }
            }}>정말 지우기</button>
        ) : (
          <IconButton label="사진 지우기" onClick={() => setConfirm(true)} className="text-white hover:bg-white/10 hover:text-white"><Trash2 size={18} /></IconButton>
        ))}
        <IconButton label="닫기" onClick={onClose} className="text-white hover:bg-white/10 hover:text-white"><X size={20} /></IconButton>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
        <img src={p.url} alt="현장 사진" className="max-h-full max-w-full rounded-md object-contain" onClick={(e) => e.stopPropagation()} />
        {index > 0 && (
          <button aria-label="이전 사진" onClick={(e) => { e.stopPropagation(); onIndex(index - 1); }}
            className={cx('absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70')}><ChevronLeft size={24} /></button>
        )}
        {index < photos.length - 1 && (
          <button aria-label="다음 사진" onClick={(e) => { e.stopPropagation(); onIndex(index + 1); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"><ChevronRight size={24} /></button>
        )}
      </div>
    </div>
  );
}
