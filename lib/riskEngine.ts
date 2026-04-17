import { PhotoHints, RiskDoc, RiskRow } from './types';

const severityKeywords = ['추락', '감전', '붕괴'];

const baselineMap: Record<string, Omit<RiskRow, '위험성'>[]> = {
  철근콘크리트: [
    { 분류: '작업특성요인', 유해위험요인: '거푸집 해체 작업 중 붕괴 위험', 가능성: 2, 중대성: 4, 감소대책: '해체순서 준수 및 지지상태 점검', 비고: '' },
    { 분류: '작업환경요인', 유해위험요인: '슬래브 가장자리 작업 중 추락 위험', 가능성: 2, 중대성: 4, 감소대책: '안전난간 설치 및 안전대 체결', 비고: '' },
    { 분류: '기계적요인', 유해위험요인: '양중 작업반경 내 충돌 및 협착 사고', 가능성: 2, 중대성: 3, 감소대책: '신호수 배치 및 작업반경 통제', 비고: '' }
  ],
  마감공사: [
    { 분류: '인적요인', 유해위험요인: '정리정돈 미흡 상태에서 전도 위험', 가능성: 2, 중대성: 2, 감소대책: '통로 정리 및 자재 분리 적치', 비고: '' },
    { 분류: '전기적요인', 유해위험요인: '가설전선 피복 손상으로 인한 감전 위험', 가능성: 2, 중대성: 4, 감소대책: '절연상태 확인 및 누전차단기 점검', 비고: '' }
  ],
  설비공사: [
    { 분류: '작업특성요인', 유해위험요인: '협소 공간 배관 설치 중 협착 위험', 가능성: 2, 중대성: 3, 감소대책: '작업순서 교육 및 감시자 배치', 비고: '' },
    { 분류: '전기적요인', 유해위험요인: '활선 인접 작업 중 감전 위험', 가능성: 1, 중대성: 4, 감소대책: '전원 차단 및 절연공구 점검', 비고: '' }
  ]
};

export function inferPhotoHints(fileName: string): PhotoHints {
  const t = fileName.toLowerCase();
  return {
    고소작업: /height|roof|tower|ladder|scaffold|고소|옥상|사다리|비계/.test(t) ? '예상' : '미확인',
    사다리: /ladder|사다리/.test(t) ? '존재 예상' : '미확인',
    비계: /scaffold|비계/.test(t) ? '존재 예상' : '미확인',
    크레인: /crane|크레인/.test(t) ? '존재 예상' : '미확인',
    지게차: /forklift|지게차/.test(t) ? '존재 예상' : '미확인',
    자재적치불량: /mess|pile|stack|적치|혼재/.test(t) ? '의심' : '미확인',
    협소공간: /narrow|tight|협소|통로/.test(t) ? '의심' : '미확인'
  };
}

function calcRisk(row: Omit<RiskRow, '위험성'>): RiskRow {
  const boosted = severityKeywords.some((k) => row.유해위험요인.includes(k));
  const sev = boosted ? Math.max(row.중대성, 3) : row.중대성;
  return { ...row, 중대성: sev, 위험성: row.가능성 * sev };
}

export function generateRiskDoc(input: RiskDoc['meta'], hints: PhotoHints): RiskDoc {
  const baseline = baselineMap[input.공종] ?? [
    { 분류: '인적요인', 유해위험요인: `${input.단위작업 || '작업'} 중 부주의로 인한 충돌 사고`, 가능성: 2, 중대성: 2, 감소대책: '작업 전 위험요인 교육 및 수신호 확인', 비고: '' },
    { 분류: '작업환경요인', 유해위험요인: `정리정돈 미흡 상태에서 전도 위험`, 가능성: 2, 중대성: 2, 감소대책: '통로 확보 및 자재 정리 점검', 비고: '' }
  ];

  const photoRows: Omit<RiskRow, '위험성'>[] = [];

  if (hints.고소작업 === '예상' || hints.사다리 === '존재 예상') {
    photoRows.push({
      분류: '작업특성요인',
      유해위험요인: '사다리 작업 중 추락 위험',
      가능성: 2,
      중대성: 4,
      감소대책: '사다리 고정 및 2인 1조 작업 확인',
      비고: hints.사다리 === '미확인' ? '사다리 사용 여부 확인 필요' : ''
    });
  }

  if (hints.비계 === '존재 예상') {
    photoRows.push({
      분류: '기계적요인',
      유해위험요인: '비계 발판 불량 상태에서 추락 위험',
      가능성: 2,
      중대성: 4,
      감소대책: '발판 고정 및 난간 설치 점검',
      비고: ''
    });
  }

  if (hints.크레인 === '존재 예상' || hints.지게차 === '존재 예상') {
    photoRows.push({
      분류: '기계적요인',
      유해위험요인: '장비 작업반경 내 충돌 및 협착 사고',
      가능성: 2,
      중대성: 3,
      감소대책: '신호수 배치 및 작업반경 출입 금지',
      비고: hints.크레인 === '미확인' || hints.지게차 === '미확인' ? '장비 종류 확인 필요' : ''
    });
  }

  if (hints.자재적치불량 === '의심') {
    photoRows.push({
      분류: '작업환경요인',
      유해위험요인: '자재 불안정 적치로 인한 낙하 및 전도 사고',
      가능성: 2,
      중대성: 3,
      감소대책: '자재 구획 적치 및 결속상태 점검',
      비고: '적치상태 확인 필요'
    });
  }

  if (hints.협소공간 === '의심') {
    photoRows.push({
      분류: '작업환경요인',
      유해위험요인: '협소 통로 이동 중 충돌 및 전도 위험',
      가능성: 2,
      중대성: 2,
      감소대책: '이동통로 확보 및 출입 인원 통제',
      비고: '통로 폭 확인 필요'
    });
  }

  const uniq = [...baseline, ...photoRows].filter(
    (row, idx, arr) => idx === arr.findIndex((x) => x.유해위험요인 === row.유해위험요인)
  );

  return {
    meta: input,
    rows: uniq.map(calcRisk)
  };
}
