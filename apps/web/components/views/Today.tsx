'use client';
import { useState } from 'react';
import {
  durText, fmt, hhmm, MEALS, minutesToCutoff, proteinGap, relText, SCEN, SKIP_ADVICE, sgn, timeLabel, workoutRounds,
  type MealKey, type RoutineKey,
} from '@diet/core';
import {
  applyRebalance, focusNow, importLegacyData, overCauses, rainSuggestion, rebalanceToday, rebalanceWorthShowing, recommendation, remainingKcal, setWake, setWater,
  skipMeal, swapWalkForWorkout, timeline, todayView, toggleMeal,
  type Focus, type TimelineItem, type TodayView,
} from '@diet/data';
import { useAuth, useEnv, useMinuteTick } from '@/lib/hooks';
import { devicePref, getSupabase, readLegacyLocal } from '@/lib/client';
import { useForecast } from '@/lib/weather';
import { Icon } from '../Icon';
import { PageHead, useOverlay } from '../ui';
import { RulesSheet, StepsSheet, TimeSheet, WeightSheet } from '../sheets';
import { FoodSheet, ScenarioSheet } from '../sheets2';
import { AccountButton, SettingsSheet } from '../Settings';
import { MealEditSheet } from '../PlanSheets';

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
    partial: (k: MealKey) => open(<FoodSheet slot={k} mode="partial" />),
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
  return (
    <PageHead eyebrow={`${v.ctx.label} · ${v.ctx.week}주차 ${v.ctx.no}일째`} title="오늘" trailing={<AccountButton className="only-phone" />}>
      <button type="button" className="scen-link" onClick={() => open(<ScenarioSheet />)} aria-label={`오늘 상황: ${sc.name}. 바꾸기`}>
        <Icon name={sc.icon} size="sm" />{sc.name}<Icon name="chevron-down" size="sm" />
      </button>
      <div className="kline">
        <span className="left">{left >= 0 ? <><b>{fmt(left)}</b>kcal 남음</> : <><b>{fmt(-left)}</b>kcal 초과</>}</span>
        <span className="of">
          먹은 {fmt(v.sum.eaten)} / {fmt(left + v.sum.eaten)} · 단백질 {v.sum.eatenProtein}/{v.sum.totalProtein}g
        </span>
      </div>
      <div className="segs" aria-hidden="true">{v.meals.map((m) => <span key={m.key} className={v.eaten.has(m.key) && !v.skipped.has(m.key) ? 'on' : ''} />)}</div>
    </PageHead>
  );
}

