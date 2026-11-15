'use client';
// get_trends answer drawn as a card: kept days, intake, workouts and runs, and the weight trend line.
// Every number is from the block (summarizeTrends in core); nothing is computed here but the drawing.
import { fmt } from '@diet/core';
import type { TrendBlock } from '@diet/core/coach';
import s from './coach.module.css';

const md = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)}`;

/** Trend line over the range with the weigh-ins as small rings. */
function Spark({ points }: { points: TrendBlock['weight']['points'] }) {
  const W = 300, H = 46, PAD = 5;
  const vals = points.flatMap((p) => [p.trend, p.kg]).filter((v): v is number => v != null);
  if (!vals.length) return null;
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = Math.max(0.6, hi - lo);
  const mid = (lo + hi) / 2;
  const x = (i: number) => (points.length > 1 ? PAD + (i * (W - PAD * 2)) / (points.length - 1) : W / 2);
  const y = (v: number) => H / 2 - ((v - mid) / span) * (H - PAD * 2);
  const line = points.map((p, i) => (p.trend != null ? `${x(i).toFixed(1)},${y(p.trend).toFixed(1)}` : null)).filter(Boolean);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="체중 추세">
      <line className={s.spBase} x1={PAD} x2={W - PAD} y1={H - 1} y2={H - 1} />
      {line.length > 1 && <polyline className={s.spLine} points={line.join(' ')} />}
      {points.map((p, i) => (p.kg != null ? <circle key={p.date} className={s.spDot} cx={x(i)} cy={y(p.kg)} r={3.2} /> : null))}
    </svg>
  );
}

export function TrendCard({ block: b }: { block: TrendBlock }) {
  const weighIns = b.weight.points.filter((p) => p.kg != null).length;
  return (
    <article className={`${s.trend} sq`} aria-label={`${b.label} 기록 요약`}>
      <div className={s.cardHead}>
        <span className={s.eyebrow}>{b.label} · {md(b.from)}{b.from !== b.to ? `–${md(b.to)}` : ''}</span>
        <span className={s.eyebrow}>{b.finished}일 마침</span>
      </div>
      <div className={s.trendGrid}>
        <div><b>{b.kept.days}<small>/ {b.kept.of}일</small></b><span>지킨 날</span></div>
        <div>
          <b>{b.intake.avgKcal != null ? fmt(b.intake.avgKcal) : '-'}<small>kcal</small></b>
          <span>{b.intake.avgTarget != null ? `하루 평균 · 목표 ${fmt(b.intake.avgTarget)}` : '기록한 날이 없습니다'}</span>
        </div>
        <div><b>{b.workouts.home}<small>회</small></b><span>홈트{b.workouts.minutes ? ` · ${fmt(b.workouts.minutes)}분` : ''}</span></div>
        <div><b>{b.runs.km.toFixed(1)}<small>km</small></b><span>러닝·걷기 {b.runs.count}회</span></div>
      </div>
      <div className={s.trendWeight}>
        {weighIns > 0 ? (
          <>
            <Spark points={b.weight.points} />
            <p>
              {b.weight.trendFirst != null && b.weight.trendLast != null && b.weight.trendChange != null
                ? <>추세 <b>{b.weight.trendFirst.toFixed(1)} → {b.weight.trendLast.toFixed(1)}kg</b> ({signed(b.weight.trendChange)})</>
                : <>체중 <b>{b.weight.last?.toFixed(1)}kg</b></>}
              {` · 체중 기록 ${weighIns}번`}
            </p>
          </>
        ) : <p>이 기간에는 체중 기록이 없습니다</p>}
      </div>
    </article>
  );
}
