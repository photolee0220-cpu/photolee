/** 회의록 PDF를 쪽마다 그림으로 바꿔 휴대폰에서도 바로 보이게 한다 (pdf.js는 필요할 때만 불러온다) */

type PdfJs = typeof import('pdfjs-dist');
let lib: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  lib ??= (async () => {
    const [m, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
    m.GlobalWorkerOptions.workerSrc = worker.default;
    return m;
  })();
  return lib;
}

async function bytesOf(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('파일을 불러오지 못했습니다.');
  return new Uint8Array(await res.arrayBuffer());
}

/** 쪽 그림(JPEG data URL)을 차례로 넘긴다. width는 그림 가로 픽셀 */
export async function renderPdfPages(url: string, width: number, onPage: (i: number, total: number, img: string) => void, maxPages = 40): Promise<number> {
  const m = await pdfjs();
  const doc = await m.getDocument({
    data: await bytesOf(url),
    // 글꼴이 안 들어간 한글 PDF용 (한국어 cmap만 함께 올려 둔다)
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`,
    cMapPacked: true,
  }).promise;
  const total = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    onPage(i - 1, total, canvas.toDataURL('image/jpeg', 0.85));
    page.cleanup();
  }
  void doc.destroy();
  return total;
}

/** 목록에 쓰는 첫 쪽 미리보기 */
export async function pdfThumb(url: string, width = 240): Promise<string> {
  let out = '';
  await renderPdfPages(url, width, (_, __, img) => { out = img; }, 1);
  return out;
}

/** PDF 안의 글자를 뽑는다 (AI 검색용). 스캔본처럼 글자가 없으면 빈 문자열 */
export async function pdfText(url: string, maxPages = 40): Promise<string> {
  const m = await pdfjs();
  const doc = await m.getDocument({ data: await bytesOf(url), cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`, cMapPacked: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let line = '';
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      line += it.str;
      if (it.hasEOL) { out.push(line.trim()); line = ''; } else line += ' ';
    }
    if (line.trim()) out.push(line.trim());
    page.cleanup();
  }
  void doc.destroy();
  return out.filter(Boolean).join('\n').replace(/[ \t]+/g, ' ').trim();
}
