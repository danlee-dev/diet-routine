'use client';
// One question per step, then a staged build of the plan and a review before anything is saved.
// Every control is our own (wheels, choice rows, chips, steppers): no native selects or number spinners.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ACTIVITY_LABEL, ALLERGEN_LABEL, computeTargets, COOKING_LABEL, EATING_OUT_LABEL, fmt, generatePlan, hhmm, MEALS, ORDER, pad, schedule,
  WEEK_LABEL, WORKOUT_PLACE_LABEL,
  type Activity, type Allergen, type Cooking, type EatingOut, type GeneratedPlan, type OnboardingAnswers, type Sex, type WeekType, type WorkoutPlace,
} from '@diet/core';
import { completeOnboarding, replacePlan } from '@diet/data';
import { useAuth, useEnv } from '@/lib/hooks';
import { generatePlanRemote } from '@/lib/client';
import { Icon } from '../Icon';
import { useOverlay, Wheel, type WheelItem } from '../ui';
import { minGoalFor, toAnswers, type Draft } from './answers';

const range = (a: number, b: number, unit: string, step = 1): WheelItem[] =>
  Array.from({ length: Math.floor((b - a) / step) + 1 }, (_, i) => { const v = a + i * step; return { v, t: String(v), a: `${v}${unit}` }; });
const AGES = range(14, 80, '세');
const HEIGHTS = range(140, 200, '센티미터');
const KG = range(40, 150, '킬로그램');
const DEC: WheelItem[] = Array.from({ length: 10 }, (_, n) => ({ v: n, t: String(n), a: `점 ${n}` }));
const HOURS: WheelItem[] = Array.from({ length: 24 }, (_, i) => ({ v: i, t: pad(i), a: `${i}시` }));
const MINS: WheelItem[] = Array.from({ length: 12 }, (_, i) => ({ v: i * 5, t: pad(i * 5), a: `${i * 5}분` }));
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];
const BUDGETS: { v: number; title: string; desc?: string }[] = [
  { v: 50000, title: '5만 원', desc: '값싼 재료 위주로 고릅니다' }, { v: 70000, title: '7만 원' }, { v: 100000, title: '10만 원' },
  { v: 150000, title: '15만 원' }, { v: 0, title: '정하지 않음' },
];