function FocusCard({ f, v, nav }: { f: Focus; v: TodayView; nav: TodayNav }) {
  const env = useEnv();
  const { open, toast } = useOverlay();
  const act = useMealActions(v);

  if (f.kind === 'wake') {
    return (
      <section className="card focus sq swap-in" aria-label="지금 할 일">
        <p className="card-k">좋은 아침이에요</p>
        <h2 className="card-t">일어났나요?</h2>
        <p className="card-sub">일어난 시간에 맞춰 끼니 시간을 정하고, 저녁은 8시 전에 끝나게 맞춥니다.</p>
        <div className="card-acts">
          <button type="button" className="btn-primary pill" onClick={() => {
            const n = env.now();
            const mins = n.getHours() * 60 + n.getMinutes();
            setWake(env, mins, { lateRule: true });
            toast(`기상 ${hhmm(mins)} · 끼니 시간을 맞췄습니다`);
          }}><Icon name="sunrise" size="sm" />지금 일어났어요</button>
          <button type="button" className="btn-ghost pill" onClick={() => open(<TimeSheet />, { focus: '#wh-h' })}>시간 고르기</button>
        </div>
      </section>
    );
  }
  if (f.kind === 'workout') {
    const r = v.routines[f.routine];
    return (
      <section className="card focus sq swap-in" aria-label="지금 할 일">
        <p className="card-k">홈트 시간 · {hhmm(f.at)}쯤</p>
        <h2 className="card-t">{r.name}</h2>
        <p className="card-rel">{r.focus} · {workoutRounds(v.ctx.week)}라운드 · 약 25분</p>
        <ul className="kv-list compact">{r.items.map((x) => <li key={x.name}><span>{x.name}</span><span className="num">{x.n}{x.unit}</span></li>)}</ul>
        <div className="card-acts">
          <button type="button" className="btn-primary pill" onClick={() => nav.startWorkout(f.routine)}><Icon name="play" size="sm" />따라하기 시작</button>
        </div>
        <p className="card-meta">끝나면 운동 후 프로틴을 바로 표시할 수 있습니다.</p>
      </section>
    );
  }
  if (f.kind === 'cutoff') {
    return (
      <section className="card focus sq swap-in" aria-label="지금 할 일">
        <p className="card-k">저녁 마감 20:00 지남</p>
        <h2 className="card-t">오늘은 물만 마셔요</h2>
        <p className="card-sub">저녁을 먹었다면 표시하고, 못 먹었다면 건너뛰기로 남겨 둡니다. {SKIP_ADVICE.dinner}</p>
        <div className="card-acts">
          <button type="button" className="btn-primary pill" onClick={() => act.eat('dinner')}><Icon name="check" size="sm" />저녁 먹었어요</button>
          <button type="button" className="btn-ghost pill" onClick={() => act.other('dinner')}>다르게 먹었어요</button>
          <button type="button" className="link-btn quiet" onClick={() => act.skip('dinner')}>건너뛰기</button>
        </div>
      </section>
    );
  }
  if (f.kind === 'done') {
    const gap = proteinGap(v.sum.eatenProtein, env.program.proteinFloor);
    return (
      <section className="card focus sq swap-in" aria-label="오늘 정리">
        <p className="card-k">오늘 끝</p>
        <h2 className="card-t">{fmt(v.sum.eaten)}kcal 먹었어요</h2>
        <p className="card-rel">단백질 {v.sum.eatenProtein}g{gap ? ` · 목표보다 ${gap}g 적음` : ' · 목표 채움'}</p>
        <p className="card-sub">이제부터는 물, 아메리카노, 제로 음료만 마십니다. {minutesToCutoff(v.nowMin) > 0 ? `마감까지 ${durText(minutesToCutoff(v.nowMin))}.` : ''}</p>
      </section>
    );
  }
  const m = f.meal;
  return (
    <section key={m.key} className="card focus sq swap-in" aria-label="지금 할 일">
      <p className="card-k">지금 먹을 것 · {timeLabel(m)}</p>
      <h2 className="card-t">{m.name}</h2>
      {m.at != null && <p className="card-rel">{relText(m.at, v.nowMin)}</p>}
      <ul className="kv-list compact">{m.items.map((x) => <li key={x.name}><span>{x.name}</span><span>{x.amount}</span></li>)}</ul>
      <div className="card-acts">
        <button type="button" className="btn-primary pill" onClick={() => act.eat(m.key)}><Icon name="check" size="sm" />먹었어요</button>
        <button type="button" className="btn-ghost pill" onClick={() => act.other(m.key)}>다르게 먹었어요</button>
        <button type="button" className="link-btn quiet" onClick={() => act.skip(m.key)}>건너뛰기</button>
      </div>
      <p className="card-meta">{m.est ? '약 ' : ''}{fmt(m.kcal)}kcal · 단백질 {m.protein}g{m.hint ? ` · ${m.hint}` : ''}</p>
    </section>
  );
}

