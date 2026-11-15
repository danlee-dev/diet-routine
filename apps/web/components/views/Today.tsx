'use client';
import { useState } from 'react';
import {
  durText, fmt, hhmm, minutesToCutoff, proteinGap, relText, ROUTINES, SCEN, SKIP_ADVICE, sgn, timeLabel, workoutRounds,
  type MealKey, type RoutineKey,
} from '@diet/core';
import {
  focusNow, importLegacyData, projectedOver, recommendation, remainingKcal, setWake, setWater, skipMeal, timeline, todayView, toggleMeal,
  type Focus, type TimelineItem, type TodayView,
} from '@diet/data';
import { useEnv, useMinuteTick } from '@/lib/hooks';
import { devicePref, readLegacyLocal } from '@/lib/client';
import { Icon } from '../Icon';
import { useOverlay } from '../ui';
import { RulesSheet, StepsSheet, TimeSheet, WeightSheet } from '../sheets';
import { FoodSheet, ScenarioSheet } from '../sheets2';

export interface TodayNav {
  startWorkout: (r: RoutineKey) => void;
  openShop: () => void;
}

// ---------------- pieces ----------------
function useMealActions(v: TodayView) {
  const env = useEnv();
  const { toast, open } = useOverlay();
  return {
    eat: (k: MealKey) => {
      const r = toggleMeal(env, v.ctx.key, k);
      const m = v.meals.find((x) => x.key === k);
      if (r.added) toast(`${m?.name ?? ''} 먹음 표시`, r.undo);
    },
    other: (k: MealKey) => open(<FoodSheet slot={k} />),
    skip: (k: MealKey) => {
      const undo = skipMeal(env, v.ctx.key, k);
      const m = v.meals.find((x) => x.key === k);
      toast(`${m?.name ?? ''} 건너뜀 · 대처법을 흐름에 적었습니다`, undo);
    },
  };
}

function Header({ v }: { v: TodayView }) {
  const env = useEnv();
  const { open } = useOverlay();
  const sc = SCEN[v.scen];
  const left = remainingKcal(env, v);
  const over = projectedOver(env, v);
  return (
    <header className="t-head">
      <span className="eyebrow">{v.ctx.label} · {v.ctx.week}주차 {v.ctx.no}일째</span>
      <div className="t-row">
        <h1 className="t-title">오늘</h1>
        <button type="button" className="scen-btn" onClick={() => open(<ScenarioSheet />)} aria-label={`오늘 상황: ${sc.name}. 바꾸기`}>
          <Icon name={sc.icon} />{sc.name}<Icon name="chevron-right" />
        </button>
      </div>
      <div className="kline">
        <span><b>{fmt(v.sum.eaten)}</b> / {fmt(left + v.sum.eaten)} kcal · 단백질 {v.sum.eatenProtein}/{v.sum.totalProtein}g{over > 0 ? ` · 계획대로면 +${fmt(over)}` : ''}</span>
        <span className="left">{left >= 0 ? <>남은 <b>{fmt(left)}</b></> : <>초과 <b>{fmt(-left)}</b></>}</span>
      </div>
      <div className="segs" aria-hidden="true">{v.meals.map((m) => <span key={m.key} className={v.eaten.has(m.key) && !v.skipped.has(m.key) ? 'on' : ''} />)}</div>
    </header>
  );
}