// ---------------- controls ----------------
function Choices<T extends string | number>({ value, options, onChange, label }: {
  value: T | null; options: { v: T; title: string; desc?: string }[]; onChange: (v: T) => void; label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const move = (d: number) => {
    const i = Math.max(0, options.findIndex((o) => o.v === value));
    const n = options[(i + d + options.length) % options.length]!;
    onChange(n.v);
    setTimeout(() => ref.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(), 0);
  };
  return (
    <div
      ref={ref}
      className="choice-list"
      role="radiogroup"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
      }}
    >
      {options.map((o, i) => {
        const on = value === o.v;
        return (
          <button
            key={String(o.v)}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on || (value == null && i === 0) ? 0 : -1}
            className="choice sq"
            onClick={() => onChange(o.v)}
          >
            <span className="tx"><b>{o.title}</b>{o.desc && <span>{o.desc}</span>}</span>
            <span className="radio" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function KgPicker({ value, onChange, label, id }: { value: number; onChange: (v: number) => void; label: string; id?: string }) {
  const int = Math.min(150, Math.max(40, Math.floor(value)));
  const dec = Math.round((value - Math.floor(value)) * 10) % 10;
  return (
    <div className="picker compact">
      <div className="picker-band sq" />
      <Wheel id={id} items={KG} value={int} onChange={(k) => onChange(Math.round((k + dec / 10) * 10) / 10)} label={`${label} 킬로그램`} />
      <span className="picker-dot">.</span>
      <Wheel items={DEC} value={dec} onChange={(d) => onChange(Math.round((int + d / 10) * 10) / 10)} label={`${label} 소수점 아래`} small />
      <span className="picker-unit">kg</span>
    </div>
  );
}

function Dislikes({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [t, setT] = useState('');
  const add = () => {
    const w = t.trim();
    if (w && !value.includes(w)) onChange([...value, w]);
    setT('');
  };
  return (
    <>
      <div className="inline-form" style={{ marginTop: 22 }}>
        <input
          className="input sq"
          value={t}
          placeholder="싫은 음식 (예: 고구마)"
          aria-label="싫은 음식"
          onChange={(e) => setT(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } }}
        />
        <button type="button" className="btn-ghost pill" disabled={!t.trim()} onClick={add}>추가</button>
      </div>
      {value.length > 0 && (
        <ul className="tag-list" aria-label="빼는 음식">
          {value.map((w) => (
            <li key={w}><span>{w}</span><button type="button" aria-label={`${w} 지우기`} onClick={() => onChange(value.filter((x) => x !== w))}><Icon name="x" size="sm" /></button></li>
          ))}
        </ul>
      )}
    </>
  );
}

// ---------------- steps ----------------
interface Step { id: string; title: string; help?: string; valid: boolean; hint?: string; body: ReactNode }

function useSteps(d: Draft, set: (p: Partial<Draft>) => void): Step[] {
  const minGoal = minGoalFor(d.heightCm);
  const goalHint = d.goalWeightKg >= d.weightKg ? '목표 체중은 지금보다 낮게 잡습니다.'
    : d.goalWeightKg < minGoal ? `키 ${d.heightCm}cm라면 ${minGoal}kg 아래로는 잡지 않습니다.` : undefined;
  const weekOpts = [4, 8, 12].map((w) => {
    const t = d.sex ? computeTargets({ ...toAnswers(d), weeks: w }) : null;
    return { v: w, title: `${w}주`, desc: t ? `주 ${t.weeklyLossKg}kg씩 · 끝나면 약 ${t.endWeightKg}kg${t.endWeightKg <= d.goalWeightKg + 0.1 ? ' · 목표에 닿습니다' : ''}` : undefined };
  });
  return [
    {
      id: 'name', title: '어떻게 불러 드릴까요?', help: '이름이나 별명. 비워 두어도 됩니다.', valid: true,
      body: <input className="input sq onb-input" id="onb-name" value={d.name ?? ''} maxLength={20} autoComplete="nickname" placeholder="이름" aria-label="이름" onChange={(e) => set({ name: e.target.value })} />,
    },
    {
      id: 'sex', title: '성별을 알려 주세요', help: '하루에 필요한 열량을 계산하는 데만 씁니다.', valid: d.sex != null,
      body: <Choices<Sex> label="성별" value={d.sex} onChange={(sex) => set({ sex })} options={[{ v: 'male', title: '남성' }, { v: 'female', title: '여성' }]} />,
    },
    {
      id: 'age', title: '나이를 알려 주세요', valid: true,
      body: <div className="picker"><div className="picker-band sq" /><Wheel id="onb-age" items={AGES} value={d.age} onChange={(age) => set({ age })} label="나이" /><span className="picker-unit">세</span></div>,
    },
    {
      id: 'height', title: '키를 알려 주세요', valid: true,
      body: <div className="picker"><div className="picker-band sq" /><Wheel id="onb-height" items={HEIGHTS} value={d.heightCm} onChange={(heightCm) => set({ heightCm })} label="키" /><span className="picker-unit">cm</span></div>,
    },
    {
      id: 'weight', title: '지금 체중과 목표 체중', help: '아침 공복 체중이면 가장 정확합니다.', valid: !goalHint, hint: goalHint,
      body: (
        <div className="kg-pair">
          <div><p className="pick-label">지금</p><KgPicker id="onb-weight" value={d.weightKg} onChange={(weightKg) => set({ weightKg })} label="지금 체중" /></div>
          <div><p className="pick-label">목표</p><KgPicker value={d.goalWeightKg} onChange={(goalWeightKg) => set({ goalWeightKg })} label="목표 체중" /></div>
        </div>
      ),
    },
    {
      id: 'weeks', title: '몇 주 동안 할까요?', help: '무리한 속도면 안전한 속도로 맞춰서 계획합니다.', valid: true,
      body: <Choices<number> label="기간" value={d.weeks} onChange={(weeks) => set({ weeks })} options={weekOpts} />,
    },
    {
      id: 'activity', title: '평소에 얼마나 움직이나요?', help: '운동은 빼고, 일하고 생활하는 정도로 고릅니다.', valid: true,
      body: <Choices<Activity> label="활동량" value={d.activity} onChange={(activity) => set({ activity })} options={(Object.keys(ACTIVITY_LABEL) as Activity[]).map((v) => ({ v, title: ACTIVITY_LABEL[v] }))} />,
    },
    {
      id: 'wake', title: '보통 몇 시에 일어나나요?', help: '이 시간을 기준으로 끼니 시간을 정합니다.', valid: true,
      body: (
        <div className="picker">
          <div className="picker-band sq" />
          <Wheel id="onb-wake" items={HOURS} value={Math.floor(d.wakeMin / 60)} onChange={(h) => set({ wakeMin: h * 60 + (d.wakeMin % 60) })} label="시" />
          <span className="picker-unit">시</span>
          <Wheel items={MINS} value={Math.round((d.wakeMin % 60) / 5) * 5 % 60} onChange={(m) => set({ wakeMin: Math.floor(d.wakeMin / 60) * 60 + m })} label="분" />
          <span className="picker-unit">분</span>
        </div>
      ),
    },
    {
      id: 'eatingOut', title: '외식은 얼마나 하나요?', valid: true,
      body: <Choices<EatingOut> label="외식" value={d.eatingOut} onChange={(eatingOut) => set({ eatingOut })} options={(Object.keys(EATING_OUT_LABEL) as EatingOut[]).map((v) => ({ v, title: EATING_OUT_LABEL[v] }))} />,
    },
    {
      id: 'cooking', title: '요리는 어디까지 하나요?', help: '할 수 있는 만큼만 들어가게 식단을 고릅니다.', valid: true,
      body: <Choices<Cooking> label="조리" value={d.cooking} onChange={(cooking) => set({ cooking })} options={(Object.keys(COOKING_LABEL) as Cooking[]).map((v) => ({ v, title: COOKING_LABEL[v] }))} />,
    },
    {
      id: 'food', title: '못 먹거나 싫은 음식이 있나요?', help: '알레르기는 고르고, 싫은 음식은 적어 주세요. 식단에서 뺍니다.', valid: true,
      body: (
        <>
          <div className="slot-chips onb-chips" role="group" aria-label="알레르기">
            {(Object.keys(ALLERGEN_LABEL) as Allergen[]).map((a) => {
              const on = d.allergies.includes(a);
              return <button key={a} type="button" aria-pressed={on} onClick={() => set({ allergies: on ? d.allergies.filter((x) => x !== a) : [...d.allergies, a] })}>{on && <Icon name="check" size="sm" />}{ALLERGEN_LABEL[a]}</button>;
            })}
          </div>
          <Dislikes value={d.dislikes} onChange={(dislikes) => set({ dislikes })} />
        </>
      ),
    },
    {
      id: 'workout', title: '운동은 어디서, 일주일에 몇 번 할까요?', help: '근력 운동 날을 띄엄띄엄 놓고, 나머지 날은 걷기를 넣습니다.', valid: true,
      body: (
        <>
          <Choices<WorkoutPlace> label="운동 장소" value={d.workoutPlace} onChange={(workoutPlace) => set({ workoutPlace })} options={(Object.keys(WORKOUT_PLACE_LABEL) as WorkoutPlace[]).map((v) => ({ v, title: WORKOUT_PLACE_LABEL[v] }))} />
          {d.workoutPlace !== 'walk' && (
            <div className="onb-stepper">
              <span>일주일에</span>
              <span className="stepper" role="group" aria-label="일주일에 운동하는 날">
                <button type="button" aria-label="하루 줄이기" disabled={d.workoutDays <= 1} onClick={() => set({ workoutDays: Math.max(1, d.workoutDays - 1) })}>−</button>
                <b aria-live="polite">{d.workoutDays}<small>번</small></b>
                <button type="button" aria-label="하루 늘리기" disabled={d.workoutDays >= 6} onClick={() => set({ workoutDays: Math.min(6, d.workoutDays + 1) })}>+</button>
              </span>
            </div>
          )}
        </>
      ),
    },
    {
      id: 'budget', title: '장보기에 일주일 얼마까지 쓸까요?', help: '예산 안에서 고르고, 넘으면 계획을 보여 줄 때 알려 드립니다.', valid: true,
      body: <Choices<number> label="주간 예산" value={d.budgetWeek} onChange={(budgetWeek) => set({ budgetWeek })} options={BUDGETS} />,
    },
  ];
}

// ---------------- building ----------------
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Building({ answers, signedIn, onDone }: { answers: OnboardingAnswers; signedIn: boolean; onDone: (g: GeneratedPlan, source: 'user' | 'ai') => void }) {
  const lines = ['하루에 필요한 열량을 계산합니다', '먹을 수 있는 음식으로 끼니를 고릅니다', '운동 일정을 짭니다', '장보기 목록과 비용을 정리합니다'];
  if (signedIn) lines.push('코치가 내 답에 맞게 다듬습니다');
  const [done, setDone] = useState(0);
  const [remoteNote, setRemoteNote] = useState<string | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => { onDoneRef.current = onDone; });
  useEffect(() => {
    let off = false;
    void (async () => {
      const local = generatePlan(answers);
      for (let i = 1; i <= 4; i++) { await wait(520); if (off) return; setDone(i); }
      let g = local;
      let src: 'user' | 'ai' = 'user';
      if (signedIn) {
        const r = await generatePlanRemote(answers, local);
        if (off) return;
        if (r) { g = r; src = 'ai'; } else setRemoteNote('지금은 기본 계획으로 만듭니다');
        setDone(5);
      }
      await wait(450);
      if (!off) onDoneRef.current(g, src);
    })();
    return () => { off = true; };
  }, [answers, signedIn]);
  return (
    <div className="onb-build" role="status" aria-live="polite">
      <p className="eyebrow">내 계획 만들기</p>
      <h1 className="onb-q">계획을 만들고 있습니다</h1>
      <ol className="build-list">
        {lines.map((l, i) => (
          i <= done && (
            <li key={l} className={i < done ? 'is-done' : 'is-now'}>
              <span className="mk" aria-hidden="true">{i < done && <Icon name="check" size="sm" />}</span>
              <span>{i === 4 && remoteNote ? remoteNote : l}</span>
            </li>
          )
        ))}
      </ol>
    </div>
  );
}

// ---------------- review ----------------
function Review({ answers, g, mode }: { answers: OnboardingAnswers; g: GeneratedPlan; mode: 'new' | 'redo' }) {
  const t = g.targets;
  const sch = schedule(answers.wakeMin);
  const timeOf: Record<string, number | null | undefined> = { breakfast: sch?.b, lunch: sch?.l, snack: sch?.merge ? null : sch?.s, post: null, dinner: sch?.d };
  const week = g.plan.workout?.week ?? {};
  const routines = g.plan.workout?.routines;
  const shop = g.plan.shop;
  const name = answers.name?.trim();
  return (
    <div className="onb-review">
      <p className="eyebrow">{mode === 'redo' ? '다시 만든 계획' : '내 계획'}</p>
      <h1 className="onb-q">{name ? `${name}님 계획이 준비됐습니다` : '계획이 준비됐습니다'}</h1>

      <section className="rv-targets" aria-label="하루 목표">
        <p className="rv-big"><b>{fmt(t.kcal)}</b><span>kcal · 하루 목표</span></p>
        <dl className="trio">
          <div><dt>단백질</dt><dd>{t.proteinFloor}<small>g 이상</small></dd></div>
          <div><dt>속도</dt><dd>{t.weeklyLossKg}<small>kg/주</small></dd></div>
          <div><dt>{answers.weeks}주 뒤</dt><dd>{t.endWeightKg}<small>kg</small></dd></div>
        </dl>
        <p className="rv-why">하루에 쓰는 열량이 약 {fmt(t.tdee)}kcal라서, {fmt(t.deficit)}kcal 덜 먹는 양으로 잡았습니다.</p>
        {g.notes.length > 0 && <ul className="rule-list plain rv-notes">{g.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      </section>

      <section aria-labelledby="rv-meals">
        <h2 className="section-title" id="rv-meals">하루 식단<span className="muted">{fmt(g.day.kcal)}kcal · 단백질 {g.day.protein}g</span></h2>
        <ul className="rv-meals">
          {ORDER.map((k) => {
            const m = g.plan.meals?.[k];
            if (!m || m.removed) return null;
            const at = timeOf[k];
            return (
              <li key={k}>
                <span className="mt-time">{at != null ? hhmm(at) : ''}</span>
                <span className="mt-main">
                  <span className="mt-h"><b>{m.name ?? MEALS[k].name}</b><span className="kc">{fmt(m.kcal ?? 0)}<small>kcal</small></span></span>
                  <span className="mt-items">
                    {(m.items ?? []).map((x, i) => <span key={`${x.name}-${i}`} className="mt-item"><span className="nm">{x.name}</span><span className="am">{x.amount}</span></span>)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="rv-workout">
        <h2 className="section-title" id="rv-workout">운동<span className="muted">{WORKOUT_PLACE_LABEL[answers.workoutPlace]}</span></h2>
        <ol className="week rv-week" aria-label="요일별 운동">
          {DOW_ORDER.map((dw) => {
            const wt = (week[String(dw)] ?? 'walk') as WeekType;
            return <li key={dw}><span className="wk-d"><span>{DOW_KO[dw]}</span><b>{WEEK_LABEL[wt]}</b></span></li>;
          })}
        </ol>
        {routines && (
          <ul className="kv-list rv-routines">
            {(['A', 'B'] as const).map((k) => routines[k] && (
              <li key={k}><span>{routines[k]!.name ?? `홈트 ${k}`}</span><span>{routines[k]!.focus ?? ''} · {routines[k]!.items.length}가지</span></li>
            ))}
          </ul>
        )}
      </section>

      {shop && (shop.now.length > 0 || shop.week.length > 0) && (
        <section aria-labelledby="rv-shop">
          <h2 className="section-title" id="rv-shop">장보기<span className="muted">일주일에 약 {fmt(g.weeklyCost)}원</span></h2>
          {[['처음 한 번', shop.now], ['매주', shop.week]].map(([label, list]) => (list as typeof shop.now).length > 0 && (
            <div key={label as string} className="rv-shop">
              <h3 className="rv-sub">{label as string}</h3>
              <ul className="shop-list">
                {(list as typeof shop.now).map((x) => (
                  <li key={x.id} className="shop-item no-cb">
                    <div style={{ minWidth: 0 }}><div className="shop-name">{x.name}</div><div className="shop-meta">{x.qty} · <span className="num">{fmt(x.price)}</span>원</div></div>
                    <a className="ext" href={x.url} target="_blank" rel="noopener" aria-label={`${x.name} 쿠팡에서 찾기`}>쿠팡<Icon name="arrow-up-right" size="sm" /></a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      <p className="note" style={{ marginTop: 24 }}>시작한 뒤에도 식단, 운동, 장보기는 계획 탭에서 바꿀 수 있고, 코치에게 말로 부탁해도 됩니다.</p>
    </div>
  );
}

// ---------------- flow ----------------
export function Onboarding({ mode, initial, onExit }: { mode: 'new' | 'redo'; initial: Draft; onExit?: () => void }) {
  const env = useEnv();
  const auth = useAuth();
  const { toast } = useOverlay();
  const [d, setD] = useState<Draft>(initial);
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<'steps' | 'building' | 'review'>('steps');
  const [result, setResult] = useState<{ g: GeneratedPlan; source: 'user' | 'ai'; answers: OnboardingAnswers } | null>(null);
  const [frozen, setFrozen] = useState<OnboardingAnswers | null>(null);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const steps = useSteps(d, set);
  const step = steps[i]!;
  const last = i === steps.length - 1;
  const headRef = useRef<HTMLHeadingElement>(null);

  const next = () => {
    if (!step.valid) return;
    if (!last) { setI(i + 1); return; }
    setFrozen(toAnswers(d));
    setPhase('building');
  };
  const back = () => {
    if (phase === 'review') { setPhase('steps'); return; }
    if (i > 0) setI(i - 1);
    else onExit?.();
  };

  // the question is announced and focusable on every step; Enter moves on
  useEffect(() => {
    if (phase !== 'steps') return;
    const el = document.getElementById(`onb-${steps[i]!.id}`) as HTMLElement | null;
    (el ?? headRef.current)?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, phase]);
  useEffect(() => {
    if (phase !== 'steps') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'BUTTON' || tag === 'TEXTAREA') return;
      e.preventDefault();
      next();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const confirm = () => {
    if (!result) return;
    if (mode === 'new') {
      completeOnboarding(env, result.answers, result.g, result.source);
      history.replaceState(null, '', '#today');
      toast('계획을 시작합니다');
    } else {
      const undo = replacePlan(env, result.g, result.source);
      toast('계획을 다시 만들었습니다', undo);
      onExit?.();
    }
  };

  return (
    <div className="onb">
      <header className="onb-top">
        {phase !== 'building' && (i > 0 || phase === 'review' || onExit)
          ? <button type="button" className="icon-btn ghost" aria-label={phase === 'review' ? '답 고치기' : i > 0 ? '이전 질문' : mode === 'redo' ? '그만두기' : '처음으로'} onClick={back}><Icon name="chevron-left" /></button>
          : <span className="onb-spacer" />}
        {phase === 'steps'
          ? (
            <>
              <div className="onb-progress" role="progressbar" aria-label="질문 진행" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={i + 1}>
                <i style={{ width: `${((i + 1) / steps.length) * 100}%` }} />
              </div>
              <span className="onb-count">{i + 1} / {steps.length}</span>
            </>
          )
          : <span className="onb-brand">감량 루틴</span>}
        {mode === 'redo' && phase === 'steps' && onExit && <button type="button" className="link-btn quiet onb-cancel" onClick={onExit}>취소</button>}
      </header>

      {phase === 'steps' && (
        <main className="onb-body" key={step.id}>
          <p className="eyebrow">{mode === 'redo' ? '내 정보 다시 입력' : '내 계획 만들기'}</p>
          <h1 className="onb-q" ref={headRef} tabIndex={-1}>{step.title}</h1>
          {step.help && <p className="onb-help">{step.help}</p>}
          <div className="onb-ctrl">{step.body}</div>
          <p className="onb-hint" role="alert">{step.hint ?? ''}</p>
          <div className="onb-foot">
            <button type="button" className="btn-primary pill" disabled={!step.valid} onClick={next}>
              {last ? '계획 만들기' : '다음'}<Icon name={last ? 'check' : 'chevron-right'} size="sm" />
            </button>
          </div>
        </main>
      )}
      {phase === 'building' && frozen && (
        <main className="onb-body">
          <Building answers={frozen} signedIn={!!auth.user} onDone={(g, source) => { setResult({ g, source, answers: frozen }); setPhase('review'); window.scrollTo(0, 0); }} />
        </main>
      )}
      {phase === 'review' && result && (
        <main className="onb-body wide">
          <Review answers={result.answers} g={result.g} mode={mode} />
          <div className="onb-foot">
            <button type="button" className="btn-ghost pill" onClick={() => setPhase('steps')}>답 고치기</button>
            <button type="button" className="btn-primary pill" onClick={confirm}><Icon name="check" size="sm" />{mode === 'redo' ? '이대로 바꾸기' : '이대로 시작하기'}</button>
          </div>
        </main>
      )}
    </div>
  );
}
