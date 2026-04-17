import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '수시 위험성평가 자동 생성 시스템',
  description: '건설현장 수시 위험성평가 초안 생성 도구'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