function FocusCard({ f, v, nav }: { f: Focus; v: TodayView; nav: TodayNav }) {
  const env = useEnv();
  const { open, toast } = useOverlay();
  const act = useMealActions(v);
  const orb = <div className="now-orb" aria-hidden="true" />;

  if (f.kind === 'wake') {
    return (
      <section className="focus sq swap-in" aria-label="지금 할 일">
        {orb}
        <p className="focus-k">좋은 아침이에요</p>
        <h2 className="focus-t">일어났나요?</h2>
        <p className="focus-meta">일어난 시간에 맞춰 끼니 시간을 정하고, 저녁은 8시 전에 끝나게 맞춥니다.</p>
        <div className="focus-acts">
          <button type="button" className="btn-primary pill" onClick={() => {
            const n = env.now();
            const mins = n.getHours() * 60 + n.getMinutes();
            setWake(env, mins, { lateRule: true });
            toast(`기상 ${hhmm(mins)} · 끼니 시간을 맞췄습니다`);
          }}><Icon name="sunrise" />지금 일어났어요</button>
          <button type="button" className="btn-ghost pill" onClick={() => open(<TimeSheet />, { focus: '#wh-h' })}>시간 고르기</button>
        </div>
      </section>
    );
  }
  if (f.kind === 'workout') {
    const r = ROUTINES[f.routine];
    return (
      <section className="focus sq swap-in" aria-label="지금 할 일">
        {orb}
        <p className="focus-k">홈트 시간 · {hhmm(f.at)}쯤</p>
        <h2 className="focus-t">{r.name}</h2>
        <p className="focus-rel">{r.focus} · {workoutRounds(v.ctx.week)}라운드 · 약 25분</p>
        <ul className="focus-items">{r.items.map((x) => <li key={x.name}><span>{x.name}</span><span className="amt">{x.n}{x.unit}</span></li>)}</ul>
        <div className="focus-acts">
          <button type="button" className="btn-primary pill" onClick={() => nav.startWorkout(f.routine)}><Icon name="play" />따라하기 시작</button>
        </div>
        <p className="focus-meta">끝나면 운동 후 프로틴을 바로 표시할 수 있습니다.</p>
      </section>
    );
  }
  if (f.kind === 'cutoff') {
    return (
      <section className="focus sq swap-in" aria-label="지금 할 일">
        {orb}
        <p className="focus-k">저녁 마감 20:00 지남</p>
        <h2 className="focus-t">오늘은 물만 마셔요</h2>
        <p className="focus-meta">저녁을 먹었다면 표시하고, 못 먹었다면 건너뛰기로 남겨 두세요. {SKIP_ADVICE.dinner}</p>
        <div className="focus-acts">
          <button type="button" className="btn-primary pill" onClick={() => act.eat('dinner')}><Icon name="check" />저녁 먹었어요</button>
          <button type="button" className="btn-ghost pill" onClick={() => act.other('dinner')}>다르게 먹었어요</button>
          <button type="button" className="btn-ghost pill" onClick={() => act.skip('dinner')}>건너뛰기</button>
        </div>
      </section>
    );
  }
  if (f.kind === 'done') {
    const gap = proteinGap(v.sum.eatenProtein, env.program.proteinFloor);
    return (
      <section className="focus done sq swap-in" aria-label="오늘 정리">
        {orb}
        <p className="focus-k">오늘 끝</p>
        <h2 className="focus-t">{fmt(v.sum.eaten)}kcal 먹었어요</h2>
        <p className="focus-rel">단백질 {v.sum.eatenProtein}g{gap ? ` · 목표보다 ${gap}g 적음` : ' · 목표 채움'}</p>
        <p className="focus-meta">이제부터는 물, 아메리카노, 제로 음료만 마십니다. {minutesToCutoff(v.nowMin) > 0 ? `마감까지 ${durText(minutesToCutoff(v.nowMin))}.` : ''}</p>
      </section>
    );
  }
  const m = f.meal;
  return (
    <section key={m.key} className="focus sq swap-in" aria-label="지금 할 일">
      {orb}
      <p className="focus-k">지금 먹을 것 · {timeLabel(m)}</p>
      <h2 className="focus-t">{m.name}</h2>
      {m.at != null && <p className="focus-rel">{relText(m.at, v.nowMin)}</p>}
      <ul className="focus-items">{m.items.map((x) => <li key={x.name}><span>{x.name}</span><span className="amt">{x.amount}</span></li>)}</ul>
      <div className="focus-acts">
        <button type="button" className="btn-primary pill" onClick={() => act.eat(m.key)}><Icon name="check" />먹었어요</button>
        <button type="button" className="btn-ghost pill" onClick={() => act.other(m.key)}>다르게 먹었어요</button>
        <button type="button" className="btn-ghost pill" onClick={() => act.skip(m.key)}>건너뛰기</button>
      </div>
      <p className="focus-meta">{m.est ? '약 ' : ''}{fmt(m.kcal)}kcal · 단백질 {m.protein}g{m.hint ? ` · ${m.hint}` : ''}</p>
    </section>
  );
}

function QuickLog({ v }: { v: TodayView }) {
  const env = useEnv();
  const { open, toast } = useOverlay();
  const pct = Math.min(100, Math.round((v.day.steps / v.stepsGoal) * 100));
  return (
    <div className="qlog" role="group" aria-label="빠른 기록">
      <button type="button" className="qpill sq" onClick={() => open(<WeightSheet i={v.ctx.idx} />, { focus: '#wh-kg' })}>
        <span className="k"><Icon name="weight" />체중</span>
        {v.weight != null
          ? <span className="v">{v.weight.toFixed(1)}<small>kg {v.prevWeight != null ? sgn(v.weight - v.prevWeight) : ''}</small></span>
          : <span className="v empty">기록하기</span>}
      </button>
      <button type="button" className="qpill sq" aria-label={`물 ${v.day.water_cups}잔. 누르면 한 잔 추가`} onClick={() => {
        const before = v.day.water_cups;
        setWater(env, v.ctx.key, before + 1);
        toast(`물 ${Math.min(8, before + 1)}잔`, () => setWater(env, v.ctx.key, before));
      }}>
        <span className="k"><Icon name="glass-water" />물 +1</span>
        <span className="v">{v.day.water_cups}<small>/ 8잔</small></span>
        <span className="mbar"><i style={{ width: `${(v.day.water_cups / 8) * 100}%` }} /></span>
      </button>
      <button type="button" className="qpill sq" onClick={() => open(<StepsSheet />)}>
        <span className="k"><Icon name="footprints" />걸음</span>
        <span className="v">{fmt(v.day.steps)}<small>/ {fmt(v.stepsGoal)}</small></span>
        <span className="mbar"><i style={{ width: `${pct}%` }} /></span>
      </button>
    </div>
  );
}

