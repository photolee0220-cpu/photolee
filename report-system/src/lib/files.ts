type Downloads = { save(r: { filename: string; data: Blob }): Promise<unknown> };
type ClaudeHost = { use?: (name: string) => Promise<unknown> };

/** 파일 내려받기. Claude 아티팩트 안에서는 저장 확인 창을 거친다 */
export async function saveFile(filename: string, blob: Blob): Promise<boolean> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host?.use) {
    const downloads = (await host.use('downloads').catch(() => null)) as Downloads | null;
    if (downloads) {
      try {
        await downloads.save({ filename, data: blob });
        return true;
      } catch {
        return false;
      }
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}
