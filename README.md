# 수시 위험성평가 자동 생성 시스템

## 프로젝트 구조

```
photolee/
  app/
    globals.css
    layout.tsx
    page.tsx
  lib/
    riskEngine.ts
    types.ts
  package.json
  tsconfig.json
  next.config.js
```

## 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 접속.

## 기능

- Next.js 기반 웹앱
- 이미지 업로드 및 파일명 기반 현장 요소 추정(확인 필요 표기)
- 수시 위험성평가 초안 자동 생성
- 표 직접 편집
- JSON 출력
- 엑셀 다운로드
- 로컬 저장/불러오기

## 출력 JSON 구조

```json
{
  "meta": {
    "현장명": "",
    "수급인": "",
    "공종": "",
    "단위작업": "",
    "제출일": "",
    "평가기간": "",
    "근로자의견": "",
    "승인자의견": ""
  },
  "rows": [
    {
      "분류": "",
      "유해위험요인": "",
      "가능성": 0,
      "중대성": 0,
      "위험성": 0,
      "감소대책": "",
      "비고": ""
    }
  ]
}
```
