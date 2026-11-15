'use client';
// Editing the plan: one meal (items, amounts, kcal, time), a weekday's session, a routine's exercises.
// Everything writes through @diet/data (setMealOverride, addAdjustments, setWeekDay, setTodaySession, setRoutineItems),
// the same functions the iPhone app and the AI coach use, so the edit shows up everywhere from todayView.
import { useState } from 'react';
import {
  applyPlanChanges, DOW, fmt, hhmm, MEALS, pad, plan, ROUTINES, WEEK_TYPES,
  type MealKey, type PlanItem, type RoutineDef, type RoutineKey, type WeekType,
  amrapOf,
} from '@diet/core';
import {
  addAdjustments, removeAdjustment, resetWorkout, setMealOverride, setTodaySession, setWeekDay, todayView,
  setRoutine,
} from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { eul } from '@/lib/ko';
import { Icon } from './Icon';
import { SheetHead, useOverlay, Wheel, type WheelItem } from './ui';

const HOURS: WheelItem[] = Array.from({ length: 24 }, (_, i) => ({ v: i, t: pad(i), a: `${i}시` }));
const MINS: WheelItem[] = Array.from({ length: 12 }, (_, i) => ({ v: i * 5, t: pad(i * 5), a: `${i * 5}분` }));

/** Digits only, as a number (empty -> null). */
const toNum = (s: string): number | null => {
  const d = s.replace(/[^\d]/g, '');
  return d ? Math.min(9999, Number(d)) : null;
};

interface ItemDraft { name: string; amount: string; kcal: string; protein: string; note?: string }
const toDraft = (x: PlanItem): ItemDraft => ({ name: x.name, amount: x.amount, kcal: x.kcal != null ? String(x.kcal) : '', protein: x.protein != null ? String(x.protein) : '', note: x.note });

