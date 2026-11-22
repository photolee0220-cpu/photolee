import { ApiError, newId } from './api';
import type { Department, Member, WeekId } from './types';
import { isOwner, type Grade, type IdeaLevel, type WorkAnalysis, type WorkIdea, type WorkmapApi, type WorkRun } from './workmapTypes';
import { shiftWeek } from './week';

/** 체험판 업무 분석: AI 대신 정해진 견본 분석을 보여 준다 (부서 이름으로 고른다) */

type Idea = [task: string, level: IdeaLevel, how: string, system: string, effort: Grade, impact: Grade];
interface Sample {
  match: RegExp;
  reports: number;
  summary: string;
  categories: [string, number, string[]][];
  recurring: [string, number, string][];
  ideas: Idea[];
}

const SAMPLES: Sample[] = [
  {
    match: /공무/, reports: 9, summary: '공정회의 자료와 협력업체 기성·계약 서류 처리가 업무의 절반이 넘습니다. 매주 같은 양식의 자료를 손으로 다시 만들고 있습니다.',
    categories: [['서류·결재', 9, ['협력업체 기성 서류 검토', '계약서 회수·정리']], ['회의·보고', 6, ['주간 공정회의 자료 정리', '공정회의 참석']], ['발주·자재', 5, ['레미콘 수급 확인', '자재 발주']], ['현장 지원', 3, ['현장 방문 공정 확인']]],
    recurring: [['협력업체 기성 서류 검토', 4, '매주 3~5건, 같은 항목을 계약 내역과 대조'], ['주간 공정회의 자료 정리', 4, '매주 같은 양식, 현장 보고를 옮겨 적음'], ['레미콘·자재 수급 확인', 3, '업체마다 전화로 확인']],
    ideas: [
      ['주간 공정회의 자료 정리', 'replace', '현장 일일보고와 공사일보에서 한 주 공정을 뽑아 회의 자료 초안을 만들고, 담당자는 고치기만 합니다.', '현장 보고 → 공정회의 자료 자동 초안 버튼', 'low', 'high'],
      ['협력업체 기성 서류 검토', 'assist', 'PDF 기성 서류에서 금액·물량을 읽어 계약 내역과 다른 곳만 표시합니다.', '자료실에 기성 서류를 올리면 대조표 자동 생성', 'mid', 'high'],
      ['레미콘·자재 수급 확인', 'assist', '업체별 확인 결과를 한 표로 모으고 부족이 예상되는 날만 알려 줍니다.', '발주·수급 현황판 + 부족 알림', 'mid', 'mid'],
      ['협력업체 협의·조율', 'human', '현장 상황 판단과 협상이 필요해 사람이 해야 합니다.', '', 'high', 'low'],
    ],
  },
  {
    match: /디자인|인테리어/, reports: 7, summary: '디자인 시안 작업과 건축주 협의가 중심입니다. 시안을 설명하는 자료와 마감재 목록 정리에 시간이 반복해서 들어갑니다.',
    categories: [['디자인 작업', 8, ['예배당 색상안', '조명 배치도']], ['건축주 협의', 4, ['색상안 설명', '수정 요청 반영']], ['자료 정리', 3, ['마감재 샘플 정리']], ['회의', 2, ['내부 디자인 회의']]],
    recurring: [['디자인 수정본 공유', 3, '수정할 때마다 설명 자료를 다시 만듦'], ['마감재 샘플 정리', 3, '사진·규격을 엑셀로 옮김']],
    ideas: [
      ['건축주용 시안 설명 자료', 'replace', '3D 이미지와 마감재 목록으로 건축주에게 보낼 설명 PDF 초안을 만듭니다.', '디자인 시안 → 건축주 설명서 자동 만들기', 'low', 'mid'],
      ['마감재 샘플 목록', 'assist', '샘플 사진에서 제품명·규격을 읽어 목록으로 정리합니다.', '마감재 라이브러리 (사진 올리면 자동 등록)', 'mid', 'mid'],
      ['색상·공간 결정', 'human', '건축주 취향과 공간 감각이 필요한 판단입니다.', '', 'high', 'low'],
    ],
  },
  {
    match: /CM/, reports: 6, summary: '신규 교회건축 문의 상담과 제안서 작성이 많습니다. 상담 내용을 정리하고 제안서 첫 초안을 만드는 데 반복 작업이 큽니다.',
    categories: [['신규 문의 상담', 6, ['전화 상담', '현장 답사']], ['제안서 작성', 4, ['제안서 초안', '사업비 개략 산출']], ['사업성 검토', 3, ['부지 검토']], ['회의', 3, ['내부 검토 회의']]],
    recurring: [['문의 상담 기록 정리', 4, '통화 메모를 다시 문서로 옮김'], ['제안서 초안 작성', 3, '비슷한 구성을 매번 처음부터']],
    ideas: [
      ['제안서 1차 초안', 'replace', '문의 카드(규모·예산·시기)와 지난 제안서를 바탕으로 1차 초안을 만듭니다.', '문의방 → 제안서 초안 버튼', 'low', 'high'],
      ['상담 기록 정리', 'replace', '통화 메모를 붙여 넣으면 문의 카드 항목(규모·예산·시기)을 채웁니다.', '상담 메모 붙여넣기 → 문의 카드 자동 채우기', 'low', 'mid'],
      ['건축주 상담', 'human', '신뢰 관계와 설득이 필요한 일입니다.', '', 'high', 'low'],
    ],
  },
  {
    match: /견적/, reports: 8, summary: '견적서 작성과 단가 조사, 업체 견적 비교가 대부분입니다. 업체 견적을 비교표로 옮기는 일이 매주 반복됩니다.',
    categories: [['견적 작성', 9, ['공종별 견적서', '변경 견적']], ['단가 조사', 5, ['자재 단가 확인']], ['업체 비교', 4, ['협력업체 견적 비교']], ['서류', 2, ['견적 근거 정리']]],
    recurring: [['견적서 작성', 4, '공종마다 비슷한 항목 반복'], ['단가 조사', 4, '지난 견적을 찾아 다시 확인'], ['업체 견적 비교', 3, '업체 견적서를 엑셀로 옮겨 비교']],
    ideas: [
      ['업체 견적 비교표', 'replace', '업체별 견적서(PDF·엑셀)를 읽어 항목별 비교표를 자동으로 만듭니다.', '견적서 여러 개 올리기 → 비교표 만들기', 'mid', 'high'],
      ['단가 조사', 'assist', '지난 견적에서 비슷한 공종 단가를 찾아 추천합니다.', '단가 이력 검색 (과거 견적 모음)', 'mid', 'high'],
      ['최종 견적 금액 판단', 'human', '회사 전략과 수주 판단이 들어가는 결정입니다.', '', 'high', 'low'],
    ],
  },
  {
    match: /안전/, reports: 7, summary: '정기 안전점검과 결과 정리, 안전교육 기록이 중심입니다. 점검 사진을 보고서로 옮기는 일이 반복됩니다.',
    categories: [['안전 점검', 7, ['정기 안전점검', '동절기 점검']], ['서류 작성', 4, ['안전관리계획서', '점검 결과 보고']], ['교육', 3, ['정기 안전교육']], ['예방 조치', 3, ['난간 보완 지시']]],
    recurring: [['정기 안전점검 결과 정리', 4, '사진과 지적 사항을 보고서로 옮김'], ['안전교육 일지', 3, '같은 양식 반복']],
    ideas: [
      ['점검 결과 보고서', 'replace', '현장 사진과 체크리스트로 점검 결과 보고서를 자동으로 만듭니다.', '점검 사진 올리기 → 보고서 초안', 'low', 'high'],
      ['안전관리계획서', 'assist', '지난 계획서와 현장 정보로 새 계획서 초안을 만듭니다.', '계획서 초안 만들기', 'mid', 'mid'],
      ['현장 위험 판단', 'human', '현장에서 직접 보고 판단해야 합니다.', '', 'high', 'low'],
    ],
  },
  {
    match: /회계/, reports: 6, summary: '기성 지급과 증빙 서류 정리가 많습니다. 영수증·세금계산서 내용을 장부로 옮기는 일이 매주 반복됩니다.',
    categories: [['정산·지급', 6, ['기성 지급 처리', '협력업체 대금']], ['서류 정리', 4, ['증빙 서류 정리']], ['세금·신고', 3, ['부가세 자료']], ['급여', 2, ['급여 자료']]],
    recurring: [['기성 지급 처리', 4, '공무 확인 후 지급'], ['증빙 서류 정리', 4, '종이·사진 증빙을 장부로 옮김']],
    ideas: [
      ['증빙 서류 정리', 'replace', '영수증·세금계산서 사진에서 금액·거래처·날짜를 읽어 장부 초안을 만듭니다.', '증빙 사진 올리면 장부 초안', 'mid', 'high'],
      ['지급 일정 관리', 'assist', '계약·기성 일정으로 지급 예정표를 만들고 미리 알려 줍니다.', '지급 예정 캘린더 + 알림', 'low', 'mid'],
      ['세무 판단', 'human', '전문 판단과 책임이 따르는 일입니다.', '', 'high', 'low'],
    ],
  },
  {
    match: /현장/, reports: 14, summary: '시공 관리가 가장 많고, 공사일보 작성과 작업 사진 정리가 매일 반복됩니다. 같은 내용을 일일보고와 공사일보에 두 번 쓰고 있습니다.',
    categories: [['시공 관리', 12, ['거푸집 설치', '타설 관리']], ['공사일보 작성', 5, ['공사일보']], ['안전 조치', 4, ['난간 보완']], ['협력업체 조율', 4, ['작업 순서 조율']]],
    recurring: [['공사일보 작성', 5, '일일보고와 같은 내용을 다시 씀'], ['작업 사진 정리', 5, '사진을 공종별로 골라 올림'], ['다음 날 작업 계획', 4, '매일 저녁']],
    ideas: [
      ['공사일보 작성', 'replace', '일일보고·사진·날씨로 공사일보 초안을 만들고 소장은 확인만 합니다.', '일일보고 → 공사일보 PDF 자동 만들기', 'low', 'high'],
      ['작업 사진 정리', 'replace', '사진을 공종·위치별로 자동으로 나눕니다.', '사진 자동 분류 (자료실 연동)', 'mid', 'mid'],
      ['현장 지휘·판단', 'human', '현장에서 사람을 움직이고 판단하는 일입니다.', '', 'high', 'low'],
    ],
  },
];

