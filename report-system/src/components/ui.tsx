import { X } from 'lucide-react';
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { colorFor, initials } from '../lib/derive';
import { STAGES, type Stage } from '../lib/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type BtnTone = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({ tone = 'secondary', size = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone; size?: 'sm' | 'md' }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-[background,color,transform,box-shadow] duration-150 active:scale-[.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-10 px-3.5 text-sm',
        tone === 'primary' && 'bg-brand text-on-brand hover:brightness-110',
        tone === 'secondary' && 'bg-surface text-ink border border-line hover:border-line-strong hover:bg-sunken',
        tone === 'ghost' && 'text-ink-2 hover:bg-sunken hover:text-ink',
        tone === 'danger' && 'bg-danger-soft text-danger hover:brightness-95',
        className,
      )}
    />
  );
}

export function IconButton({ label, className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      {...p}
      className={cx('inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 hover:bg-sunken hover:text-ink transition-colors', className)}
    />
  );
}

export function Badge({ tone = 'neutral', children, className }: { tone?: 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'note'; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-[3px] text-[11.5px] font-semibold leading-none whitespace-nowrap',
        tone === 'neutral' && 'bg-sunken text-ink-2',
        tone === 'brand' && 'bg-brand-soft text-brand-ink',
        tone === 'ok' && 'bg-ok-soft text-ok',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'danger' && 'bg-danger-soft text-danger',
        tone === 'note' && 'bg-note text-note-ink',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({ id, name, size = 28, muted }: { id: string; name: string; size?: number; muted?: boolean }) {
  return (
    <span
      title={name}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ring-2 ring-surface', muted && 'opacity-40 grayscale')}
      style={{ width: size, height: size, fontSize: size * 0.38, background: colorFor(id) }}
    >
      {initials(name)}
    </span>
  );
}

export function Progress({ value, className }: { value: number | null; className?: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-sunken', className)} role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
      <div className={cx('h-full rounded-full transition-[width] duration-500', v >= 100 ? 'bg-ok' : 'bg-brand')} style={{ width: `${v}%` }} />
    </div>
  );
}

export function StageChip({ stage }: { stage: Stage }) {
  const s = STAGES.find((x) => x.id === stage)!;
  return <Badge tone={stage === 'construction' ? 'brand' : stage === 'cm' ? 'neutral' : 'warn'}>{s.short}</Badge>;
}

export function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T; onChange(v: T): void; options: { id: T; label: ReactNode }[]; className?: string;
}) {
  return (
    <div className={cx('inline-flex rounded-lg bg-sunken p-0.5', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            'h-8 rounded-md px-3 text-[13px] font-semibold transition-colors whitespace-nowrap',
            value === o.id ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ children, className, onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={cx(
        'rounded-2xl border border-line bg-surface shadow-card text-left',
        onClick && 'transition-[border-color,box-shadow,transform] hover:border-line-strong hover:shadow-pop active:scale-[.995] w-full',
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function SectionTitle({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-[17px] font-bold tracking-[-0.01em]">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-ink-3">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <p className="font-semibold text-ink-2">{title}</p>
      {children && <div className="mt-1 text-[13px] text-ink-3">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-brand', className)} />;
}

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
}

/** 오른쪽에서 열리는 상세 패널. 휴대폰에서는 전체 화면 */
export function Sheet({ open, onClose, title, subtitle, children, width = 640, headerRight }: {
  open: boolean; onClose(): void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; width?: number; headerRight?: ReactNode;
}) {
  useEscape(onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <section
        role="dialog"
        aria-modal="true"
        className="relative flex h-full w-full flex-col bg-bg shadow-pop animate-slide-in sm:border-l sm:border-line"
        style={{ maxWidth: width, paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <header className="flex items-start gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold leading-snug">{title}</h2>
            {subtitle && <div className="mt-1 text-[13px] text-ink-3">{subtitle}</div>}
          </div>
          {headerRight}
          <IconButton label="닫기" onClick={onClose}><X size={20} /></IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 scrollbar-thin">{children}</div>
      </section>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, width = 520 }: {
  open: boolean; onClose(): void; title: ReactNode; children: ReactNode; footer?: ReactNode; width?: number;
}) {
  useEscape(onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-black/30 animate-fade-in" onClick={onClose} />
      <section role="dialog" aria-modal="true" className="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-pop animate-pop-in sm:rounded-2xl" style={{ maxWidth: width }}>
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-bold">{title}</h2>
          <IconButton label="닫기" onClick={onClose}><X size={18} /></IconButton>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}>{footer}</footer>}
      </section>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

const inputCls = 'h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/10';

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(inputCls, p.className)} />;
}

export function Select({ children, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(inputCls, 'pr-8', p.className)}>{children}</select>;
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange(v: boolean): void; label: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex cursor-pointer items-center gap-2.5 text-sm', disabled && 'opacity-50 pointer-events-none')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-line-strong')}
      >
        <span className={cx('absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-[left]', checked ? 'left-[19px]' : 'left-[3px]')} />
      </button>
      <span>{label}</span>
    </label>
  );
}
