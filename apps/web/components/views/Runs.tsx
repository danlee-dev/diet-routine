'use client';
// 운동 › 달리기: every run saved on the iPhone, a big map and km splits for one, and all routes on one map.
import { useMemo, useState } from 'react';
import {
  clockText, DOW, estimateRunSteps, fastestSplit, fmt, haversine, keyOf, kmText, paceText, projectRoutes, runKcalCredit, type RunRow, type Split,
} from '@diet/core';
import { deleteRun, runCreditRatio, runDate, runSegments, runsList, runTotals } from '@diet/data';
import { useEnv, useMedia, usePhone } from '@/lib/hooks';
import { Icon } from '../Icon';
import { PageHead, useOverlay } from '../ui';
import { AccountButton } from '../Settings';
import { RouteMap } from '../run/RouteMap';

const partOfDay = (h: number): string => (h < 5 ? '새벽' : h < 11 ? '아침' : h < 14 ? '점심' : h < 18 ? '오후' : h < 22 ? '저녁' : '밤');
/** "토요일 저녁 달리기" (same words as the iPhone) */
export const runTitle = (r: Pick<RunRow, 'started_at' | 'kind'>): string => {
  const d = new Date(r.started_at);
  return `${DOW[d.getDay()]}요일 ${partOfDay(d.getHours())} ${r.kind === 'walk' ? '걷기' : '달리기'}`;
};
/** "11월 15일 · 19:02" */
export const runWhen = (r: Pick<RunRow, 'started_at'>): string => {
  const d = new Date(r.started_at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const areaText = (m2: number) => (m2 >= 100_000 ? `${(m2 / 1_000_000).toFixed(2)}km²` : `${fmt(Math.round(m2))}m²`);

let gradSeq = 0;
/** Small route drawing for the list; the line carries the brand gradient. */
function RouteThumb({ routes }: { routes: ReturnType<typeof runSegments> }) {
  const [id] = useState(() => `rg${++gradSeq}`);
  const pr = useMemo(() => projectRoutes(routes, 56, 56, 6), [routes]);
  return (
    <svg className="run-thumb sq" viewBox="0 0 56 56" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--orb1)" /><stop offset="1" stopColor="var(--orb2)" /></linearGradient>
      </defs>
      {pr.paths.map((d, i) => <path key={i} d={d} fill="none" stroke={`url(#${id})`} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
  );
}

/**
 * km splits as columns: taller is faster. The fastest stands out by full strength and its label, not by colour.
 * The dashed line is the average pace.
 */
function SplitsChart({ splits, avg }: { splits: Split[]; avg: number | null }) {
  const phone = usePhone();
  const fast = splits.filter((x) => x.m >= 1000).length >= 2 ? fastestSplit(splits) : -1;
  const speeds = splits.map((s) => (s.pace > 0 ? 1000 / s.pace : 0));
  const top = Math.max(...speeds, 1e-9);
  const low = Math.min(...speeds.filter((x) => x > 0), top) * 0.7;
  const n = splits.length;
  // drawn at the width it is shown (phone 360, wider 720) so labels keep their size; many splits scroll sideways
  const gap = phone ? 6 : 10, H = phone ? 170 : 200, pt = 26, pb = 26;
  const base = phone ? 340 : 720;
  const colW = Math.max(12, Math.min(56, (base - gap * (n + 1)) / n));
  const W = Math.max(base, n * (colW + gap) + gap);
  const y = (v: number) => pt + (H - pt - pb) * (1 - (v - low) / Math.max(top - low, 1e-9));
  const every = n > 24 ? 5 : n > 12 ? 2 : 1;
  const avgY = avg && avg > 0 ? y(1000 / avg) : null;
  return (
    <div className="splits-scroll">
      <svg className="splits" viewBox={`0 0 ${W} ${H}`} style={{ minWidth: W > base ? W : undefined }} role="img" aria-label={`구간 ${n}개 페이스 그래프`}>
        {splits.map((s, i) => {
          const x = gap + i * (colW + gap);
          const top_ = y(speeds[i]!);
          const isFast = i === fast;
          const km = s.m < 1000 ? (s.m / 1000).toFixed(2) : String(s.km);
          return (
            <g key={s.km} className={isFast ? 'is-fast' : undefined}>
              <title>{`${km}km 구간 · ${paceText(s.pace)}${isFast ? ' · 가장 빠름' : ''}`}</title>
              <rect className="bar" x={x} y={top_} width={colW} height={Math.max(4, H - pb - top_)} rx="7" />
              {isFast && <text className="pace" x={x + colW / 2} y={top_ - 8} textAnchor="middle">{paceText(s.pace)}</text>}
              {(i % every === 0 || i === n - 1) && <text className="km" x={x + colW / 2} y={H - 8} textAnchor="middle">{km}</text>}
            </g>
          );
        })}
        {avgY != null && <line className="avg" x1={gap / 2} x2={W - gap / 2} y1={avgY} y2={avgY} />}
      </svg>
    </div>
  );
}

function RunDetail({ run, onBack, onDeleted }: { run: RunRow; onBack?: () => void; onDeleted: () => void }) {
  const env = useEnv();
  const { toast } = useOverlay();
  const segments = useMemo(() => runSegments(run), [run]);
  const splits = run.splits ?? [];
  const ratio = runCreditRatio(env);
  const credit = runKcalCredit(run.kcal, ratio);
  const today = runDate(run) === keyOf(env.now());
  const cells: [string, string][] = [
    ['시간', clockText(run.moving_s)],
    ['평균 페이스', paceText(run.avg_pace_s_per_km)],
    ['활동 칼로리', `${fmt(Math.round(Number(run.kcal) || 0))}kcal`],
    ['걸음 (추정)', fmt(estimateRunSteps(splits, env.program.heightCm))],
  ];
  if (run.elev_gain_m != null) cells.push(['오른 높이', `${Math.round(Number(run.elev_gain_m))}m`]);
  if (run.new_distance_m != null) cells.push(['처음 달린 길', `${kmText(Number(run.new_distance_m))}km`]);
  if (run.elapsed_s - run.moving_s >= 60) cells.push(['멈춘 시간', clockText(run.elapsed_s - run.moving_s)]);
  const fast = splits.filter((x) => x.m >= 1000).length >= 2 ? splits[fastestSplit(splits)] : undefined;
  return (
    <article className="run-detail" aria-label={runTitle(run)}>
      {onBack && <button type="button" className="link-btn back" onClick={onBack}><Icon name="chevron-left" size="sm" />목록</button>}
      {segments.some((g) => g.length > 1)
        ? <RouteMap routes={segments} className="sq big" label={`${runTitle(run)} 경로 지도`} />
        : <div className="route-map big sq is-empty"><span>경로 없이 저장된 기록입니다</span></div>}
      <div className="run-head">
        <p className="eyebrow">{runWhen(run)}</p>
        <h2 className="run-t">{runTitle(run)}</h2>
        <p className="run-km num">{kmText(Number(run.distance_m))}<small>km</small></p>
      </div>
      <dl className="run-cells">
        {cells.map(([k, v]) => <div key={k}><dt>{k}</dt><dd className="num">{v}</dd></div>)}
      </dl>
      {credit > 0 && (
        <p className="run-credit">
          <b>{today ? `오늘 먹을 수 있는 양이 ${fmt(credit)}kcal 늘었습니다` : `${runWhen(run).split(' · ')[0]} 식단에 ${fmt(credit)}kcal를 더했습니다`}</b>
          <span>소모한 {fmt(Math.round(Number(run.kcal) || 0))}kcal의 {ratio === 0.5 ? '절반' : `${Math.round(ratio * 100)}%`}만 더하고, 나머지는 감량으로 남깁니다.</span>
        </p>
      )}
      {splits.length > 0 && (
        <section className="run-splits">
          <h3 className="section-title">구간<span className="muted">{fast ? `가장 빠른 구간 ${fast.km}km · ${paceText(fast.pace)}` : `${splits.length}개`}</span></h3>
          <SplitsChart splits={splits} avg={run.avg_pace_s_per_km} />
          <p className="note">막대가 높을수록 빠릅니다. 점선은 평균 페이스 {paceText(run.avg_pace_s_per_km)}입니다.</p>
        </section>
      )}
      <button
        type="button"
        className="link-btn quiet"
        style={{ marginTop: 18 }}
        onClick={() => { const undo = deleteRun(env, run.id); toast('기록을 지웠습니다', undo); onDeleted(); }}
      >
        기록 지우기
      </button>
    </article>
  );
}

function MyMap({ runs, onBack }: { runs: RunRow[]; onBack?: () => void }) {
  const routes = useMemo(() => runs.flatMap(runSegments).filter((r) => r.length > 1), [runs]);
  const t = runTotals(runs);
  const days = new Set(runs.map((r) => runDate(r))).size;
  return (
    <article className="run-detail" aria-label="내가 달린 길">
      {onBack && <button type="button" className="link-btn back" onClick={onBack}><Icon name="chevron-left" size="sm" />목록</button>}
      <RouteMap routes={routes} markEnds={false} lineWidth={3.5} className="sq big" label="지금까지 달린 모든 경로" />
      <div className="run-head">
        <p className="eyebrow">내가 달린 길</p>
        <p className="run-km num">{kmText(t.distance_m)}<small>km</small></p>
        <p className="run-sum">
          {days}일 동안 {t.count}번 달렸습니다 · 처음 달린 길 {kmText(t.new_m)}km{t.area_m2 > 0 ? ` · 한 바퀴로 둘러싼 땅 ${areaText(t.area_m2)}` : ''}
        </p>
      </div>
      <dl className="run-cells">
        <div><dt>달린 시간</dt><dd className="num">{clockText(t.moving_s)}</dd></div>
        <div><dt>활동 칼로리</dt><dd className="num">{fmt(Math.round(t.kcal))}kcal</dd></div>
      </dl>
    </article>
  );
}

export function Runs() {
  const env = useEnv();
  const runs = runsList(env);
  const wide = useMedia('(min-width: 1024px)');
  const [selPref, setSel] = useState<string | null>(null);
  // wide: something is always open (the latest run); narrow: the list until a row is chosen
  const sel = selPref === 'map' || runs.some((r) => r.id === selPref) ? selPref : wide ? (runs[0]?.id ?? null) : null;
  const run = runs.find((r) => r.id === sel);
  const head = <PageHead eyebrow="운동" title="달리기" trailing={<AccountButton className="only-phone" />} />;

  if (!runs.length) {
    return (
      <>
        {head}
        <section className="card sq runs-empty" aria-label="달리기 기록 없음">
          <p className="card-k">아직 기록이 없습니다</p>
          <h2 className="card-t">아이폰에서 달리면 여기에 쌓입니다</h2>
          <p className="card-sub">앱의 운동 탭에서 달리기를 시작하면 경로, km 구간, 칼로리가 저장되고 이 화면의 큰 지도로 볼 수 있습니다.</p>
        </section>
      </>
    );
  }

  const t = runTotals(runs);
  // the list thumbnail: routes around the latest run (all of them would shrink to dots across a city)
  const home = runSegments(runs[0]!).flat()[0];
  const allRoutes = runs.flatMap(runSegments).filter((r) => !home || !r[0] || haversine(home, r[0]) < 5000);
  const list = (
    <div className="run-list" role="list" aria-label="달리기 기록">
      <button type="button" role="listitem" className={`run-row${sel === 'map' ? ' is-on' : ''}`} aria-current={sel === 'map' ? 'true' : undefined} onClick={() => setSel('map')}>
        <RouteThumb routes={allRoutes} />
        <span className="tx"><b>내가 달린 길</b><span>{t.count}번 · 모든 경로를 한 지도에</span></span>
        <span className="r num">{kmText(t.distance_m)}<small>km</small></span>
      </button>
      {runs.map((r) => (
        <button key={r.id} type="button" role="listitem" className={`run-row${sel === r.id ? ' is-on' : ''}`} aria-current={sel === r.id ? 'true' : undefined} onClick={() => setSel(r.id)}>
          <RouteThumb routes={runSegments(r)} />
          <span className="tx"><b>{runTitle(r)}</b><span>{runWhen(r)} · {clockText(r.moving_s)} · {paceText(r.avg_pace_s_per_km)}</span></span>
          <span className="r num">{kmText(Number(r.distance_m))}<small>km</small></span>
        </button>
      ))}
    </div>
  );
  const detail = sel === 'map'
    ? <MyMap runs={runs} onBack={wide ? undefined : () => setSel(null)} />
    : run ? <RunDetail key={run.id} run={run} onBack={wide ? undefined : () => setSel(null)} onDeleted={() => setSel(null)} /> : null;

  return (
    <>
      {head}
      {wide
        ? <div className="runs-grid">{list}<div className="runs-main">{detail}</div></div>
        : detail ?? list}
    </>
  );
}
