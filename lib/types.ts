export type Category = '인적요인' | '기계적요인' | '전기적요인' | '작업특성요인' | '작업환경요인';

export interface RiskRow {
  분류: Category;
  유해위험요인: string;
  가능성: number;
  중대성: number;
  위험성: number;
  감소대책: string;
  비고: string;
}

export interface RiskDoc {
  meta: {
    현장명: string;
    수급인: string;
    공종: string;
    단위작업: string;
    제출일: string;
    평가기간: string;
    근로자의견: string;
    승인자의견: string;
  };
  rows: RiskRow[];
}

export interface PhotoHints {
  고소작업: '예상' | '미확인';
  사다리: '존재 예상' | '미확인';
  비계: '존재 예상' | '미확인';
  크레인: '존재 예상' | '미확인';
  지게차: '존재 예상' | '미확인';
  자재적치불량: '의심' | '미확인';
  협소공간: '의심' | '미확인';
}
