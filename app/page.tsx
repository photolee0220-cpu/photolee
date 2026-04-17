'use client';

import { ChangeEvent, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { generateRiskDoc, inferPhotoHints } from '@/lib/riskEngine';
import { Category, RiskDoc, RiskRow } from '@/lib/types';

const initialMeta: RiskDoc['meta'] = {
  현장명: '',
  수급인: '',
  공종: '',
  단위작업: '',
  제출일: '',
  평가기간: '',
  근로자의견: '',
  승인자의견: ''
};

const categories: Category[] = ['인적요인', '기계적요인', '전기적요인', '작업특성요인', '작업환경요인'];

export default function Page() {
  const [meta, setMeta] = useState(initialMeta);
  const [rows, setRows] = useState<RiskRow[]>([]);
  const [imageName, setImageName] = useState('');
  const [imagePreview, setImagePreview] = useState('');

  const hints = useMemo(() => inferPhotoHints(imageName), [imageName]);

  const onMetaChange = (key: keyof RiskDoc['meta']) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setMeta((prev) => ({ ...prev, [key]: e.target.value }));
  };

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageName(file.name);
    setImagePreview(URL.createObjectURL(file));
  };

  const generate = () => {
    const doc = generateRiskDoc(meta, hints);
    setRows(doc.rows);
  };

  const updateRow = (idx: number, key: keyof RiskRow, value: string | number) => {
    setRows((prev) =>
      prev.map((r, i) => {
        if (i !== idx) return r;
        const next = { ...r, [key]: value } as RiskRow;
        if (key === '가능성' || key === '중대성') {
          const p = Number(key === '가능성' ? value : next.가능성);
          const s = Number(key === '중대성' ? value : next.중대성);
          next.가능성 = Math.min(3, Math.max(1, p));
          next.중대성 = Math.min(4, Math.max(1, s));
          next.위험성 = next.가능성 * next.중대성;
        }
        return next;
      })
    );
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      { 분류: '인적요인', 유해위험요인: '', 가능성: 1, 중대성: 1, 위험성: 1, 감소대책: '', 비고: '' }
    ]);
  };

  const saveLocal = () => {
    const data: RiskDoc = { meta, rows };
    localStorage.setItem('risk_doc_draft', JSON.stringify(data));
    alert('저장 완료');
  };

  const loadLocal = () => {
    const raw = localStorage.getItem('risk_doc_draft');
    if (!raw) return alert('저장 데이터 없음');
    const parsed = JSON.parse(raw) as RiskDoc;
    setMeta(parsed.meta);
    setRows(parsed.rows);
  };

  const downloadExcel = () => {
    const header = [
      ['현장명', meta.현장명],
      ['수급인', meta.수급인],
      ['공종', meta.공종],
      ['단위작업', meta.단위작업],
      ['제출일', meta.제출일],
      ['평가기간', meta.평가기간],
      ['근로자의견', meta.근로자의견],
      ['승인자의견', meta.승인자의견],
      []
    ];

    const body = [
      ['분류', '유해위험요인', '가능성', '중대성', '위험성', '감소대책', '비고'],
      ...rows.map((r) => [r.분류, r.유해위험요인, r.가능성, r.중대성, r.위험성, r.감소대책, r.비고])
    ];

    const ws = XLSX.utils.aoa_to_sheet([...header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '위험성평가');
    XLSX.writeFile(wb, `수시위험성평가_${meta.현장명 || '초안'}.xlsx`);
  };

  const jsonOutput = useMemo(() => JSON.stringify({ meta, rows }, null, 2), [meta, rows]);

  return (
    <main className="container">
      <h1>수시 위험성평가 자동 생성 시스템</h1>
      <p className="notice">본 시스템은 초안 생성 도구이며 최종 문서는 반드시 현장 관리자가 검토합니다.</p>

      <section className="card">
        <div className="grid">
          {(Object.keys(meta) as (keyof RiskDoc['meta'])[]).map((key) => (
            <div className="field" key={key}>
              <label>{key}</label>
              {key.includes('의견') ? (
                <textarea value={meta[key]} onChange={onMetaChange(key)} />
              ) : (
                <input value={meta[key]} onChange={onMetaChange(key)} />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="grid">
          <div className="field">
            <label>사진 업로드</label>
            <input type="file" accept="image/*" onChange={onUpload} />
          </div>
          <div className="field">
            <label>사진 분석 요약</label>
            <textarea
              readOnly
              value={Object.entries(hints)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n')}
            />
          </div>
          <div className="field">
            <label>생성 / 저장 / 다운로드</label>
            <div>
              <button onClick={generate}>초안 생성</button>
              <button className="secondary" onClick={addRow}>행 추가</button>
              <button className="secondary" onClick={saveLocal}>저장</button>
              <button className="secondary" onClick={loadLocal}>불러오기</button>
              <button className="secondary" onClick={downloadExcel} disabled={rows.length === 0}>엑셀 다운로드</button>
            </div>
          </div>
          <div className="field">
            <label>업로드 이미지 미리보기</label>
            {imagePreview ? <img src={imagePreview} alt="upload preview" className="preview" /> : <div className="notice">이미지 없음</div>}
          </div>
        </div>
      </section>

      <section className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>분류</th>
              <th>유해위험요인</th>
              <th>가능성(빈도)</th>
              <th>중대성(강도)</th>
              <th>위험성</th>
              <th>감소대책</th>
              <th>비고</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={`${row.유해위험요인}-${i}`}>
                <td>
                  <select value={row.분류} onChange={(e) => updateRow(i, '분류', e.target.value)}>
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td><input value={row.유해위험요인} onChange={(e) => updateRow(i, '유해위험요인', e.target.value)} /></td>
                <td><input type="number" min={1} max={3} value={row.가능성} onChange={(e) => updateRow(i, '가능성', Number(e.target.value))} /></td>
                <td><input type="number" min={1} max={4} value={row.중대성} onChange={(e) => updateRow(i, '중대성', Number(e.target.value))} /></td>
                <td>{row.위험성}</td>
                <td><input value={row.감소대책} onChange={(e) => updateRow(i, '감소대책', e.target.value)} /></td>
                <td><input value={row.비고} onChange={(e) => updateRow(i, '비고', e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h3>출력 JSON</h3>
        <textarea readOnly value={jsonOutput} style={{ minHeight: 320 }} />
      </section>
    </main>
  );
}