function Reco({ v, nav }: { v: TodayView; nav: TodayNav }) {
  const env = useEnv();
  const { open, toast } = useOverlay();
  const r = recommendation(env, v);
  const run = () => {
    const a = r.action;
    if (!a) return;
    if (a.kind === 'order') { if (a.url) window.open(a.url, '_blank', 'noopener'); else nav.openShop(); }
    else if (a.kind === 'steps') open(<StepsSheet />);
    else if (a.kind === 'water') { const b = v.day.water_cups; setWater(env, v.ctx.key, b + 1); toast(`물 ${b + 1}잔`, () => setWater(env, v.ctx.key, b)); }
    else open(<RulesSheet id={v.scen} />);
  };
  return (
    <div className="reco sq">
      <span className="ic"><Icon name={r.icon} /></span>
      <span className="tx"><b>{r.title}</b><span>{r.body}</span></span>
      {r.action && <button type="button" className="go" onClick={run}>{r.action.label}{r.action.kind === 'order' && r.action.url ? <Icon name="arrow-up-right" /> : <Icon name="chevron-right" />}</button>}
    </div>
  );
}

function TimelineRow({ it, v, nav, openId, setOpenId }: { it: TimelineItem; v: TodayView; nav: TodayNav; openId: string | null; setOpenId: (id: string | null) => void }) {
  const { open } = useOverlay();
  const act = useMealActions(v);
  const env = useEnv();
  const expanded = openId === it.id;
  const time = it.at != null ? hhmm(it.at) : '';
  const tag = it.state === 'late' ? '지남' : it.state === 'skipped' ? '건너뜀' : it.state === 'next' ? '다음' : null;
  const m = it.meal;
  const kcal = it.entries?.length ? it.entries.reduce((a, e) => a + e.kcal, 0) : m?.kcal;
  const onMain = () => {
    if (it.kind === 'wake') { open(<TimeSheet />, { focus: '#wh-h' }); return; }
    if (it.kind === 'meal') setOpenId(expanded ? null : it.id);
  };
  return (
    <li className={`tl-item ${it.state} k-${it.kind}`}>
      <span className="tl-time">{time}</span>
      <span className="tl-dot" aria-hidden="true" />
      <button type="button" className="tl-main" onClick={onMain} aria-expanded={it.kind === 'meal' ? expanded : undefined}>
        <span className="h"><b>{it.title}</b>{tag && <span className="tag">{tag}</span>}</span>
        <span className="s">{it.sub}</span>
      </button>
      <span className="tl-side">
        {it.kind === 'meal' && m && (
          <>
            <span className="kc">{fmt(kcal ?? 0)}<small>kcal</small></span>
            <button type="button" className={`check${it.state === 'skipped' ? ' undo' : ''}`} aria-pressed={it.state === 'done'} aria-label={it.state === 'skipped' ? `${it.title} 건너뜀 취소` : `${it.title} 먹음 표시`} onClick={() => (it.state === 'skipped' ? toggleMeal(env, v.ctx.key, m.key) : act.eat(m.key))}>
              <Icon name={it.state === 'skipped' ? 'rotate-ccw' : 'check'} />
            </button>
          </>
        )}
        {it.kind === 'workout' && it.routine && it.state !== 'done' && <button type="button" className="go2" onClick={() => nav.startWorkout(it.routine!)}><Icon name="play" />시작</button>}
        {it.kind === 'workout' && it.state === 'done' && <span className="done-tag"><Icon name="check" />완료</span>}
        {it.kind === 'wake' && it.state !== 'done' && <button type="button" className="go2" onClick={() => open(<TimeSheet />, { focus: '#wh-h' })}>기록</button>}
      </span>
      {expanded && m && (
        <div className="tl-detail sq">
          <ul>{m.items.map((x) => <li key={x.name}><span>{x.name}</span><span className="amt">{x.amount}</span></li>)}</ul>
          {m.swaps[0] && <p className="swap"><Icon name="arrow-left-right" /><span>{m.swaps[0]}</span></p>}
          <div className="row">
            {it.state === 'done' || it.state === 'skipped'
              ? <button type="button" className="btn-ghost pill" onClick={() => { toggleMeal(env, v.ctx.key, m.key); setOpenId(null); }}><Icon name="rotate-ccw" />기록 취소</button>
              : <>
                  <button type="button" className="btn-ghost pill" onClick={() => act.other(m.key)}>다르게 먹었어요</button>
                  <button type="button" className="btn-ghost pill" onClick={() => { act.skip(m.key); setOpenId(null); }}>건너뛰기</button>
                </>}
          </div>
        </div>
      )}
    </li>
  );
}

