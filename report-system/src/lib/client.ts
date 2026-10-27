import type { Api } from './api';
import { demoApi } from './demoApi';
import { createSupabaseApi } from './supabaseApi';

type RuntimeConfig = { supabaseUrl?: string; supabaseAnonKey?: string; loginEmailDomain?: string };
const runtime = (window as unknown as { __SADAK_CONFIG__?: RuntimeConfig }).__SADAK_CONFIG__ ?? {};

const url = runtime.supabaseUrl || (import.meta.env.VITE_SUPABASE_URL as string | undefined);
const key = runtime.supabaseAnonKey || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);
const domain = runtime.loginEmailDomain || (import.meta.env.VITE_LOGIN_EMAIL_DOMAIN as string | undefined) || 'sadakdari-report.app';

/** 운영 빌드인데 서버 연결 정보가 없으면 체험판으로 넘어가지 않고 안내 화면을 보여준다 */
export const missingServerConfig = !__FORCE_DEMO__ && import.meta.env.PROD && !(url && key);

export const api: Api = !__FORCE_DEMO__ && url && key ? createSupabaseApi(url, key, domain) : demoApi;
