'use client';
import { addDays, bandFor, DOW, fmt, md, mdw, parseKey, programDate, sgn, weekGoalText, type WeightPoint } from '@diet/core';
import { dayRecord, intakeSeries, intakeSummary, streaks, todayView, weightData, weightInsight, type IntakeDay } from '@diet/data';
import { useEnv, useMedia, usePhone } from '@/lib/hooks';
import { Icon } from '../Icon';
import { PageHead, useOverlay } from '../ui';
import { AccountButton } from '../Settings';
import { DaySheet, WeightSheet } from '../sheets';
import { RecapCard, ShareRecapSheet } from '../WeeklyRecap';

/** Signed one-decimal number with a real minus sign. */
const signed = (x: number) => sgn(x).replace('-', '−');

type ChartSize = { W: number; H: number; phone: boolean };
/** The SVG is drawn at the width it is shown, so labels keep their size: phone (scaled), tablet, desktop. */
function useChartSize(h: { phone: number; mid: number; wide: number }): ChartSize {
  const phone = usePhone();
  const wide = useMedia('(min-width: 1100px)');
  return phone ? { W: 600, H: h.phone, phone } : wide ? { W: 1160, H: h.wide, phone } : { W: 720, H: h.mid, phone };
}

function Chart({ series, trend, dayIdx, days }: { series: WeightPoint[]; trend: WeightPoint[]; dayIdx: number; days: number }) {
  const env = useEnv();
  const { W, H, phone } = useChartSize({ phone: 300, mid: 280, wide: 360 });
  const pl = phone ? 44 : 34, pr = 10, pt = 14, pb = phone ? 36 : 28, xmax = days - 1;
  // the user's own target band; the y range covers the band and every weigh-in
  const tb = bandFor(env.program);
  const ys = [...tb.upper.map((p) => p[1]), ...tb.lower.map((p) => p[1]), ...series.map((p) => p.w)];
  const ymin = Math.floor(Math.min(...ys) - 0.5), ymax = Math.ceil(Math.max(...ys) + 0.5);
  const x = (i: number) => pl + ((W - pl - pr) * i) / xmax;
  const y = (v: number) => pt + ((H - pt - pb) * (ymax - v)) / (ymax - ymin);
  const pts = (arr: [number, number][]) => arr.map((p) => `${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`);
  const band = `M${pts(tb.upper).join(' L')} L${pts([...tb.lower].reverse()).join(' L')} Z`;
  // date ticks: weekly for a month-long program, every two or four weeks for longer ones
  const tickStep = days <= 35 ? 7 : days <= 63 ? 14 : 28;
  const ticks: number[] = [];
  for (let i = 0; i <= xmax; i += tickStep) ticks.push(i);
  const grid: number[] = [];
  const gridStep = ymax - ymin > 14 ? 4 : 2;
  for (let v = Math.ceil(ymin); v <= ymax; v++) if (v % gridStep === 0) grid.push(v);
  // daily weigh-ins small, the smoothed trend large: the line is what to read
  const r = (phone ? 4.2 : W > 1000 ? 3.2 : 2.6) * (series.length > 20 ? 0.8 : 1);
  const lastT = trend[trend.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${days}일 체중 그래프`}>
      <path className="band" d={band} />
      {grid.map((v) => (
        <g key={v}>
          <line className="gl" x1={pl} x2={W - pr} y1={y(v).toFixed(1)} y2={y(v).toFixed(1)} />
          <text className="lb" x={pl - 8} y={(y(v) + 5).toFixed(1)} textAnchor="end">{v}</text>
        </g>
      ))}
      {ticks.map((i) => <text key={i} className="lb" x={x(i).toFixed(1)} y={H - 6} textAnchor="middle">{md(programDate(env.program, i))}</text>)}
      {dayIdx >= 0 && dayIdx <= xmax && <line className="tl" x1={x(dayIdx).toFixed(1)} x2={x(dayIdx).toFixed(1)} y1={pt} y2={H - pb} />}
      {series.map((p) => <circle key={p.i} className="pt" cx={x(p.i).toFixed(1)} cy={y(p.w).toFixed(1)} r={r} />)}
      {trend.length > 1 && <path className="trl" d={`M${trend.map((p) => `${x(p.i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' L')}`} />}
      {lastT && <circle className="trd" cx={x(lastT.i).toFixed(1)} cy={y(lastT.w).toFixed(1)} r={phone ? 8 : 4.5} />}
      {!series.length && <text className="em" x={W / 2} y={(H - pb) / 2} textAnchor="middle">아침 체중을 넣으면 선이 그려집니다</text>}
    </svg>
  );
}

