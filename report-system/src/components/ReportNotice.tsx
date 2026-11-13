import { Info } from 'lucide-react';
import { DEFAULT_REPORT_NOTICE, useAppSettings } from '../lib/settings';

/** 보고 칸 아래 안내 (허위 보고 관련). 관리자가 문구를 바꾸거나 비울 수 있다 */
export function ReportNotice({ className = '' }: { className?: string }) {
  const s = useAppSettings();
  const text = (s?.reportNotice ?? DEFAULT_REPORT_NOTICE).trim();
  if (!text) return null;
  return (
    <p className={`flex items-start gap-1.5 text-[12px] leading-[1.6] text-ink-3 ${className}`}>
      <Info size={13} className="mt-[3px] shrink-0" />{text}
    </p>
  );
}
