'use client';
// First screen for a new install: what the app does, in big type, and two ways in.
import { useState } from 'react';
import { useAuth } from '@/lib/hooks';
import { getSupabase } from '@/lib/client';
import { SignInOptions } from '../Settings';
import { Icon } from '../Icon';

// A sample day, set as type: the app's whole idea in one glance (times, one line per thing to do).
const SAMPLE: [string, string, string][] = [
  ['07:30', '아침', '달걀 2개 · 그릭요거트'],
  ['11:30', '점심', '즉석밥 작은공기 · 닭가슴살 · 브로콜리'],
  ['15:00', '간식', '바나나 · 무가당 두유'],
  ['18:10', '홈트 A', '상체 · 25분'],
  ['19:00', '저녁', '두부 · 샐러드 · 방울토마토'],
  ['20:00', '마감', '이후에는 물만'],
];

export function Welcome({ onStart }: { onStart: () => void }) {
  const auth = useAuth();
  const canSignIn = !!getSupabase();
  // coming back from a failed Google sign-in: open the sign-in panel with the message
  const [signIn, setSignIn] = useState(() => !!auth.error);
  return (
    <div className="welcome">
      <header className="wl-top"><span className="wl-brand">다루</span></header>
      <main className="wl-main">
        <section className="wl-copy">
          <h1 className="wl-title">오늘 할 일만<br />하나씩 보여 드립니다</h1>
          <p className="wl-sub">몇 가지 질문에 답하면 먹을 것, 운동, 장보기 목록이 정해집니다. 웹과 아이폰이 같은 기록을 봅니다.</p>
          {!signIn ? (
            <div className="wl-acts">
              <button type="button" className="btn-primary pill" onClick={onStart}>시작하기</button>
              {canSignIn && <button type="button" className="btn-ghost pill" onClick={() => setSignIn(true)}>이미 계정이 있습니다</button>}
            </div>
          ) : (
            <div className="wl-signin">
              <p className="s-lead">쓰던 계정으로 로그인하면 기록과 계획을 그대로 가져옵니다.</p>
              <SignInOptions />
              <button type="button" className="link-btn wl-new" onClick={onStart}>처음이라면 시작하기<Icon name="chevron-right" size="sm" /></button>
            </div>
          )}
        </section>
        <ol className="wl-day" aria-label="하루 예시">
          {SAMPLE.map(([t, h, s]) => (
            <li key={t}><span className="t">{t}</span><span className="h">{h}</span><span className="s">{s}</span></li>
          ))}
        </ol>
      </main>
    </div>
  );
}
