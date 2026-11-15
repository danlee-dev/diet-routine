import { useEffect, useState, useSyncExternalStore } from 'react';
import { DOW, type RunRow } from '@diet/core';
import { runSession, type RunSnapshot } from './session';

export const useRunSession = (): RunSnapshot => useSyncExternalStore(runSession.subscribe, runSession.get, runSession.get);

/** Moving time for the big clock: keeps ticking between GPS fixes while moving (at most 1.5 s ahead of the tracker). */
export function useRunClock(s: RunSnapshot): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (s.phase !== 'recording') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [s.phase]);
  if (!s.live) return 0;
  const ahead = s.live.status === 'moving' && !s.paused && s.lastFixAt ? Math.min(1.5, Math.max(0, (now - s.lastFixAt) / 1000)) : 0;
  return Math.floor(s.live.movingS + ahead);
}

const partOfDay = (h: number): string => (h < 5 ? '새벽' : h < 11 ? '아침' : h < 14 ? '점심' : h < 18 ? '오후' : h < 22 ? '저녁' : '밤');

/** "토요일 저녁 달리기" */
export function runTitle(r: Pick<RunRow, 'started_at' | 'kind'>): string {
  const d = new Date(r.started_at);
  return `${DOW[d.getDay()]}요일 ${partOfDay(d.getHours())} ${r.kind === 'walk' ? '걷기' : '달리기'}`;
}

/** "11월 15일 · 19:02" */
export function runWhen(r: Pick<RunRow, 'started_at'>): string {
  const d = new Date(r.started_at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "1시간 12분", "32분" */
export function durationWords(sec: number): string {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
}
