'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SCEN, SCEN_ORDER, type RoutineKey } from '@diet/core';
import { adoptLegacyProfile, profileState, setDay, setWater, skipMeal, todayView, toggleMeal, workoutPlan, type Env } from '@diet/data';
import { devicePref, getEnv, getSupabase, startAuth } from '@/lib/client';
import { EnvContext, FlowContext, useAuth, useEnv, useFlow } from '@/lib/hooks';
import { Icon } from './Icon';
import { OverlayProvider, useOverlay } from './ui';
import { ImportSheet, StepsSheet, TimeSheet, WeightSheet } from './sheets';
import { ActionSheet, FoodSheet } from './sheets2';
import { Today } from './views/Today';
import { Records } from './views/Records';
import { Runs } from './views/Runs';
import { Plan, PLAN_TABS, type PlanTab } from './views/Plan';
import { WorkoutPlayer } from './WorkoutPlayer';
import { CommandPalette, type Command } from './CommandPalette';
import { CoachButton, CoachPanel } from './coach/CoachPanel';
import { AccountButton, SettingsSheet } from './Settings';
import { Welcome } from './onboarding/Welcome';
import { Onboarding } from './onboarding/Onboarding';
import { DEFAULT_DRAFT, draftFromProfile } from './onboarding/answers';

type View = 'today' | 'workout' | 'records' | 'plan';
const VIEWS: [View, string, string][] = [['today', '오늘', 'calendar-check'], ['workout', '운동', 'route'], ['records', '기록', 'activity'], ['plan', '계획', 'signpost']];
const isView = (h: string): h is View => VIEWS.some((v) => v[0] === h);

/** Client-only gate: render nothing on the server so time and storage are read in the browser only. */
const useMounted = () => useSyncExternalStore(() => () => {}, () => true, () => false);

export function App() {
  const mounted = useMounted();
  const [env, setEnv] = useState<Env | null>(null);
  // Start auth before the shell mounts: it restores the session (also one coming back from Google or the
  // email link), attaches sync, and picks up a sign-in error from the URL.
  useEffect(() => { void getEnv().then((e) => { startAuth(e); setEnv(e); }); }, []);

  // offline cache for the shell (same behavior as the old site)
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol === 'https:') void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  if (!mounted || !env) return <div className="app" aria-busy="true" />;
  return (
    <EnvContext.Provider value={env}>
      <FlowProvider>
        <OverlayProvider>
          <Gate />
        </OverlayProvider>
      </FlowProvider>
    </EnvContext.Provider>
  );
}