// ---------------- one meal ----------------
export function MealEditSheet({ mealKey }: { mealKey: MealKey }) {
  const env = useEnv();
  const { close, toast } = useOverlay();
  const v = todayView(env);
  // the meal as the plan has it (template edits included), before today's one-day changes
  const base = applyPlanChanges(plan({ scen: v.scen, eatout: v.eatout, wake: v.day.wake_min }), v.override, []).find((m) => m.key === mealKey);
  const shown = v.meals.find((m) => m.key === mealKey);
  const src = shown ?? base;
  const [items, setItems] = useState<ItemDraft[]>(() => (src?.items ?? []).map(toDraft));
  const [mealKcal, setMealKcal] = useState(String(src?.kcal ?? 0));
  const [mealProtein, setMealProtein] = useState(String(src?.protein ?? 0));
  const startAt = src?.at ?? 12 * 60;
  const [h, setH] = useState(Math.floor(startAt / 60) % 24);
  const [m, setM] = useState((Math.round((startAt % 60) / 5) * 5) % 60);
  const [pickTime, setPickTime] = useState(false);
  const [timeTouched, setTimeTouched] = useState(false);

  if (!base) {
    return <div><SheetHead eyebrow="식단 바꾸기" title="이 끼니는 오늘 계획에 없습니다" /></div>;
  }

  const clean = items.filter((x) => x.name.trim());
  // when every item carries numbers the meal total follows them; otherwise the meal total is typed directly
  const itemized = clean.length > 0 && clean.every((x) => toNum(x.kcal) != null);
  const kcal = itemized ? clean.reduce((s, x) => s + (toNum(x.kcal) ?? 0), 0) : (toNum(mealKcal) ?? 0);
  const protein = itemized ? clean.reduce((s, x) => s + (toNum(x.protein) ?? 0), 0) : (toNum(mealProtein) ?? 0);
  const outItems: PlanItem[] = clean.map((x) => {
    const k = toNum(x.kcal);
    const p = toNum(x.protein);
    return { name: x.name.trim(), amount: x.amount.trim(), ...(x.note ? { note: x.note } : {}), ...(k != null ? { kcal: k, protein: p ?? 0 } : {}) };
  });
  const time = timeTouched ? `${pad(h)}:${pad(m)}` : undefined;
  const edit = (i: number, patch: Partial<ItemDraft>) => setItems((a) => a.map((y, j) => (j === i ? { ...y, ...patch } : y)));

  const saveAlways = () => {
    const undo = setMealOverride(env, mealKey, { items: outItems, kcal, protein, ...(time ? { time } : {}), note: '직접 바꿨습니다' }, 'user');
    close();
    toast(`${eul(base.name)} 앞으로 이렇게 먹습니다`, undo);
  };
  const saveToday = () => {
    const undo = addAdjustments(env, [{
      offset: 0,
      adj: { slot: mealKey, source: 'user', reason: '오늘만 바꿈', change: { kind: 'edit', items: outItems, kcal_delta: kcal - base.kcal, protein_delta: protein - base.protein, label: '오늘만 바꿈' } },
    }]);
    close();
    toast(`오늘 ${base.name}만 바꿨습니다`, undo);
  };
  const removeMeal = () => {
    const undo = setMealOverride(env, mealKey, { removed: true, note: `${eul(base.name)} 뺐습니다` }, 'user');
    close();
    toast(`${eul(base.name)} 계획에서 뺐습니다`, undo);
  };
  const reset = () => {
    // back to the built-in meal: drop the template edit and today's changes to this meal
    const today = v.adjustments.filter((a) => a.slot === mealKey && a.id);
    const undoPlan = base.edited ? setMealOverride(env, mealKey, null, 'user', `${eul(MEALS[mealKey].name)} 기본으로 되돌렸습니다`) : () => {};
    for (const a of today) removeAdjustment(env, a.id!);
    close();
    toast('기본 식단으로 되돌렸습니다', () => { undoPlan(); if (today.length) addAdjustments(env, today.map((adj) => ({ offset: 0, adj }))); });
  };

  return (
    <div className="plan-edit">
      <SheetHead eyebrow="식단 바꾸기" title={base.name} />

      <button type="button" className="field-row" aria-expanded={pickTime} onClick={() => setPickTime((x) => !x)}>
        <span className="lbl">시간</span>
        <span className="num">{time ?? (src?.at != null ? hhmm(src.at) : base.time)}</span>
        <Icon name="chevron-down" size="sm" className={pickTime ? 'flip' : undefined} />
      </button>
      {pickTime && (
        <div className="picker">
          <div className="picker-band sq" />
          <Wheel items={HOURS} value={h} onChange={(x) => { setH(x); if (x !== h) setTimeTouched(true); }} label="시" />
          <span className="picker-unit">시</span>
          <Wheel items={MINS} value={m} onChange={(x) => { setM(x); if (x !== m) setTimeTouched(true); }} label="분" />
          <span className="picker-unit">분</span>
        </div>
      )}

      <h3 className="section-title">먹는 것</h3>
      <ul className="item-edit">
        {items.map((x, i) => (
          <li key={i}>
            <div className="ie-top">
              <input className="input sq" value={x.name} placeholder="이름" aria-label={`${i + 1}번째 항목 이름`} onChange={(e) => edit(i, { name: e.target.value })} />
              <button type="button" className="icon-btn" aria-label={`${x.name || '항목'} 빼기`} onClick={() => setItems((a) => a.filter((_, j) => j !== i))}><Icon name="x" size="sm" /></button>
            </div>
            <div className="ie-nums">
              <input className="input sq" value={x.amount} placeholder="양" aria-label={`${x.name || '항목'} 양`} onChange={(e) => edit(i, { amount: e.target.value })} />
              <label className="unit-in"><input className="input sq" value={x.kcal} inputMode="numeric" placeholder="0" aria-label={`${x.name || '항목'} 칼로리`} onChange={(e) => edit(i, { kcal: e.target.value.replace(/[^\d]/g, '') })} /><span>kcal</span></label>
              <label className="unit-in"><input className="input sq" value={x.protein} inputMode="numeric" placeholder="0" aria-label={`${x.name || '항목'} 단백질`} onChange={(e) => edit(i, { protein: e.target.value.replace(/[^\d]/g, '') })} /><span>g</span></label>
            </div>
          </li>
        ))}
      </ul>
      <button type="button" className="link-btn" onClick={() => setItems((a) => [...a, { name: '', amount: '', kcal: '', protein: '' }])}><Icon name="plus" size="sm" />항목 추가</button>

      {itemized ? (
        <dl className="trio two">
          <div><dt>합계</dt><dd>{fmt(kcal)}<small>kcal</small></dd></div>
          <div><dt>단백질</dt><dd>{protein}<small>g</small></dd></div>
        </dl>
      ) : (
        <>
          <div className="ie-nums two" style={{ marginTop: 18 }}>
            <label className="unit-in"><input className="input sq" value={mealKcal} inputMode="numeric" aria-label="끼니 칼로리" onChange={(e) => setMealKcal(e.target.value.replace(/[^\d]/g, ''))} /><span>kcal</span></label>
            <label className="unit-in"><input className="input sq" value={mealProtein} inputMode="numeric" aria-label="끼니 단백질" onChange={(e) => setMealProtein(e.target.value.replace(/[^\d]/g, ''))} /><span>g</span></label>
          </div>
          <p className="note" style={{ marginTop: 8 }}>모든 항목에 kcal를 넣으면 합계가 항목을 따라갑니다.</p>
        </>
      )}
      <p className="note" style={{ marginTop: 10 }}>숫자를 모르면 코치에게 &ldquo;이렇게 바꾸면 몇 kcal야?&rdquo; 라고 물어보면 계산해서 바꿔 줍니다.</p>

      <div className="sheet-acts">
        <button type="button" className="btn-ghost pill" onClick={saveToday}>오늘만</button>
        <button type="button" className="btn-primary pill" disabled={!clean.length} onClick={saveAlways}><Icon name="check" size="sm" />앞으로 계속</button>
      </div>
      <div className="quiet-acts">
        <button type="button" className="link-btn quiet" onClick={removeMeal}>이 끼니 빼기</button>
        {(base.edited || shown?.changes?.length) ? <button type="button" className="link-btn quiet" onClick={reset}>기본으로 되돌리기</button> : null}
      </div>
    </div>
  );
}

