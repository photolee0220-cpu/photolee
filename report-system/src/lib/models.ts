/** AI 요약에 쓸 수 있는 모델. 비용은 이번 보고(약 1만 6천 자) 기준 어림값 */
export const SUMMARY_MODELS = [
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', tier: 'quick', cost: '요약 1회 약 3원 · 한 달 약 50원', note: '가장 저렴하고 빠름' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', tier: 'default', cost: '요약 1회 약 55원 · 한 달 약 900원', note: '더 꼼꼼한 정리' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', tier: 'complex', cost: '요약 1회 약 110원 · 한 달 약 1,800원', note: '가장 높은 품질' },
] as const;

export type SummaryModelId = (typeof SUMMARY_MODELS)[number]['id'];
export const DEFAULT_SUMMARY_MODEL: SummaryModelId = 'claude-haiku-5-5';

export function summaryModel(id: string | null | undefined) {
  return SUMMARY_MODELS.find((m) => m.id === id) ?? SUMMARY_MODELS[0];
}