/**
 * Eaten kcal per day against that day's target (the dashed steps). Up to the target the bar is grey; anything
 * above it is drawn in full strength. Today is still open, so its bar is lighter. Days without a log have no bar.
 */
function IntakeChart({ data, dayIdx, days }: { data: IntakeDay[]; dayIdx: number; days: number }) {
  const env = useEnv();
  const { W, H, phone } = useChartSize({ phone: 280, mid: 240, wide: 280 });
  const pl = phone ? 64 : 46, pr = 10, pt = 14, pb = phone ? 36 : 28;
  const top = Math.max(...data.map((d) => Math.max(d.eaten, d.target * 1.2)), env.program.baseKcal * 1.2);
  const ymax = Math.ceil(top / 500) * 500;
  const slot = (W - pl - pr) / days;
  const bw = Math.max(3, Math.min(slot * 0.62, phone ? 26 : 22));
  const x = (i: number) => pl + slot * (i + 0.5);
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / ymax);
  const grid: number[] = [];
  const step = ymax > 3000 ? 1000 : 500;
  for (let v = 0; v <= ymax; v += step) grid.push(v);
  const tickStep = days <= 35 ? 7 : days <= 63 ? 14 : 28;
  const ticks: number[] = [];
  for (let i = 0; i < days; i += tickStep) ticks.push(i);
  // target as steps: one flat piece per day, joined
  const steps = data.map((d) => `M${(x(d.i) - slot / 2).toFixed(1)},${y(d.target).toFixed(1)} H${(x(d.i) + slot / 2).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`하루 먹은 양 그래프, ${data.filter((d) => d.logged).length}일 기록`}>
      {grid.map((v) => (
        <g key={v}>
          <line className="gl" x1={pl} x2={W - pr} y1={y(v).toFixed(1)} y2={y(v).toFixed(1)} />
          <text className="lb" x={pl - 8} y={(y(v) + 5).toFixed(1)} textAnchor="end">{v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : v}</text>
        </g>
      ))}
      {ticks.map((i) => <text key={i} className="lb" x={x(i).toFixed(1)} y={H - 6} textAnchor="middle">{md(programDate(env.program, i))}</text>)}
      {data.filter((d) => d.logged).map((d) => {
        const under = Math.min(d.eaten, d.target);
        const over = Math.max(0, d.eaten - d.target);
        const open = d.i === dayIdx;
        return (
          <g key={d.i} className={open ? 'is-open' : undefined}>
            <title>{`${md(programDate(env.program, d.i))} · ${fmt(d.eaten)}kcal / 목표 ${fmt(d.target)}kcal`}</title>
            <rect className="ib" x={(x(d.i) - bw / 2).toFixed(1)} y={y(under).toFixed(1)} width={bw.toFixed(1)} height={Math.max(1, y(0) - y(under)).toFixed(1)} rx={Math.min(4, bw / 3)} />
            {over > 0 && <rect className="io" x={(x(d.i) - bw / 2).toFixed(1)} y={y(d.eaten).toFixed(1)} width={bw.toFixed(1)} height={Math.max(1, y(d.target) - y(d.eaten)).toFixed(1)} rx={Math.min(4, bw / 3)} />}
          </g>
        );
      })}
      {data.length > 0 && <path className="tg" d={steps} />}
      {!data.some((d) => d.logged) && <text className="em" x={W / 2} y={(H - pb) / 2} textAnchor="middle">끼니를 기록하면 하루 먹은 양이 쌓입니다</text>}
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
    <div className="ringcal" role="group" aria-label={`${env.program.days}일 달력`}>
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

/** Arrival date, real maintenance and the morning's water-weight note, under the chart. */
function Insights() {
  const env = useEnv();
  const w = weightInsight(env);
  const rows: [string, string][] = [];
  if (w.arrivalLine) rows.push(['도착 예정', w.arrivalLine]);
  if (w.maintenance) {
    const m = w.maintenance;
    rows.push(['실제 유지 칼로리', `약 ${fmt(m.kcal)}kcal · 지난 ${m.days}일 동안 평균 ${fmt(m.intake)}kcal를 먹고 주 ${Math.abs(m.ratePerWeek).toFixed(1)}kg ${m.ratePerWeek <= 0 ? '줄었습니다' : '늘었습니다'}`]);
  }
  if (!w.water && !rows.length) return null;
  return (
    <div className="insights">
      {w.water && (
        <section className="water-note sq" aria-label={w.water.title}>
          <h3>{w.water.title}</h3>
          <p>{w.water.body}</p>
        </section>
      )}
      {rows.length > 0 && <dl className="insight-rows">{rows.map(([k, val]) => <div key={k}><dt>{k}</dt><dd>{val}</dd></div>)}</dl>}
    </div>
  );
}

export function Records() {
  const env = useEnv();
  const { open } = useOverlay();
  const v = todayView(env);
  const { series, trend, stats } = weightData(env, v.ctx.idx);
  const st = streaks(env, v.ctx.idx);
  const P = env.program;
  const start = parseKey(P.startDate);
  const end = addDays(start, P.days - 1);
  const last = stats.last;
  const prev = series.length > 1 ? series[series.length - 2]!.w : null;
  const targetText = weekGoalText(P, v.ctx.week);
  const daysLeft = Math.max(0, P.days - v.ctx.no);
  const intake = intakeSeries(env, v.ctx.idx);
  // the open day (today) is not judged yet
  const is = intakeSummary(intake, v.ctx.idx);
  return (
    <>
      <PageHead eyebrow={`기록 · ${v.ctx.no}일째`} title="몸 변화" trailing={<AccountButton className="only-phone" />} />
      <div className="rec-grid">
        <div className="rec-weight">
          <section aria-label="현재 체중">
            <p className={`hero-num${last == null ? ' is-empty' : ''}`}>{(last ?? P.startWeight).toFixed(1)}<small>kg</small></p>
            <p className="hero-delta">
              {last != null
                ? <>시작보다 <b>{signed(last - P.startWeight)}kg</b>{prev != null && <> · 지난 기록보다 <b>{signed(last - prev)}kg</b></>}</>
                : <>시작 체중입니다. 아침 체중을 기록하면 여기가 바뀝니다</>}
            </p>
            <p className="hero-sub">
              이번 주 목표 {targetText}
              {stats.projection != null ? ` · ${md(end)} 예상 ${stats.projection.toFixed(1)}kg` : ' · 5일 기록하면 도착 예상이 나옵니다'}
            </p>
          </section>
          <div className="chart"><Chart series={series} trend={trend} dayIdx={v.ctx.idx} days={P.days} /></div>
          <div className="legend"><span><i />추세</span><span><i className="d" />매일 체중</span><span><i className="b" />목표 범위</span></div>
          <Insights />
          <button type="button" className={`${v.weight != null ? 'btn-ghost' : 'btn-primary'} pill`} style={{ marginTop: 16 }} onClick={() => open(<WeightSheet i={v.ctx.idx} />, { focus: '#wh-kg' })}>
            <Icon name="weight" size="sm" />{v.weight != null ? `오늘 체중 고치기 · ${v.weight.toFixed(1)}kg` : '오늘 아침 체중 기록'}
          </button>
          <p className="note" style={{ marginTop: 12 }}>하루 숫자는 물과 소금에 따라 1kg씩 오르내립니다. 굵은 추세선이 목표 범위 안이면 잘 가고 있는 겁니다.</p>
        </div>
        <section className="rec-intake" aria-labelledby="rec-intake-h">
          <h2 className="section-title" id="rec-intake-h">먹은 양<span className="muted">하루 목표와 비교</span></h2>
          <div className="chart intake"><IntakeChart data={intake} dayIdx={v.ctx.idx} days={P.days} /></div>
          <div className="legend"><span><i className="c" />먹은 양</span><span><i className="o" />목표보다 많이 먹은 만큼</span><span><i className="a" />그날 목표</span></div>
          <p className="note" style={{ marginTop: 12 }}>
            {is.avg != null
              ? `지난 ${is.days}일 평균 ${fmt(is.avg)}kcal · 목표 안에서 끝난 날 ${is.within}일`
              : '하루가 끝나면 평균과 목표 안에서 끝난 날이 나옵니다'}
          </p>
        </section>
        <div className="rec-side">
          <dl className="trio">
            <div><dt>식단 연속</dt><dd>{st.streak}<small>일</small></dd></div>
            <div><dt>홈트</dt><dd>{st.workouts}<small>회</small></dd></div>
            <div><dt>남은 기간</dt><dd>{daysLeft}<small>일</small></dd></div>
          </dl>
          <RecapCard onShare={() => open(<ShareRecapSheet />)} />
          <section>
            <h2 className="section-title">{P.days}일 <span className="muted">{md(start)} ~ {md(end)}</span></h2>
            <Calendar dayIdx={v.ctx.idx} />
            <p className="note" style={{ marginTop: 14 }}>링은 그날 먹음 표시한 끼니 수(5끼 기준)이고, 아래 숫자는 체중입니다. 날짜를 누르면 그날 기록을 고칩니다.</p>
          </section>
        </div>
      </div>
    </>
  );
}
