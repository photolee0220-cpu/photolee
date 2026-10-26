# 사닥다리 주간보고

현장×부서 주간보고를 직원이 직접 쓰고, 대표가 한 화면에서 보고 지시·피드백하는 웹앱입니다.

## 실행

```bash
npm install
npm run dev              # Supabase 설정(.env)이 없으면 체험판(브라우저 저장)으로 실행
npm run build            # 운영 빌드
npm run build:artifact   # 체험판 단일 HTML (Claude 아티팩트용)
```

## 운영 서버 연결 (Supabase + Vercel)

1. Supabase 프로젝트 생성 → SQL Editor에서 `supabase/migrations/0001_init.sql` 실행
2. Authentication > Providers > Email 에서 "Confirm email" 끄기
3. `supabase functions deploy admin-users` (함수 환경변수 `LOGIN_EMAIL_DOMAIN`)
4. `.env.example`을 `.env`로 복사해 URL·키 입력, Vercel에도 같은 값으로 배포

## 기존 엑셀 가져오기

```bash
node scripts/import-excel.mjs <주간보고.xlsx>
```

조직도는 `seed/private/org.json`(형식: `seed/org.example.json`)에서 읽고, 결과는 `seed/private/seed.json`에 저장됩니다.
실제 회사 데이터는 `seed/private/`에만 두며 `.gitignore`로 제외됩니다. 저장소에는 가상 샘플만 있습니다.