/** Weight, water and steps as three numbers. Water adds a cup on tap; the others open their pickers. */
function QuickLog({ v }: { v: TodayView }) {
  const env = useEnv();
  const { open, toast } = useOverlay();
  return (
    <div className="qlog" role="group" aria-label="빠른 기록">
      <button type="button" className="q" onClick={() => open(<WeightSheet i={v.ctx.idx} />, { focus: '#wh-kg' })}>
        <span className="k"><Icon name="weight" size="sm" />체중</span>
        {v.weight != null
          ? <span className="v">{v.weight.toFixed(1)}<small>kg</small></span>
          : <span className="v empty">기록하기</span>}
        {v.weight != null && v.prevWeight != null && <span className="s">{sgn(v.weight - v.prevWeight).replace('-', '−')}kg</span>}
      </button>
      <button type="button" className="q" aria-label={`물 ${v.day.water_cups}잔. 누르면 한 잔 추가`} onClick={() => {
        const before = v.day.water_cups;
        setWater(env, v.ctx.key, before + 1);
        toast(`물 ${Math.min(8, before + 1)}잔`, () => setWater(env, v.ctx.key, before));
      }}>
        <span className="k"><Icon name="glass-water" size="sm" />물 +1</span>
        <span className="v">{v.day.water_cups}<small>/8잔</small></span>
      </button>
      <button type="button" className="q" onClick={() => open(<StepsSheet />)}>
        <span className="k"><Icon name="footprints" size="sm" />걸음</span>
        <span className="v">{fmt(v.day.steps)}<small>/{fmt(v.stepsGoal)}</small></span>
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
    <div className="note-row">
      <Icon name={r.icon} />
      <span className="tx"><b>{r.title}</b><span>{r.body}</span></span>
      {r.action && (
        <button type="button" className="link-btn" onClick={run}>
          {r.action.label}<Icon name={r.action.kind === 'order' && r.action.url ? 'arrow-up-right' : 'chevron-right'} size="sm" />
        </button>
      )}
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
      <span className="tl-node">
        {it.kind === 'meal' && m
          ? (
            <button
              type="button"
              className={`check${it.state === 'skipped' ? ' undo' : ''}`}
              aria-pressed={it.state === 'done'}
              aria-label={it.state === 'skipped' ? `${it.title} 건너뜀 취소` : `${it.title} 먹음 표시`}
              onClick={() => (it.state === 'skipped' ? toggleMeal(env, v.ctx.key, m.key) : act.eat(m.key))}
            >
              <Icon name={it.state === 'skipped' ? 'rotate-ccw' : 'check'} size="sm" />
            </button>
          )
          : <span className="dot" aria-hidden="true" />}
      </span>
      <button type="button" className="tl-main" onClick={onMain} aria-expanded={it.kind === 'meal' ? expanded : undefined}>
        <span className="h"><b>{it.title}</b>{tag && <span className="tag">{tag}</span>}</span>
        <span className="s">{it.sub}</span>
      </button>
      <span className="tl-side">
        {it.kind === 'meal' && m && <span className="kc">{fmt(kcal ?? 0)}<small>kcal</small></span>}
        {it.kind === 'workout' && it.routine && it.state !== 'done' && <button type="button" className="chip-btn" onClick={() => nav.startWorkout(it.routine!)}><Icon name="play" size="sm" />시작</button>}
        {it.kind === 'workout' && it.state === 'done' && <span className="done-tag"><Icon name="check" size="sm" />완료</span>}
        {it.kind === 'wake' && it.state !== 'done' && <button type="button" className="chip-btn" onClick={() => open(<TimeSheet />, { focus: '#wh-h' })}>기록</button>}
      </span>
      {expanded && m && (
        <div className="tl-detail">
          <ul className="kv-list compact">{m.items.map((x) => <li key={x.name}><span>{x.name}</span><span>{x.amount}</span></li>)}</ul>
          {m.swaps[0] && <p className="swap"><Icon name="arrow-left-right" size="sm" /><span>{m.swaps[0]}</span></p>}
          <div className="row">
            {it.state === 'done' || it.state === 'skipped'
              ? <button type="button" className="btn-ghost pill" onClick={() => { toggleMeal(env, v.ctx.key, m.key); setOpenId(null); }}><Icon name="rotate-ccw" size="sm" />기록 취소</button>
              : <>
                  <button type="button" className="btn-ghost pill" onClick={() => act.partial(m.key)}>일부만 먹었어요</button>
                  <button type="button" className="btn-ghost pill" onClick={() => act.other(m.key)}>다르게 먹었어요</button>
                </>}
          </div>
          <div className="quiet-acts">
            {it.state !== 'done' && it.state !== 'skipped' && <button type="button" className="link-btn quiet" onClick={() => { act.skip(m.key); setOpenId(null); }}>건너뛰기</button>}
            <button type="button" className="link-btn quiet" onClick={() => open(<MealEditSheet mealKey={m.key} />)}>식단 바꾸기</button>
          </div>
        </div>
      )}
    </li>
  );
}