/** 견본: 실제 사이트(Opus 컨설팅 분석)에서 나오는 깊이를 보여 주는 공무 부서 예시 */
const RICH: Partial<WorkAnalysis> = {
  summary: '공무 업무의 약 60%가 협력업체 기성 서류 검토와 주간 공정회의 자료 작성에 쓰이며, 두 일 모두 현장 보고를 다시 옮겨 적는 반복 작업임. 기성 대조와 회의 자료 초안을 AI로 넘기면 주 6시간 안팎을 줄이고 기성 오류 위험도 낮출 수 있음. 이번 달 우선 과제는 "기성 대조표 자동 생성".',
  replaceRate: 55, hoursObserved: 22, hoursSavable: 6.5,
  categories: [
    { name: '기성·계약 서류', count: 9, share: 38, examples: ['협력업체 기성 서류 검토 (3건)', '계약서 회수·정리'] },
    { name: '공정회의·보고', count: 6, share: 24, examples: ['주간 공정회의 자료 정리', '공정회의 참석'] },
    { name: '자재 발주·수급', count: 5, share: 22, examples: ['레미콘 수급 확인', '자재 발주'] },
    { name: '현장 지원', count: 3, share: 16, examples: ['현장 방문 공정 확인'] },
  ],
  tasks: [
    { task: '협력업체 기성 서류 검토', category: '기성·계약 서류', times: 4, evidence: '"협력업체 기성 서류 검토 (3건)"', tools: ['엑셀', 'PDF'], output: '기성 검토표, 지급 의견', hoursPerWeek: 6, replaceability: 'partial', score: 70, reason: '물량·단가 대조는 AI가 하고, 지급 판단은 사람이 해야 함' },
    { task: '주간 공정회의 자료 작성', category: '공정회의·보고', times: 4, evidence: '"주간 공정회의 자료 정리"', tools: ['한글', '엑셀'], output: '공정회의 자료(한글)', hoursPerWeek: 4, replaceability: 'full', score: 85, reason: '현장 일일보고·공사일보를 요약해 양식에 옮기는 일이라 초안을 AI가 대신할 수 있음' },
    { task: '레미콘·자재 수급 확인', category: '자재 발주·수급', times: 3, evidence: '"레미콘 수급 확인"', tools: ['카카오톡', '전화'], output: '수급 현황 메모', hoursPerWeek: 3, replaceability: 'partial', score: 45, reason: '업체 연락은 사람이 하되 현황 정리·부족 예상 알림은 자동화 가능' },
    { task: '협력업체 협의·조율', category: '현장 지원', times: 2, evidence: '"협력업체 작업 순서 협의"', tools: ['전화', '현장 방문'], output: '협의 결과', hoursPerWeek: 3, replaceability: 'human', score: 10, reason: '현장 판단과 협상이 필요함' },
  ],
  issues: [
    { finding: '같은 공정 내용을 현장 일일보고 → 공정회의 자료 → 주간보고에 세 번 옮겨 적음', evidence: '"주간 공정회의 자료 정리" / 현장 보고 "3층 벽체 거푸집 설치"', impact: '주 3~4시간 중복, 옮겨 적다 수치가 달라질 위험' },
    { finding: '기성 서류를 계약 내역과 손으로 대조하고 있어 검토 건수가 늘면 누락 위험이 큼', evidence: '"협력업체 기성 서류 검토 (3건)"', impact: '과지급·누락 시 금전 손실, 월말 업무 집중' },
  ],
  ideas: [
    { task: '협력업체 기성 서류 검토', title: '기성 대조표 자동 생성', level: 'assist', approach: 'system', effort: 'mid', impact: 'high',
      asIs: '협력업체가 보낸 기성 PDF와 계약 내역(엑셀)을 화면 두 개로 띄워 놓고 항목별로 손으로 대조', toBe: '기성 PDF를 자료실에 올리면 AI가 계약 내역과 대조한 표를 만들고, 차이가 나는 줄만 빨간색으로 보여 줌. 담당자는 표시된 줄만 확인',
      how: '자료실 분류에 "기성"을 추가하고, 올릴 때 계약 내역 엑셀을 함께 고르게 한다. Claude가 공종·수량·단가·금액을 읽어 누계 대비 이번 회차를 계산한다.',
      system: '화면: 자료실 > 기성 > [대조하기] / 입력: 기성 PDF + 계약 내역 엑셀 / AI: 항목 추출·누계 계산·계약 대비 초과·누락 표시 / 출력: 대조표(엑셀 내려받기) + 확인 필요 줄 요약 / 저장·알림: 현장방에 "기성 검토표 올라옴" 알림',
      toolPrompt: '', steps: ['이번 주: 지난달 기성 3건을 샘플로 모아 대조 항목(공종·수량·단가·누계) 확정', '다음 주: 자료실 "기성" 분류와 대조 화면 개발', '2주간 사람 대조와 AI 대조 결과를 나란히 비교', '오차 없으면 AI 대조를 기본으로 전환'],
      hoursSaved: 3.5, savingsBasis: '주 4건 × 건당 70분 → AI 대조 후 확인 15분, 주 약 3.5시간 절감', errorReduction: '누계 초과·수량 불일치 누락 방지', risks: '스캔 품질이 나쁜 PDF는 숫자 인식 오류 가능 → 금액 합계 검산 칸을 둠', kpi: '기성 검토 소요 시간 건당 70분 → 20분, 지급 후 정정 0건' },
    { task: '주간 공정회의 자료 작성', title: '공정회의 자료 초안 자동 작성', level: 'replace', approach: 'system', effort: 'low', impact: 'high',
      asIs: '금요일 오후 현장 일일보고·공사일보를 열어 보며 한글 양식에 공정·이슈·다음 주 계획을 옮겨 씀', toBe: '금요일 15시에 시스템이 한 주 현장 보고로 회의 자료 초안(한글/PDF)을 만들어 공무 담당에게 알림. 담당은 고치고 확정만 함',
      how: '예약 작업으로 현장별 일일보고·공사일보를 모아 Claude가 "이번 주 진행 / 지연·이슈 / 다음 주 계획 / 결정 필요 사항" 4칸으로 요약',
      system: '화면: 주간보고 > 공정회의 자료 / 입력: 그 주 현장 일일보고·공사일보·사진 / AI: 현장별 4칸 요약 / 출력: 한글·PDF 초안 / 알림: 금요일 15시 공무 담당 푸시',
      toolPrompt: '', steps: ['이번 주: 지금 쓰는 회의 자료 양식 한 부를 기준으로 4칸 구성 확정', '다음 주: 예약 작업과 초안 화면 개발', '첫 2주는 사람이 쓴 자료와 비교해 빠진 내용 보완'],
      hoursSaved: 3, savingsBasis: '주 1회 작성 약 3.5시간 → 초안 검토 30분', errorReduction: '현장 보고와 회의 자료 수치 불일치 방지', risks: '현장 보고가 늦거나 부실하면 초안도 부실 → 일일보고 마감 알림과 함께 운영', kpi: '자료 작성 시간 주 3.5시간 → 0.5시간' },
    { task: '레미콘·자재 수급 확인', title: '수급 확인 메시지 정리를 Claude로', level: 'assist', approach: 'external', effort: 'low', impact: 'mid',
      asIs: '업체별 카톡·문자 답을 보고 수급 현황을 메모로 다시 정리', toBe: '카톡 대화를 그대로 복사해 Claude에 붙이면 날짜·현장·물량·확정 여부 표로 정리',
      how: 'Claude(웹·앱)에 아래 프롬프트와 함께 업체 대화를 붙여 넣는다', system: '',
      toolPrompt: '아래는 레미콘·자재 업체와의 카카오톡 대화입니다. 날짜, 현장, 품목, 규격, 물량, 확정 여부, 미확정 사유를 표로 정리하고, 다음 3일 안에 물량이 부족하거나 미확정인 건을 맨 위에 따로 적어 주세요.\n[대화 붙여넣기]',
      steps: ['이번 주: 프롬프트를 공무 담당 2명에게 공유해 써 보기', '반응이 좋으면 시스템 채팅방에 "수급 정리" 버튼으로 개발'], hoursSaved: 1, savingsBasis: '주 3회 × 20분 정리', errorReduction: '미확정 물량 놓침 방지', risks: '대화에 단가 등 민감 정보가 있으면 회사 계정으로만 사용', kpi: '타설 전날 수급 미확정 건 0건' },
  ],
  humanTasks: [{ task: '협력업체 협의·조율', reason: '현장 상황 판단과 협상, 관계 유지가 핵심이라 사람이 해야 함' }, { task: '기성 지급 최종 승인', reason: '금전 책임이 따르는 결정' }],
  ceoPoints: ['기성 대조 자동화는 금전 리스크를 줄이는 효과가 커서 1순위 추천 (개발 2주)', '공정회의 자료 자동화 후 공무 인력 주 6시간을 현장 지원으로 돌릴 수 있음', '현장 일일보고 품질이 자동화 효과를 좌우함 → 보고 양식 통일 필요'],
  questions: ['기성 서류는 주로 PDF인가요, 엑셀인가요?', '공정회의 자료 양식이 현장마다 다른가요?'],
};

