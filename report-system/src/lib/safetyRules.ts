/** 보고·일정에서 위험 작업을 찾는 말과 기본 당부 문구.
 *  AI를 켜 두면 이 말로 후보 현장만 고르고 문장은 AI가 쓴다. AI가 꺼져 있으면 이 문구를 그대로 쓴다 */
export const SAFETY_RULES: { re: RegExp; label: string; tip: string }[] = [
  { re: /타설|레미콘|펌프카/, label: '콘크리트 타설', tip: '펌프카 아웃트리거 받침과 지반 확인, 타설 중 거푸집·동바리 변형 감시, 신호수 배치' },
  { re: /거푸집|동바리/, label: '거푸집·동바리', tip: '설치 상태와 동바리 간격·수직도를 타설 전에 다시 확인' },
  { re: /비계|난간|고소|개구부|추락/, label: '고소 작업', tip: '작업 전 난간·발판 고정 확인, 안전대 걸이 사용, 개구부 덮개 점검' },
  { re: /크레인|양중|인양/, label: '양중 작업', tip: '신호수 지정, 작업 반경 출입 통제, 줄걸이·슬링 점검' },
  { re: /반입|하역|철근 \d+톤/, label: '자재 반입', tip: '하역 구간 출입 통제, 장비와 사람 동선 분리' },
  { re: /용접|절단|화기|단열재|우레탄/, label: '화기·단열재', tip: '단열재 주변 화기작업 금지, 화재감시자 배치와 소화기 비치' },
  { re: /굴착|흙막이|터파기/, label: '굴착', tip: '흙막이 변위 확인, 굴착면 접근 통제, 장비 후진 경보' },
  { re: /비 예보|강풍|우천|폭우|폭염|한파/, label: '기상', tip: '외부·고소 작업 중지 기준 공유, 가설 전기 누전 점검, 휴식 시간 확보' },
  { re: /해체|철거/, label: '해체·철거', tip: '해체 순서 확인, 하부 출입 통제, 낙하물 방지망 점검' },
  { re: /밀폐|맨홀|정화조/, label: '밀폐공간', tip: '산소·유해가스 측정 후 출입, 감시인 배치, 환기' },
  { re: /신규 근로자|신규자/, label: '신규 근로자', tip: '신규 근로자 작업 전 교육과 숙련자 짝 배치' },
];

export const stripMarks = (s: string) => s.replace(/\[\/?(b|red|blue|hl)\]/g, '').replace(/\s+/g, ' ').trim();

/** 보고 줄들에서 걸린 규칙 */
export function safetyHits(lines: string[]) {
  return SAFETY_RULES.map((rule) => ({ rule, src: lines.filter((l) => rule.re.test(l)) })).filter((h) => h.src.length);
}

export function ruleText(siteName: string, hits: ReturnType<typeof safetyHits>): string {
  return `[${siteName} 안전 당부]\n${hits.map((h) => `· ${h.rule.label}: ${h.rule.tip}`).join('\n')}\n작업 전 TBM에서 꼭 공유하고, 조치 결과는 일일보고에 남겨 주세요.`;
}
