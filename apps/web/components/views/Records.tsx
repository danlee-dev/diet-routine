'use client';
import { addDays, DOW, md, mdw, parseKey, programDate, sgn, TARGET_BAND, TARGETS, type WeightPoint } from '@diet/core';
import { dayRecord, streaks, todayView, weightData } from '@diet/data';
import { useEnv, usePhone } from '@/lib/hooks';
import { Icon } from '../Icon';
import { PageHead, useOverlay } from '../ui';
import { AccountButton } from '../Settings';
import { DaySheet, WeightSheet } from '../sheets';

/** Signed one-decimal number with a real minus sign. */
const signed = (x: number) => sgn(x).replace('-', '−');

function Chart({ series, avg, dayIdx, days }: { series: WeightPoint[]; avg: WeightPoint[]; dayIdx: number; days: number }) {
  const env = useEnv();
  const phone = usePhone();
  const W = 600, H = phone ? 300 : 250, pl = phone ? 44 : 34, pr = 10, pt = 14, pb = phone ? 36 : 28, xmax = days - 1;
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
          <text className="lb" x={pl - 8} y={(y(v) + 5).toFixed(1)} textAnchor="end">{v}</text>
        </g>
      ))}
      {[0, 7, 14, 21, 28].map((i) => <text key={i} className="lb" x={x(i).toFixed(1)} y={H - 6} textAnchor="middle">{md(programDate(env.program, i))}</text>)}
      {dayIdx >= 0 && dayIdx <= xmax && <line className="tl" x1={x(dayIdx).toFixed(1)} x2={x(dayIdx).toFixed(1)} y1={pt} y2={H - pb} />}
      {avg.length > 1 && <path className="al" d={`M${avg.map((p) => `${x(p.i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' L')}`} />}
      {series.length > 0 && <path className="wl" d={`M${series.map((p) => `${x(p.i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' L')}`} />}
      {series.map((p) => <circle key={p.i} className="pt" cx={x(p.i).toFixed(1)} cy={y(p.w).toFixed(1)} r={r} />)}
      {!series.length && <text className="em" x={W / 2} y={(H - pb) / 2} textAnchor="middle">아침 체중을 넣으면 선이 그려집니다</text>}
    </svg>
  );
}

const RC = 2 * Math.PI * 15;

/** 30 days as small rings: how many of the five meals were marked. Today is filled. */
function Calendar({ dayIdx }: { dayIdx: number }) {
  const env = useEnv();
  const { open } = useOverlay();
  const lead = parseKey(env.program.startDate).getDay();
  return (
    <div className="ringcal" role="group" aria-label="30일 달력">
      {DOW.map((h) => <div key={h} className="rc-h" aria-hidden="true">{h}</div>)}
      {Array.from({ length: lead }, (_, b) => <div key={`b${b}`} aria-hidden="true" />)}
      {Array.from({ length: env.program.days }, (_, i) => {
        const rec = dayRecord(env, i);
        const fut = i > dayIdx;
        const isT = i === dayIdx;
        const pct = Math.min(1, rec.meals / 5);
        const d = rec.date.getDate();
        return (
          <button
            key={i}
            type="button"
            className={`rc-day${isT ? ' is-today' : ''}${fut ? ' is-future' : ''}`}
            disabled={fut}
            aria-current={isT ? 'date' : undefined}
            aria-label={`${mdw(rec.date)} · 끼니 ${rec.meals}/5${rec.weight != null ? ` · ${rec.weight.toFixed(1)}kg` : ''}${rec.workout ? ' · 운동함' : ''}`}
            onClick={() => open(<DaySheet i={i} />)}
          >
            <span className="rc-ring">
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <circle className="tr" cx="18" cy="18" r="15" />
                {pct > 0 && <circle className="pr" cx="18" cy="18" r="15" strokeDasharray={`${(pct * RC).toFixed(2)} ${RC.toFixed(2)}`} transform="rotate(-90 18 18)" />}
                {isT && <circle className="fill" cx="18" cy="18" r="11.5" />}
              </svg>
              <span className="dn">{d === 1 ? md(rec.date) : d}</span>
            </span>
            <span className="kg">{rec.weight != null ? rec.weight.toFixed(1) : ''}</span>
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
  const start = parseKey(P.startDate);
  const end = addDays(start, P.days - 1);
  const last = stats.last;
  const prev = series.length > 1 ? series[series.length - 2]!.w : null;
  const target = TARGETS[Math.min(v.ctx.week, 4)]!;
  const daysLeft = Math.max(0, P.days - v.ctx.no);
  return (
    <>
      <PageHead eyebrow={`기록 · ${v.ctx.no}일째`} title="몸 변화" trailing={<AccountButton className="only-phone" />} />
      <div className="two-col">
        <div className="col">
          <section aria-label="현재 체중">
            <p className={`hero-num${last == null ? ' is-empty' : ''}`}>{(last ?? P.startWeight).toFixed(1)}<small>kg</small></p>
            <p className="hero-delta">
              {last != null
                ? <>시작보다 <b>{signed(last - P.startWeight)}kg</b>{prev != null && <> · 지난 기록보다 <b>{signed(last - prev)}kg</b></>}</>
                : <>시작 체중입니다. 아침 체중을 기록하면 여기가 바뀝니다</>}
            </p>
            <p className="hero-sub">
              이번 주 목표 {target.text}
              {stats.projection != null ? ` · ${md(end)} 예상 ${stats.projection.toFixed(1)}kg` : ' · 5일 기록하면 도착 예상이 나옵니다'}
            </p>
          </section>
          <div className="chart"><Chart series={series} avg={avg} dayIdx={v.ctx.idx} days={P.days} /></div>
          <div className="legend"><span><i />체중</span><span><i className="a" />7일 평균</span><span><i className="b" />목표 범위</span></div>
          <button type="button" className={`${v.weight != null ? 'btn-ghost' : 'btn-primary'} pill`} style={{ marginTop: 16 }} onClick={() => open(<WeightSheet i={v.ctx.idx} />, { focus: '#wh-kg' })}>
            <Icon name="weight" size="sm" />{v.weight != null ? `오늘 체중 고치기 · ${v.weight.toFixed(1)}kg` : '오늘 아침 체중 기록'}
          </button>
          <p className="note" style={{ marginTop: 12 }}>하루 숫자는 물과 소금에 따라 1kg씩 오르내립니다. 7일 평균이 목표 범위 안이면 잘 가고 있는 겁니다.</p>
        </div>
        <div className="col">
          <dl className="trio">
            <div><dt>식단 연속</dt><dd>{st.streak}<small>일</small></dd></div>
            <div><dt>홈트</dt><dd>{st.workouts}<small>회</small></dd></div>
            <div><dt>남은 기간</dt><dd>{daysLeft}<small>일</small></dd></div>
          </dl>
          <section>
            <h2 className="section-title">30일 <span className="muted">{md(start)} ~ {md(end)}</span></h2>
            <Calendar dayIdx={v.ctx.idx} />
            <p className="note" style={{ marginTop: 14 }}>링은 그날 먹음 표시한 끼니 수(5끼 기준)이고, 아래 숫자는 체중입니다. 날짜를 누르면 그날 기록을 고칩니다.</p>
          </section>
        </div>
      </div>
    </>
  );
}