function Ruler({ items, v }: { items: TimelineItem[]; v: TodayView }) {
  // the scale starts at the hour of waking (08:00 before that), so a late start does not squeeze the day
  const start = Math.min(Math.floor((v.day.wake_min ?? 8 * 60) / 60) * 60, 18 * 60);
  const end = 21 * 60;
  const pct = (m: number) => Math.max(0, Math.min(100, ((m - start) / (end - start)) * 100));
  const pos = (m: number) => `${pct(m).toFixed(2)}%`;
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
  // a label that would run into the previous one drops below the time
  let lastTop = -100;
  const low = new Set<string>();
  for (const x of marks) {
    const p = pct(x.at);
    if (p - lastTop < 8) low.add(x.id); else lastTop = p;
  }
  const nowIn = v.nowMin >= start && v.nowMin <= end;
  return (
    <div className={`ruler${low.size ? ' has-low' : ''}`} aria-hidden="true">
      <div className="track" />
      {nowIn && <div className="past" style={{ width: pos(v.nowMin) }} />}
      {marks.map((x) => (
        <div key={x.id} className={`mk ${x.state}${low.has(x.id) ? ' low' : ''}`} style={{ left: pos(x.at) }}>
          <span className="n">{x.label}</span>
          <span className="d" />
          <span className="tm">{hhmm(x.at)}</span>
        </div>
      ))}
      {nowIn && <div className="nowline" style={{ left: pos(v.nowMin) }} />}
    </div>
  );
}

/**
 * Shown under the focus card when the rest of the day, eaten as planned, would run over (or short on protein).
 * One tap writes the proposal as day adjustments; the timeline and the meal table then show the trimmed meals.
 */
function RebalanceCard({ v }: { v: TodayView }) {
  const env = useEnv();
  const { toast } = useOverlay();
  const p = rebalanceToday(env, v);
  // dismissal is remembered per day and per 100 kcal step, so a bigger overshoot asks again
  const dkey = `rb:${v.ctx.key}:${Math.floor(p.over / 100)}:${p.proteinAdds.length}`;
  const [dismissedNow, setDismissedNow] = useState<string | null>(null);
  if (!rebalanceWorthShowing(p) || dismissedNow === dkey || devicePref.get<boolean>(dkey, false)) return null;
  const mealName = (k: MealKey) => (v.meals.find((m) => m.key === k)?.name ?? MEALS[k].name).replace(/ \(.+\)$/, '');
  // listed in meal order so each meal's changes sit together (the engine returns them by preference)
  const order = (k: MealKey) => { const i = v.meals.findIndex((m) => m.key === k); return i < 0 ? 99 : i; };
  const today: [string, string][] = [
    ...p.cuts.map((c) => ({ k: c.slot, row: [`${mealName(c.slot)} · ${c.label}`, `−${fmt(c.kcal)}kcal`] as [string, string] })),
    ...p.proteinAdds.map((a) => ({ k: a.slot, row: [`${mealName(a.slot)} · ${a.label} 더하기`, `+${fmt(a.kcal)}kcal`] as [string, string] })),
  ].sort((x, y) => order(x.k) - order(y.k)).map((x) => x.row);
  // carry-over in one line when every day gets the same cut ("다음 3일 하루 목표 −200kcal씩")
  const same = p.carry.length > 1 && p.carry.every((c) => c.kcal === p.carry[0]!.kcal);
  const later: [string, string][] = same
    ? [[`다음 ${p.carry.length}일 하루 목표`, `−${fmt(p.carry[0]!.kcal)}kcal씩`]]
    : p.carry.map((c): [string, string] => [`${c.offset === 1 ? '내일' : `${c.offset}일 뒤`} 하루 목표`, `−${fmt(c.kcal)}kcal`]);
  if (p.stepsBonus > 0) later.push(['내일 걸음 목표', `+${fmt(p.stepsBonus)}보`]);
  const over = p.over > 100;
  // say why in plain words: what was eaten on top of the plan, and what the whole day adds up to
  const causes = overCauses(v);
  const why = over
    ? `${causes.length ? `계획에 없던 ${causes.map((c) => `${c.name} ${fmt(c.kcal)}kcal`).join(', ')}를 먹어서, ` : ''}남은 끼니까지 계획대로 먹으면 하루 ${fmt(p.before.total)}kcal로 목표 ${fmt(v.target)}kcal를 넘습니다. 아래처럼 바꾸면 맞춰집니다.`
    : '남은 끼니에 단백질을 조금 더합니다.';
  const group = (label: string, rows: [string, string][]) => rows.length > 0 && (
    <div className="rb-group">
      <h4>{label}</h4>
      <ul className="kv-list compact rb-lines">{rows.map(([a, b]) => <li key={a + b}><span>{a}</span><span>{b}</span></li>)}</ul>
    </div>
  );
  return (
    <section className="rb-card sq" aria-label="남은 계획 맞추기">
      <h3 className="rb-t">{over ? `오늘 목표보다 ${fmt(p.over)}kcal 많아집니다` : `단백질이 ${Math.max(0, env.program.proteinFloor - p.before.protein)}g 모자랍니다`}</h3>
      <p className="rb-why">{why}</p>
      {group('오늘 남은 끼니', today)}
      {group('앞으로 며칠', later)}
      <div className="card-acts">
        <button type="button" className="btn-primary pill" onClick={() => { const undo = applyRebalance(env, p); toast('남은 계획을 맞췄습니다', undo); }}>
          <Icon name="check" size="sm" />이렇게 맞추기
        </button>
        <button type="button" className="link-btn quiet" onClick={() => { devicePref.set(dkey, true); setDismissedNow(dkey); }}>그대로 두기</button>
      </div>
    </section>
  );
}

