import { api } from './client';

/** 체험판에서 먼저 보여 주는 기능 (메모장·유튜브·메뉴 링크). 승인 뒤 실제 서버에 붙이면 true로 */
export const previewOn = () => api.mode === 'demo';
