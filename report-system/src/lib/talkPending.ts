import { ApiError } from './api';
import { DEFAULT_TALK_SETTINGS, type TalkApi } from './talkTypes';

/** 실제 서버의 소통 기능은 체험판 승인 뒤에 붙인다. 그 전까지 메뉴는 체험판에서만 보인다 */
const pending = () => Promise.reject(new ApiError('소통 기능은 준비 중입니다.'));

export const pendingTalk: TalkApi = {
  load: async () => ({ rooms: [], notices: [], inquiries: [], minutes: [], settings: structuredClone(DEFAULT_TALK_SETTINGS) }),
  messages: async () => [],
  send: pending, editMessage: pending, deleteMessage: pending, markRead: async () => undefined, setMuted: pending, pin: pending, openDm: pending, toDirective: pending,
  notices: { save: pending, remove: pending, read: async () => undefined, ack: pending, remind: pending },
  inquiries: { save: pending, remove: pending, toSite: pending },
  minutes: { upload: pending, remove: pending, request: pending },
  safety: { suggestions: async () => [], send: pending, dismiss: pending },
  admin: { rooms: async () => [], saveRoom: pending, deleteRoom: pending, saveSettings: pending },
};