/** Rain while one would walk today: offer the home workout that is due instead (one tap, undo in the toast). */
function RainNote({ v }: { v: TodayView }) {
  const env = useEnv();
  const { toast } = useOverlay();
  const hours = useForecast(env, v.session === 'walk');
  const dkey = `rain:${v.ctx.key}`;
  const [kept, setKept] = useState(() => devicePref.get<boolean>(dkey, false));
  const s = hours ? rainSuggestion(env, v, hours) : null;
  if (!s || kept) return null;
  const r = v.routines[s.routine];
  return (
    <section className="note-row rain" aria-label="날씨">
      <Icon name={s.check.snow ? 'cloud-snow' : 'cloud-rain'} />
      <span className="tx">
        <b>{s.text}</b>
        <span>걷는 날이지만 오늘은 집에서 {r.name}({r.focus})로 바꿀 수 있습니다</span>
      </span>
      <span className="acts">
        <button type="button" className="chip-btn" onClick={() => { const undo = swapWalkForWorkout(env, s.routine); toast(`오늘은 걷기 대신 ${r.name}를 합니다`, undo); }}>
          <Icon name="dumbbell" size="sm" />홈트로 바꾸기
        </button>
        <button type="button" className="link-btn quiet" onClick={() => { devicePref.set(dkey, true); setKept(true); }}>그대로 걷기</button>
      </span>
    </section>
  );
}

/** Signed out: one quiet line pointing at Settings. Signed in but stuck: how many records are waiting. */
function SyncBanner() {
  const env = useEnv();
  const auth = useAuth();
  const { open } = useOverlay();
  if (!getSupabase() || !auth.ready) return null;
  const st = env.store.syncState;
  if (!auth.user) {
    return (
      <div className="note-row banner">
        <Icon name="cloud-off" />
        <span className="tx"><b>이 기기에만 저장 중입니다</b><span>로그인하면 웹과 아이폰이 같은 기록을 봅니다</span></span>
        <button type="button" className="link-btn" onClick={() => open(<SettingsSheet />)}>로그인<Icon name="chevron-right" size="sm" /></button>
      </div>
    );
  }
  if (st !== 'error' && st !== 'offline') return null;
  const n = env.store.pendingCount();
  return (
    <div className="note-row banner">
      <Icon name="cloud-off" />
      <span className="tx"><b>{st === 'offline' ? '오프라인입니다' : '동기화하지 못했습니다'}</b><span>{n ? `올리지 못한 기록 ${fmt(n)}개가 이 기기에 있습니다` : '설정에서 다시 맞출 수 있습니다'}</span></span>
      <button type="button" className="link-btn" onClick={() => open(<SettingsSheet />)}>설정<Icon name="chevron-right" size="sm" /></button>
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
    <div className="note-row banner">
      <Icon name="clipboard-paste" />
      <span className="tx"><b>예전 사이트 기록이 남아 있습니다</b><span>옮기면 아이폰 앱과 같이 봅니다</span></span>
      <button type="button" className="link-btn" onClick={() => { const c = importLegacyData(env, data); devicePref.set('legacyImported', true); setData(null); toast(`${c.days}일치 기록을 옮겼습니다`); }}>옮기기</button>
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
          <SyncBanner />
          <LegacyBanner />
          <FocusCard f={f} v={v} nav={nav} />
          <RebalanceCard v={v} />
          <RainNote v={v} />
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
          <section>
            <h2 className="section-title"><Icon name={sc.icon} size="sm" />{sc.name}</h2>
            <p className="note">{sc.short}</p>
            <ol className="rule-list" style={{ marginTop: 10 }}>{sc.rules.map((r) => <li key={r}>{r}</li>)}</ol>
          </section>
        </aside>
      </div>
    </>
  );
}