function FlowProvider({ children }: { children: React.ReactNode }) {
  const [redo, setRedo] = useState(false);
  const value = useMemo(() => ({ redo, redoOnboarding: () => setRedo(true), endRedo: () => setRedo(false) }), [redo]);
  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

/**
 * Who sees what. A profile goes to the app. No profile: wait for a signed-in account's first pull (it may bring
 * a profile, or the owner's records from before onboarding, which become their profile), otherwise welcome and onboarding.
 */
function Gate() {
  const env = useEnv();
  const auth = useAuth();
  const [flow, setFlow] = useState<'welcome' | 'onboarding'>('welcome');
  const { redo, endRedo } = useFlow();
  const state = profileState(env.store);
  useEffect(() => { if (state === 'legacy') adoptLegacyProfile(env); }, [state, env]);

  if (state === 'ready') {
    if (redo) return <Onboarding mode="redo" initial={draftFromProfile(env)} onExit={endRedo} />;
    return <Shell />;
  }
  if (state === 'legacy' || (getSupabase() && !auth.ready)) return <div className="app" aria-busy="true" />;
  const st = env.store.syncState;
  if (auth.user && (st === 'local' || st === 'syncing')) {
    return <div className="gate-wait" role="status"><p className="eyebrow">{auth.user.email}</p><p className="gate-t">기록을 가져오고 있습니다</p></div>;
  }
  if (auth.user && (st === 'error' || st === 'offline') && flow !== 'onboarding') {
    const supa = getSupabase()!;
    return (
      <div className="gate-wait" role="alert">
        <p className="eyebrow">{auth.user.email}</p>
        <p className="gate-t">계정의 기록을 가져오지 못했습니다</p>
        <p className="s-lead">{env.store.lastError ?? '연결을 확인하고 다시 시도해 주세요.'}</p>
        <div className="wl-acts">
          <button type="button" className="btn-primary pill" onClick={() => void env.store.attach(supa, auth.user!.id)}>다시 시도</button>
          <button type="button" className="btn-ghost pill" onClick={() => setFlow('onboarding')}>새로 시작하기</button>
        </div>
      </div>
    );
  }
  // signed in with nothing on the account: straight to the questions
  if (flow === 'onboarding' || auth.user) return <Onboarding mode="new" initial={DEFAULT_DRAFT} onExit={auth.user ? undefined : () => setFlow('welcome')} />;
  return <Welcome onStart={() => setFlow('onboarding')} />;
}

function Shell() {
  const env = useEnv();
  const { open, close, toast, setPlayerOpen } = useOverlay();
  const [view, setView] = useState<View>(() => { const h = location.hash.slice(1); return isView(h) ? h : 'today'; });
  const [planTab, setPlanTabState] = useState<PlanTab>(() => {
    const t = devicePref.get<string>('planTab', 'meals');
    return PLAN_TABS.some(([k]) => k === t) ? (t as PlanTab) : 'meals';
  });
  const [cmdk, setCmdk] = useState(false);
  const [coach, setCoach] = useState(false);
  const [player, setPlayer] = useState<{ routine: RoutineKey | null; id: number }>({ routine: null, id: 0 });
  const v = todayView(env);

  const go = (next: View) => {
    setView(next);
    if (location.hash.slice(1) !== next) history.replaceState(null, '', `#${next}`);
    window.scrollTo(0, 0);
  };
  const setPlanTab = (t: PlanTab) => { setPlanTabState(t); devicePref.set('planTab', t); };
  const openPlan = (t: PlanTab) => { setPlanTab(t); go('plan'); };
  const startWorkout = (routine: RoutineKey) => { close(); setPlayer((p) => ({ routine, id: p.id + 1 })); setPlayerOpen(true); };
  const closePlayer = () => { setPlayer((p) => ({ ...p, routine: null })); setPlayerOpen(false); };

  // a failed sign-in (?error_description=..., or a code that could not be exchanged): show it where the user can retry
  const { error: authError } = useAuth();
  const shownError = useRef<string | null>(null);
  useEffect(() => {
    if (authError && authError !== shownError.current) { shownError.current = authError; open(<SettingsSheet />); }
  }, [authError, open]);

  useEffect(() => {
    const onHash = () => { const h = location.hash.slice(1); if (isView(h)) { setView(h); window.scrollTo(0, 0); } };
    window.addEventListener('hashchange', onHash);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdk((c) => !c); }
    };
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('hashchange', onHash); document.removeEventListener('keydown', onKey); };
  }, []);

  const commands: Command[] = (() => {
    const c: Command[] = [];
    c.push({ id: 'coach', label: '코치에게 묻기', icon: 'message-circle', group: '코치', keywords: 'AI 질문 채팅 상담 식단 바꾸기', run: () => setCoach(true) });
    const next = v.next;
    if (next) {
      c.push({ id: 'eat', label: `${next.name} 먹었어요`, icon: 'check', group: '기록', keywords: '먹음 식사', run: () => { const r = toggleMeal(env, v.ctx.key, next.key); if (r.added) toast(`${next.name} 먹음 표시`, r.undo); } });
      c.push({ id: 'other', label: '다르게 먹었어요', icon: 'utensils-crossed', group: '기록', keywords: '외식 배달 치킨 간식', run: () => open(<FoodSheet slot={next.key} />) });
      c.push({ id: 'skip', label: `${next.name} 건너뛰기`, icon: 'skip-forward', group: '기록', keywords: '안먹음 거름', run: () => { const u = skipMeal(env, v.ctx.key, next.key); toast(`${next.name} 건너뜀`, u); } });
    }
    c.push({ id: 'weight', label: '체중 기록', icon: 'weight', group: '기록', keywords: '몸무게 kg', run: () => open(<WeightSheet i={v.ctx.idx} />, { focus: '#wh-kg' }) });
    c.push({ id: 'water', label: '물 +1잔', icon: 'glass-water', group: '기록', run: () => { const b = v.day.water_cups; setWater(env, v.ctx.key, b + 1); toast(`물 ${Math.min(8, b + 1)}잔`, () => setWater(env, v.ctx.key, b)); } });
    c.push({ id: 'steps', label: '걸음 입력', icon: 'footprints', group: '기록', keywords: '걷기', run: () => open(<StepsSheet />) });
    c.push({ id: 'wake', label: '기상 시간', icon: 'sunrise', group: '기록', keywords: '일어남 기상', run: () => open(<TimeSheet />, { focus: '#wh-h' }) });
    const wp = workoutPlan(env, v);
    (['A', 'B'] as const).forEach((r) => c.push({ id: `wo-${r}`, label: `홈트 ${r} 시작`, icon: 'play', group: '운동', hint: wp?.routine === r ? '오늘' : undefined, keywords: r === 'A' ? '상체 복근' : '하체 전신', run: () => startWorkout(r) }));
    SCEN_ORDER.forEach((id) => c.push({ id: `scen-${id}`, label: `${SCEN[id].name}로 바꾸기`, icon: SCEN[id].icon, group: '오늘 상황', hint: v.scen === id ? '지금' : undefined, run: () => { setDay(env, v.ctx.key, { scenario: id }); toast(`오늘 상황: ${SCEN[id].name}`); } }));
    VIEWS.forEach(([k, l, i]) => c.push({ id: `go-${k}`, label: `${l} 보기`, icon: i, group: '이동', run: () => go(k) }));
    PLAN_TABS.forEach(([k, l]) => c.push({ id: `plan-${k}`, label: `계획 · ${l}`, icon: 'signpost', group: '이동', run: () => openPlan(k) }));
    c.push({ id: 'settings', label: '설정', icon: 'settings', group: '설정', keywords: '계정 로그인 로그아웃 동기화 구글 프로그램 버전', run: () => open(<SettingsSheet />) });
    c.push({ id: 'runs-map', label: '내가 달린 길', icon: 'route', group: '이동', keywords: '달리기 러닝 지도 경로', run: () => go('workout') });
    c.push({ id: 'import', label: '예전 백업 코드 가져오기', icon: 'clipboard-paste', group: '설정', run: () => open(<ImportSheet />, { focus: 'textarea' }) });
    return c;
  })();

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">다루</div>
        <div className="seg" role="group" aria-label="메뉴">
          {VIEWS.map(([k, label, icon]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => go(k)}><Icon name={icon} size="sm" />{label}</button>)}
        </div>
        <div className="tb-right">
          <CoachButton onClick={() => setCoach(true)} />
          <button type="button" className="kbtn" aria-label="검색과 실행 (⌘K)" onClick={() => setCmdk(true)}><Icon name="search" size="sm" /><span className="kl">검색·실행</span><kbd>⌘K</kbd></button>
          <button type="button" className="btn-primary pill" onClick={() => open(<ActionSheet onStartWorkout={startWorkout} />)}><Icon name="plus" size="sm" />기록하기</button>
          <AccountButton />
        </div>
      </header>
      <main id="main">
        <section className="view is-active" aria-label={VIEWS.find((x) => x[0] === view)?.[1]} key={view}>
          {view === 'today' && <Today nav={{ startWorkout, openShop: () => openPlan('shop') }} />}
          {view === 'workout' && <Runs />}
          {view === 'records' && <Records />}
          {view === 'plan' && <Plan tab={planTab} setTab={setPlanTab} onStartWorkout={startWorkout} onGoToday={() => go('today')} />}
        </section>
      </main>
      <nav className="bottombar" aria-label="메뉴">
        <button type="button" className="tab2" aria-current={view === 'today' ? 'page' : undefined} onClick={() => go('today')}><Icon name="calendar-check" size="lg" />오늘</button>
        <button type="button" className="tab2" aria-current={view === 'workout' ? 'page' : undefined} onClick={() => go('workout')}><Icon name="route" size="lg" />운동</button>
        <button type="button" className="act-btn" aria-label="기록하기" onClick={() => open(<ActionSheet onStartWorkout={startWorkout} />)}><Icon name="plus" size="lg" /></button>
        <button type="button" className="tab2" aria-current={view === 'records' ? 'page' : undefined} onClick={() => go('records')}><Icon name="activity" size="lg" />기록</button>
        <button type="button" className="tab2" aria-current={view === 'plan' ? 'page' : undefined} onClick={() => go('plan')}><Icon name="signpost" size="lg" />계획</button>
      </nav>
      <CommandPalette open={cmdk} onClose={() => setCmdk(false)} commands={commands} />
      <WorkoutPlayer key={player.id} routine={player.routine} onClose={closePlayer} />
      <CoachPanel open={coach} onOpen={() => setCoach(true)} onClose={() => setCoach(false)} />
    </div>
  );
}