function Ruler({ items, v }: { items: TimelineItem[]; v: TodayView }) {
  const start = Math.floor(Math.min(v.day.wake_min ?? 8 * 60, 8 * 60) / 60) * 60;
  const end = 21 * 60;
  const pos = (m: number) => `${Math.max(0, Math.min(100, ((m - start) / (end - start)) * 100)).toFixed(2)}%`;
  // one marker per time: items at the same minute share it ("간식·프로틴")
  const marks: { id: string; at: number; label: string; state: TimelineItem['state'] }[] = [];
  const rank = { next: 4, late: 3, upcoming: 2, done: 1, skipped: 0 } as const;
  for (const x of items) {
    if (x.at == null || x.state === 'skipped') continue;
    const label = x.kind === 'cutoff' ? '마감' : x.title.replace(/ \(.+\)$/, '');
    const same = marks.find((m) => Math.abs(m.at - x.at!) < 15);
    if (same) { same.label += `·${label}`; if (rank[x.state] > rank[same.state]) same.state = x.state; }
    else marks.push({ id: x.id, at: x.at, label, state: x.state });
  }
  const nowIn = v.nowMin >= start && v.nowMin <= end;
  return (
    <div className="ruler" aria-hidden="true">
      <div className="track" />
      {nowIn && <div className="past" style={{ width: pos(v.nowMin) }} />}
      {marks.map((x) => (
        <div key={x.id} className={`mk ${x.state}`} style={{ left: pos(x.at) }}>
          <span className="n">{x.label}</span>
          <span className="d" />
          <span className="tm">{hhmm(x.at)}</span>
        </div>
      ))}
      {nowIn && <div className="nowline" style={{ left: pos(v.nowMin) }} />}
    </div>
  );
}

function LegacyBanner() {
  const env = useEnv();
  const { toast } = useOverlay();
  // App renders only in the browser, so reading localStorage in the initializer is safe.
  const [data, setData] = useState<Record<string, unknown> | null>(() => (devicePref.get('legacyImported', false) ? null : readLegacyLocal()));
  if (!data) return null;
  return (
    <div className="reco sq" style={{ marginTop: 0, marginBottom: 12 }}>
      <span className="ic"><Icon name="clipboard-paste" /></span>
      <span className="tx"><b>예전 사이트 기록이 남아 있어요</b><span>옮기면 폰 앱과 같이 봅니다</span></span>
      <button type="button" className="go" onClick={() => { const c = importLegacyData(env, data); devicePref.set('legacyImported', true); setData(null); toast(`${c.days}일치 기록을 옮겼습니다`); }}>옮기기</button>
    </div>
  );
}

// ---------------- page ----------------
export function Today({ nav }: { nav: TodayNav }) {
  const env = useEnv();
  useMinuteTick();
  const v = todayView(env);
  const f = focusNow(env, v);
  const items = timeline(env, v);
  const [openId, setOpenId] = useState<string | null>(null);
  const sc = SCEN[v.scen];
  return (
    <>
      <Header v={v} />
      <Ruler items={items} v={v} />
      <div className="t-grid">
        <div className="t-main">
          <LegacyBanner />
          <FocusCard f={f} v={v} nav={nav} />
          <div className="only-phone">
            <QuickLog v={v} />
            <Reco v={v} nav={nav} />
          </div>
          <h2 className="section-title">오늘 흐름</h2>
          <ul className="tl">
            {items.map((it) => <TimelineRow key={it.id} it={it} v={v} nav={nav} openId={openId} setOpenId={setOpenId} />)}
          </ul>
        </div>
        <aside className="t-aside only-wide" aria-label="오늘 숫자와 추천">
          <QuickLog v={v} />
          <Reco v={v} nav={nav} />
          <div className="box sq">
            <div className="card-head" style={{ marginBottom: 12 }}>
              <span className="tile sq" style={{ background: 'var(--bg)' }}><Icon name={sc.icon} /></span>
              <div><h3 style={{ fontSize: 16, fontWeight: 600 }}>{sc.name}</h3><p style={{ fontSize: 13, color: 'var(--muted)' }}>{sc.short}</p></div>
            </div>
            <ul className="rules dots">{sc.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        </aside>
      </div>
    </>
  );
}