// ---------------- a weekday's session ----------------
export function WeekDaySheet({ dow }: { dow: number }) {
  const env = useEnv();
  const { close, toast } = useOverlay();
  const v = todayView(env);
  const isToday = dow === v.ctx.dow;
  const [sel, setSel] = useState<WeekType>(() => (isToday ? v.session : v.week[dow]!.t));
  const desc: Record<WeekType, [string, string]> = {
    A: [v.routines.A.name, v.routines.A.focus],
    B: [v.routines.B.name, v.routines.B.focus],
    walk: ['걷기만', '홈트 없이 걸음 목표만 채웁니다'],
    light: ['가볍게', 'A 또는 B를 3라운드만'],
    rest: ['쉬는 날', '홈트를 쉽니다. 프로틴은 간식 때 마십니다'],
  };
  const day = `${DOW[dow]}요일`;
  return (
    <div>
      <SheetHead eyebrow={isToday ? `오늘 · ${day}` : day} title="어떤 운동을 할까요?" />
      <div className="pick-list" role="radiogroup" aria-label={`${day} 운동`}>
        {WEEK_TYPES.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={sel === t} className="pick-row no-ic" onClick={() => setSel(t)}>
            <span><b>{desc[t][0]}</b><span>{desc[t][1]}</span></span>
            {sel === t ? <Icon name="check" className="on" /> : <span />}
          </button>
        ))}
      </div>
      <div className="sheet-acts">
        {isToday && (
          <button type="button" className="btn-ghost pill" onClick={() => { const undo = setTodaySession(env, sel); close(); toast(`오늘만 ${desc[sel][0]}`, undo); }}>오늘만</button>
        )}
        <button type="button" className="btn-primary pill" onClick={() => { const undo = setWeekDay(env, dow, sel); close(); toast(`매주 ${day}: ${desc[sel][0]}`, undo); }}>
          <Icon name="check" size="sm" />매주 {day}
        </button>
      </div>
      {v.override?.workout && (
        <div className="quiet-acts">
          <button type="button" className="link-btn quiet" onClick={() => { const undo = resetWorkout(env); close(); toast('기본 운동 계획으로 되돌렸습니다', undo); }}>기본 운동 계획으로 되돌리기</button>
        </div>
      )}
    </div>
  );
}

