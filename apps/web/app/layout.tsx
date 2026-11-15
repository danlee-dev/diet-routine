import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_KR, Inter_Tight } from 'next/font/google';
import './globals.css';

const interTight = Inter_Tight({ subsets: ['latin'], display: 'swap', variable: '--font-inter-tight' });
const plexKr = IBM_Plex_Sans_KR({ weight: ['300', '400', '500', '600'], display: 'swap', preload: false, variable: '--font-plex-kr' });

export const metadata: Metadata = {
  title: '감량 루틴',
  description: '몇 가지 질문으로 만드는 내 감량 계획: 하루 식단, 상황별 대처, 기록, 운동과 장보기',
  appleWebApp: { capable: true, title: '감량 루틴', statusBarStyle: 'default' },
  icons: { icon: '/icon-192.png', apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FCFCFC' },
    { media: '(prefers-color-scheme: dark)', color: '#0A0A0A' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={`${interTight.variable} ${plexKr.variable}`}>
      <body>{children}</body>
    </html>
  );
}
