'use client';
import { addDays, DOW, md, mdw, parseKey, programDate, TARGET_BAND, TARGETS, type WeightPoint } from '@diet/core';
import { dayRecord, streaks, todayView, weightData } from '@diet/data';
import { useEnv, usePhone } from '@/lib/hooks';
import { Icon } from '../Icon';
import { useOverlay } from '../ui';
import { DaySheet, WeightSheet } from '../sheets';

function Chart({ series, avg, dayIdx, days }: { series: WeightPoint[]; avg: WeightPoint[]; dayIdx: number; days: number }) {
  const env = useEnv();
  const phone = usePhone();
  const W = 600, H = 250, pl = 34, pr = 14, pt = 14, pb = 28, xmax = days - 1;
  let ymin = 69, ymax = 77;
  for (const p of series) { ymin = Math.min(ymin, Math.floor(p.w - 0.5)); ymax = Math.max(ymax, Math.ceil(p.w + 0.5)); }
  const x = (i: number) => pl + ((W - pl - pr) * i) / xmax;
  const y = (v: number) => pt + ((H - pt - pb) * (ymax - v)) / (ymax - ymin);
  const pts = (arr: [number, number][]) => arr.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`);
  const band = `M${pts(TARGET_BAND.upper).join(' L')} L${pts([...TARGET_BAND.lower].reverse()).join(' L')} Z`;
  const grid: number[] = [];
  for (let v = Math.ceil(ymin); v <= ymax; v++) if (v % 2 === 0) grid.push(v);
  const r = (phone ? 6 : 3.5) * (series.length > 20 ? 0.75 : 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="30일 체중 그래프">
      <path className="band" d={band} />
      {grid.map((v) => (
        <g key={v}>
          <line className="gl" x1={pl} x2={W - pr} y1={y(v).toFixed(1)} y2={y(v).toFixed(1)} />
          <text className="lb" x={pl - 6} y={(y(v) + 4).toFixed(1)} textAnchor="end">{v}</text>
        </g>
      ))}
      {[0, 7, 14, 21, 28].map((i) => <text key={i} className="lb" x={x(i).toFixed(1)} y={H - 8} textAnchor="middle">{md(programDate(env.program, i))}</text>)}
      {dayIdx >= 0 && dayIdx <= xmax && <line className="tl" x1={x(dayIdx).toFixed(1)} x2={x(dayIdx).toFixed(1)} y1={pt} y2={H - pb} />}
      {avg.length > 1 && <path className="al" d={`M${avg.map((p) => `${x(p.i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' L')}`} />}
      {series.length > 0 && <path className="wl" d={`M${series.map((p) => `${x(p.i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' L')}`} />}
      {series.map((p) => <circle key={p.i} className="pt" cx={x(p.i).toFixed(1)} cy={y(p.w).toFixed(1)} r={r} />)}
      {!series.length && <text className="em" x={W / 2} y={H / 2} textAnchor="middle">아침 체중을 넣으면 여기에 선이 그려집니다</text>}
    </svg>
  );
}

function Calendar({ dayIdx }: { dayIdx: number }) {
  const env = useEnv();
  const { open } = useOverlay();
  const lead = parseKey(env.program.startDate).getDay();
  return (
    <div className="cal">
      {DOW.map((h) => <div key={h} className="cal-h">{h}</div>)}
      {Array.from({ length: lead }, (_, b) => <div key={`b${b}`} className="cell is-blank" />)}
      {Array.from({ length: env.program.days }, (_, i) => {
        const rec = dayRecord(env, i);
        const fut = i > dayIdx;
        const isT = i === dayIdx;
        return (
          <button
            key={i}
            type="button"
            className={`cell sq${isT ? ' is-today' : ''}${fut ? ' is-future' : ''}`}
            aria-label={`${mdw(rec.date)} 기록`}
            onClick={() => open(<DaySheet i={i} />)}
          >
            <span className="d">{rec.date.getDate() === 1 ? md(rec.date) : rec.date.getDate()}</span>
            {rec.workout && <Icon name="dumbbell" className="wk" />}
            <span className="w">{rec.weight != null ? rec.weight.toFixed(1) : ''}</span>
            <span className="mb"><i style={{ width: `${Math.round((rec.meals / 5) * 100)}%` }} /></span>
          </button>
        );
      })}
    </div>
  );
}

export function Records() {
  const env = useEnv();
  const { open } = useOverlay();
  const v = todayView(env);
  const { series, avg, stats } = weightData(env, v.ctx.idx);
  const st = streaks(env, v.ctx.idx);
  const P = env.program;
  const fromStart = stats.last != null ? stats.last - P.startWeight : null;
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">기록 · {v.ctx.no}일째</span>
        <h1 className="page-title">몸 변화</h1>
        <p className="page-sub">식단 연속 {st.streak}일 · 홈트 {st.workouts}회 · 남은 기간 {Math.max(0, P.days - v.ctx.no)}일</p>
      </div>
      <div className="rec-grid">
        <div className="col">
          <div className="box sq">
            <div className="log-top" style={{ marginBottom: 12 }}><span className="eyebrow">체중</span><span className="delta">이번 주 목표 {TARGETS[Math.min(v.ctx.week, 4)]!.text}</span></div>
            <div className="stats" style={{ marginBottom: 14 }}>
              <div className="stat"><b>{stats.last != null ? stats.last.toFixed(1) : '-'}</b><span>최근 kg</span></div>
              <div className="stat"><b>{fromStart != null ? `${fromStart <= 0 ? '' : '+'}${fromStart.toFixed(1)}` : '-'}</b><span>시작 대비</span></div>
              <div className="stat"><b>{stats.projection != null ? stats.projection.toFixed(1) : '-'}</b><span>{stats.projection != null ? `${md(addDays(parseKey(P.startDate), P.days - 1))} 예상` : '5일 기록 후 예상'}</span></div>
            </div>
            <div className="chart"><Chart series={series} avg={avg} dayIdx={v.ctx.idx} days={P.days} /></div>
            <div className="legend" style={{ marginTop: 8 }}><span><i />체중</span><span><i className="a" />7일 평균</span><span><i className="b" />목표 범위</span></div>
            <button type="button" className={`mini-btn${v.weight != null ? ' ghost' : ''}`} style={{ width: '100%', marginTop: 14 }} onClick={() => open(<WeightSheet i={v.ctx.idx} />, { focus: '#wh-kg' })}>
              <Icon name="weight" />{v.weight != null ? `오늘 체중 고치기 · ${v.weight.toFixed(1)}kg` : '오늘 아침 체중 기록'}
            </button>
            <p className="note" style={{ marginTop: 10 }}>하루 숫자는 물과 소금에 따라 1kg씩 오르내립니다. 7일 평균이 목표 범위 안에 있으면 잘 가고 있는 겁니다.</p>
          </div>
        </div>
        <div className="col">
          <div className="box sq">
            <div className="log-top" style={{ marginBottom: 12 }}><span className="eyebrow">30일 달력</span><span className="delta">{md(parseKey(P.startDate))} ~ {md(addDays(parseKey(P.startDate), P.days - 1))}</span></div>
            <Calendar dayIdx={v.ctx.idx} />
            <p className="note" style={{ marginTop: 12 }}>막대는 먹음 표시한 끼니 수, 숫자는 그날 체중입니다. 날짜를 누르면 지난 기록을 고칠 수 있습니다.</p>
          </div>
        </div>
      </div>
    </>
  );
}