/** 주마다 조금씩 다르게 (견본) */
const FACTOR = [1, 0.8, 1.15, 0.9, 1.05];

function analyze(weekId: WeekId, dept: Department, wi: number): WorkAnalysis | null {
  const s = SAMPLES.find((x) => x.match.test(dept.name));
  if (!s) return null;
  const f = FACTOR[wi % FACTOR.length];
  const n = (v: number) => Math.max(1, Math.round(v * f));
  return {
    weekId, departmentId: dept.id, reportCount: n(s.reports), summary: s.summary,
    categories: s.categories.map(([name, count, examples]) => ({ name, count: n(count), examples })),
    recurring: s.recurring.map(([task, times, note]) => ({ task, times: Math.min(6, n(times)), note })),
    ideas: s.ideas.map(([task, level, how, system, effort, impact]) => ({ task, level, how, system, effort, impact })),
    createdAt: new Date().toISOString(),
    ...(/공무/.test(dept.name) ? RICH : {}),
  };
}

export function createDemoWorkmap(ctx: { me(): Member; departments(): Department[]; reportWeek: WeekId; key: string }): WorkmapApi {
  const A = `${ctx.key}-workmap`;
  const I = `${ctx.key}-workideas`;
  const read = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? '') as T; } catch { return d; } };
  const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { throw new ApiError('체험판 저장 공간이 가득 찼습니다.'); } };
  const guard = () => { if (!isOwner(ctx.me())) throw new ApiError('업무 분석은 관리자(admin) 계정만 볼 수 있습니다.'); };
  const depts = () => ctx.departments().filter((d) => d.active !== false);
  const weekIndex = (w: WeekId) => { for (let i = 0; i < 52; i++) if (shiftWeek(ctx.reportWeek, -i) === w) return i; return 0; };
  const run = (w: WeekId) => depts().map((d) => analyze(w, d, weekIndex(w))).filter(Boolean) as WorkAnalysis[];
  const delay = <T,>(v: T, ms = 60) => new Promise<T>((r) => setTimeout(() => r(v), ms));

  const R = `${ctx.key}-workruns`;
  const runsOf = () => read<WorkRun[]>(R, []);
  const setRun = (r: WorkRun) => write(R, [...runsOf().filter((x) => x.weekId !== r.weekId), r]);
  const save = (w: WeekId) => write(A, [...read<WorkAnalysis[]>(A, []).filter((x) => x.weekId !== w), ...run(w)]);

  return {
    async list() { guard(); return delay(read<WorkAnalysis[]>(A, []).sort((a, b) => b.weekId.localeCompare(a.weekId))); },
    async ensureRecent() {
      guard();
      // 처음: 최근 4주를 바로 분석 (체험판은 견본이라 곧바로 끝난다)
      for (const i of [0, 1, 2, 3]) {
        const w = shiftWeek(ctx.reportWeek, -i);
        if (runsOf().some((r) => r.weekId === w)) continue;
        save(w);
        setRun({ weekId: w, status: 'done', total: depts().length, done: depts().length, error: null, startedAt: new Date().toISOString() });
      }
      await delay(null);
    },
    async generate(weekId) {
      guard();
      setRun({ weekId, status: 'running', total: depts().length, done: 0, error: null, startedAt: new Date().toISOString() });
      await delay(null);
    },
    async runs() {
      guard();
      // 체험판: 시작하고 4초 뒤 끝난 것으로
      for (const r of runsOf().filter((x) => x.status === 'running' && Date.now() - Date.parse(x.startedAt) > 4000)) {
        save(r.weekId);
        setRun({ ...r, status: 'done', done: r.total });
      }
      return delay(runsOf().sort((a, b) => b.weekId.localeCompare(a.weekId)));
    },
    async ideas() { guard(); return delay(read<WorkIdea[]>(I, []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); },
    async saveIdea(i) {
      guard();
      const list = read<WorkIdea[]>(I, []);
      const next = { ...i, id: i.id || newId('wi'), updatedAt: new Date().toISOString(), createdAt: i.createdAt || new Date().toISOString() };
      write(I, [...list.filter((x) => x.id !== next.id), next]);
      return delay(next);
    },
    async removeIdea(id) { guard(); write(I, read<WorkIdea[]>(I, []).filter((x) => x.id !== id)); await delay(null); },
  };
}
