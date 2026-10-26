import { useCallback } from 'react';
import { buildWeeklyWorkbook } from '../lib/exportExcel';
import { saveFile } from '../lib/files';
import type { Snapshot } from '../lib/types';
import { useStore } from '../state/store';

export function useExport() {
  const { me, toast } = useStore();
  return useCallback(async (snap: Snapshot) => {
    try {
      toast('엑셀 파일을 만드는 중입니다');
      const { blob, filename } = await buildWeeklyWorkbook(snap, me);
      const ok = await saveFile(filename, blob);
      if (ok) toast(`${filename} 저장을 시작했습니다`);
    } catch {
      toast('엑셀 파일을 만들지 못했습니다.', 'error');
    }
  }, [me, toast]);
}
