import { api } from './client';

/** 메모장·유튜브·메뉴 링크: 체험판·실제 서버 모두 켬 (끄려면 false) */
export const previewOn = () => true;

/** 업무 분석: 체험판에서 먼저 보여 준다 */
export const workmapOn = () => api.mode === 'demo';
