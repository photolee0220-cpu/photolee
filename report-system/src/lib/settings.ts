import { useEffect, useState } from 'react';
import { api } from './client';
import type { AppSettings } from './types';

/** 보고 칸 아래 안내 문구 기본값 (관리자가 바꿀 수 있다) */
export const DEFAULT_REPORT_NOTICE = '보고 내용과 작성·수정 기록은 모두 저장됩니다. 사실과 다른 보고는 사내 규정에 따라 조치될 수 있습니다.';

/** AI 기능 스위치 기본값: 모두 켜짐 */
export const DEFAULT_AI = { master: true, ask: true };

let cache: AppSettings | null = null;
let pending: Promise<AppSettings> | null = null;
const listeners = new Set<(s: AppSettings) => void>();

function load(): Promise<AppSettings> {
  pending ??= api.getSettings().then((s) => { cache = s; listeners.forEach((l) => l(s)); return s; }).finally(() => { pending = null; });
  return pending;
}

/** 관리자가 설정을 바꾸면 열린 화면에도 바로 반영 */
export function settingsChanged(s: AppSettings) {
  cache = s;
  listeners.forEach((l) => l(s));
}

/** 앱 설정 (한 번 읽어 두고 함께 쓴다) */
export function useAppSettings(): AppSettings | null {
  const [s, set] = useState<AppSettings | null>(cache);
  useEffect(() => {
    listeners.add(set);
    if (!cache) void load().catch(() => undefined);
    return () => { listeners.delete(set); };
  }, []);
  return s;
}

export function aiOn(s: AppSettings | null, feature: 'ask'): boolean {
  const ai = { ...DEFAULT_AI, ...(s?.ai ?? {}) };
  return ai.master && ai[feature];
}
