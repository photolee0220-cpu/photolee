import { canSeeAll, canViewDept } from './access';
import { byId, memberDirective, personEntry, reporters, siteDepartments, siteDirective, siteEntry, visibleSites } from './derive';
import { isBuildStage, type Member, type Snapshot } from './types';
import { parseIsoDate } from './week';

const fileNote = (n: number) => (n ? `(첨부파일 ${n}개 · 시스템에서 확인)` : '');

/** 지금 쓰는 주간보고 엑셀과 같은 모양으로 내보낸다. snap은 이미 권한에 맞게 걸러진 데이터 */
export async function buildWeeklyWorkbook(snap: Snapshot, me: Member): Promise<{ blob: Blob; filename: string }> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = '사닥다리 주간보고';
  const d = parseIsoDate(snap.weekId);
  const yymmdd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const ws = wb.addWorksheet(String(d.getFullYear()), { views: [{ state: 'frozen', ySplit: 0 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });

  const depts = siteDepartments(snap).filter((dp) => canViewDept(me, dp.id, snap.grants));
  const members = byId(snap.members);
  const people = (deptId: string) => snap.members.filter((m) => m.active && m.departmentId === deptId).map((m) => m.name).join(', ');
  const lastCol = 6 + depts.length;

  ws.columns = [
    { width: 5 }, { width: 24 }, { width: 12 }, { width: 14 }, { width: 9 }, { width: 34 },
    ...depts.map(() => ({ width: 38 })),
  ];

  const thin = { style: 'thin' as const, color: { argb: 'FFB8BDB6' } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  const headFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFE8ECE7' } };
  const noteFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FFFFF7DB' } };
  const sectionFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: 'FF0E7C66' } };

  const styleRow = (r: number, opts: { head?: boolean } = {}) => {
    const row = ws.getRow(r);
    for (let c = 1; c <= lastCol; c++) {
      const cell = row.getCell(c);
      cell.border = border;
      cell.alignment = { wrapText: true, vertical: opts.head ? 'middle' : 'top', horizontal: opts.head || c === 1 ? 'center' : 'left' };
      cell.font = { name: '맑은 고딕', size: 9, bold: !!opts.head };
      if (opts.head) cell.fill = headFill;
    }
  };

  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = `사닥다리종합건설 건설관련 부서별 현장 진행사항 정리 (${yymmdd})`;
  title.font = { name: '맑은 고딕', size: 15, bold: true };
  title.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 30;
  ws.getCell(2, lastCol).value = `보고일: ${snap.weekId}`;
  ws.getCell(2, lastCol).alignment = { horizontal: 'right' };
  ws.getCell(2, lastCol).font = { name: '맑은 고딕', size: 9 };

  let r = 3;
  const section = (label: string) => {
    ws.mergeCells(r, 1, r, lastCol);
    const c = ws.getCell(r, 1);
    c.value = label;
    c.font = { name: '맑은 고딕', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = sectionFill;
    c.alignment = { vertical: 'middle' };
    ws.getRow(r).height = 22;
    r++;
  };

  const sites = visibleSites(snap);
  for (const stage of snap.stages) {
    const list = sites.filter((s) => s.stage === stage.id);
    if (!list.length) continue;
    section(stage.label);
    const isCons = isBuildStage(stage.id);
    ws.getRow(r).values = ['NO', '현장명', isCons ? '준공예상일' : '착공예상일', isCons ? '주요진행공정' : '주요진행사항', isCons ? '공정율' : '연면적', '대표님 지시사항',
      ...depts.map((dp) => `${dp.name} (${people(dp.id)})`)];
    styleRow(r, { head: true });
    r++;
    list.forEach((s, i) => {
      const due = s.dueDate ? parseIsoDate(s.dueDate) : s.dueText;
      ws.getRow(r).values = [
        i + 1,
        [s.name, s.note].filter(Boolean).join('\n'),
        due,
        s.process,
        s.progress != null ? s.progress / 100 : s.scale,
        siteDirective(snap.directives, s.id)?.content ?? '',
        ...depts.map((dp) => {
          const n = snap.photos.filter((p) => p.siteId === s.id && p.departmentId === dp.id).length;
          const f = (snap.attachments ?? []).filter((a) => a.kind === 'site' && a.siteId === s.id && a.departmentId === dp.id).length;
          return [siteEntry(snap.entries, s.id, dp.id)?.content ?? '', n ? `(현장 사진 ${n}장 · 시스템에서 확인)` : '', fileNote(f)].filter(Boolean).join('\n');
        }),
      ];
      styleRow(r);
      ws.getCell(r, 2).font = { name: '맑은 고딕', size: 9, bold: true };
      if (s.dueDate) ws.getCell(r, 3).numFmt = 'yyyy-mm-dd';
      if (s.progress != null) ws.getCell(r, 5).numFmt = '0%';
      ws.getCell(r, 6).fill = noteFill;
      r++;
    });
  }

  // 현장 외 부서별 보고 (사람별)
  const list = reporters(snap).filter((m) => personEntry(snap.entries, m.id)?.content || memberDirective(snap.directives, m.id)?.content);
  if (list.length) {
    r++;
    section('현장외 부서별도 주간진행 보고사항');
    ws.getRow(r).values = ['no', '부서명', '', '보고인', '', '대표님 지시사항', '업무진행사항'];
    ws.mergeCells(r, 2, r, 3);
    ws.mergeCells(r, 4, r, 5);
    if (lastCol > 7) ws.mergeCells(r, 7, r, lastCol);
    styleRow(r, { head: true });
    r++;
    list.forEach((m, i) => {
      const dept = snap.departments.find((x) => x.id === m.departmentId);
      ws.getRow(r).values = [i + 1, dept?.name ?? '', '', `${m.name}${m.title}`, '', memberDirective(snap.directives, m.id)?.content ?? '',
        [personEntry(snap.entries, m.id)?.content ?? '', fileNote((snap.attachments ?? []).filter((a) => a.kind === 'dept' && a.authorId === m.id).length)].filter(Boolean).join('\n')];
      ws.mergeCells(r, 2, r, 3);
      ws.mergeCells(r, 4, r, 5);
      if (lastCol > 7) ws.mergeCells(r, 7, r, lastCol);
      styleRow(r);
      ws.getCell(r, 6).fill = noteFill;
      r++;
    });
  }

  ws.getCell(r + 1, 1).value = `내려받은 사람: ${members.get(me.id)?.name ?? me.name} · ${new Date().toLocaleString('ko-KR')}`;
  ws.getCell(r + 1, 1).font = { name: '맑은 고딕', size: 8, color: { argb: 'FF888888' } };

  const buf = await wb.xlsx.writeBuffer();
  const scope = canSeeAll(me) ? '전체' : snap.departments.find((x) => x.id === me.departmentId)?.name.replace(/[\\/]/g, '·') ?? '';
  return {
    blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename: `주간보고_${yymmdd}_${scope}.xlsx`,
  };
}
