import type { Api } from './api';
import { demoApi } from './demoApi';
import { createSupabaseApi } from './supabaseApi';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const domain = (import.meta.env.VITE_LOGIN_EMAIL_DOMAIN as string | undefined) || 'sadakdari-report.app';

export const api: Api = !__FORCE_DEMO__ && url && key ? createSupabaseApi(url, key, domain) : demoApi;