// ---------------- a routine's exercises ----------------
type Item = RoutineDef['items'][number];

export function RoutineEditSheet({ k }: { k: RoutineKey }) {
  const env = useEnv();
  const { close, toast } = useOverlay();
  const v = todayView(env);
  const r = v.routines[k];
  const [items, setItems] = useState<Item[]>(() => r.items.map((x) => ({ ...x })));
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<'회' | '초'>('회');
  const [amrap, setAmrap] = useState<number | null>(() => amrapOf(r));
  const step = (i: number, d: number) => setItems((a) => a.map((x, j) => (j === i ? { ...x, n: Math.max(1, x.n + d * (x.unit.startsWith('초') ? 5 : 1)) } : x)));
  const add = () => {
    if (!name.trim()) return;
    setItems((a) => [...a, { name: name.trim(), n: unit === '초' ? 30 : 10, unit }]);
    setName('');
  };
  return (
    <div>
      <SheetHead eyebrow={`${r.focus} 루틴`} title={r.name} />
      <ul className="routine-edit">
        {items.map((x, i) => (
          <li key={`${x.name}-${i}`}>
            <button type="button" className="icon-btn ghost" aria-label={`${x.name} 빼기`} onClick={() => setItems((a) => a.filter((_, j) => j !== i))}><Icon name="x" size="sm" /></button>
            <span className="nm">{x.name}</span>
            <span className="stepper" role="group" aria-label={`${x.name} 횟수`}>
              <button type="button" aria-label={`${x.name} 줄이기`} onClick={() => step(i, -1)}>−</button>
              <b aria-live="polite">{x.n}<small>{x.unit}</small></b>
              <button type="button" aria-label={`${x.name} 늘리기`} onClick={() => step(i, 1)}>+</button>
            </span>
          </li>
        ))}
      </ul>
      <div className="inline-form" style={{ marginTop: 14 }}>
        <input className="input sq" value={name} placeholder="운동 추가 (예: 와이드 스쿼트)" aria-label="추가할 운동 이름" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        <div className="seg unit-seg" role="group" aria-label="단위">
          {(['회', '초'] as const).map((u) => <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}>{u}</button>)}
        </div>
        <button type="button" className="btn-ghost pill" disabled={!name.trim()} onClick={add}>추가</button>
      </div>
      <p className="section-label" style={{ marginTop: 20 }}>하는 방식</p>
      <div className="seg" role="group" aria-label="하는 방식">
        {[null, 10, 15, 20, 30].map((m) => <button key={String(m)} type="button" aria-pressed={amrap === m} onClick={() => setAmrap(m)}>{m ? `${m}분` : '라운드'}</button>)}
      </div>
      <p className="note" style={{ marginTop: 10 }}>{amrap ? `${amrap}분 동안 위 순서를 계속 반복하고, 한 바퀴 끝날 때마다 누르면 바퀴 수를 셉니다. 횟수는 적힌 그대로 합니다.` : '정해진 라운드를 쉬어 가며 합니다. 기본 횟수이고, 3주차부터는 1.2배로 늘려서 보여줍니다.'}</p>
      <div className="sheet-acts">
        <button type="button" className="btn-ghost pill" onClick={() => setItems(ROUTINES[k].items.map((x) => ({ ...x })))}>기본 구성</button>
        <button type="button" className="btn-primary pill" disabled={!items.length} onClick={() => { const undo = setRoutine(env, k, { items, amrapMin: amrap }, 'user', amrap ? `${r.name}를 ${amrap}분 동안 반복으로 바꿨습니다` : `${r.name} 구성을 바꿨습니다`); close(); toast(`${eul(r.name)} 이렇게 합니다`, undo); }}>
          <Icon name="check" size="sm" />저장
        </button>
      </div>
    </div>
  );
}
