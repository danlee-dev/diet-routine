'use client';
// Sheets for the v3 layout: the + action sheet, "ate something else", and the situation picker.
import { useMemo, useState } from 'react';
import { fmt, keypadReduce, PORTIONS, PRESETS, SCEN, SCEN_ORDER, type FoodPreset, type KeypadState, type Slot } from '@diet/core';
import { logFood, remainingKcal, setDay, setWater, todayView, toggleMeal, workoutPlan } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { Icon } from './Icon';
import { Keypad, SheetHead, useOverlay } from './ui';
import { RulesSheet, StepsSheet, TimeSheet, WeightSheet } from './sheets';

export function ScenarioSheet() {
  const env = useEnv();
  const { close, open } = useOverlay();
  const v = todayView(env);
  return (
    <div>
      <SheetHead eyebrow="오늘 상황" title="오늘은 어떤 날이에요?" />
      <div className="pick-list" role="list">
        {SCEN_ORDER.map((id) => (
          <button key={id} type="button" className="pick-row" aria-pressed={v.scen === id} onClick={() => { setDay(env, v.ctx.key, { scenario: id }); close(); }}>
            <span className="ic"><Icon name={SCEN[id].icon} /></span>
            <span><b>{SCEN[id].name}</b><span>{SCEN[id].short}</span></span>
            {v.scen === id ? <Icon name="check" /> : <span />}
          </button>
        ))}
      </div>
      <button type="button" className="btn-ghost pill" style={{ marginTop: 12 }} onClick={() => open(<RulesSheet id={v.scen} />)}>
        {SCEN[v.scen].name} 규칙 보기<Icon name="chevron-right" />
      </button>
    </div>
  );
}

const GROUPS: [FoodPreset['group'], string][] = [['delivery', '배달·외식'], ['meal', '식사'], ['drink', '마실 것'], ['snack', '간식']];

export function FoodSheet({ slot: initialSlot }: { slot?: Slot }) {
  const env = useEnv();
  const { close, toast } = useOverlay();
  const v = todayView(env);
  const [slot, setSlot] = useState<Slot>(initialSlot ?? v.next?.key ?? 'extra');
  const [preset, setPreset] = useState<FoodPreset | null>(null);
  const [portion, setPortion] = useState<(typeof PORTIONS)[number]['id']>('normal');
  const [manual, setManual] = useState(false);
  const [name, setName] = useState('');
  const [pad, setPad] = useState<KeypadState>({ n: 0, fresh: true });
  const [protein, setProtein] = useState(10);

  const slots: { id: Slot; label: string }[] = [
    ...v.meals.map((m) => ({ id: m.key as Slot, label: m.name.replace(/ \(.+\)$/, '') })),
    { id: 'extra', label: '추가로 먹음' },
  ];
  const mult = PORTIONS.find((p) => p.id === portion)!.mult;
  const kcal = manual ? pad.n : preset ? Math.round(preset.kcal * mult) : 0;
  const prot = manual ? protein : preset ? Math.round(preset.protein * mult) : 0;
  const replacedEaten = slot === 'extra' ? 0 : v.entries.filter((e) => e.slot === slot).reduce((a, e) => a + e.kcal, 0);
  const leftAfter = remainingKcal(env, v) - kcal + replacedEaten;

  const save = () => {
    if (!kcal) return;
    const undo = logFood(env, {
      date: v.ctx.key, slot, kcal, protein: prot, source: manual ? 'manual' : 'preset',
      name: manual ? name.trim() || '직접 입력' : preset!.name,
      amount: manual ? '' : `${preset!.serving} · ${PORTIONS.find((p) => p.id === portion)!.label}`,
    });
    close();
    toast(`${manual ? name.trim() || '직접 입력' : preset!.name} ${fmt(kcal)}kcal 기록`, undo);
  };

  return (
    <div>
      <SheetHead eyebrow="다르게 먹었어요" title={preset || manual ? '이렇게 기록할까요?' : '무엇을 먹었어요?'} />
      <div className="slot-chips" role="group" aria-label="어느 끼니">
        {slots.map((s) => <button key={s.id} type="button" aria-pressed={slot === s.id} onClick={() => setSlot(s.id)}>{s.label}</button>)}
      </div>
      {!preset && !manual && (
        <>
          {GROUPS.map(([g, label]) => (
            <div key={g}>
              <p className="group-h">{label}</p>
              <div className="pick-list" style={{ marginTop: 0 }}>
                {PRESETS.filter((p) => p.group === g).map((p) => (
                  <button key={p.id} type="button" className="pick-row" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }} onClick={() => setPreset(p)}>
                    <span><b>{p.name}</b><span>{p.serving} · 단백질 {p.protein}g</span></span>
                    <span className="r">{fmt(p.kcal)}kcal</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <button type="button" className="btn-ghost pill" style={{ marginTop: 14 }} onClick={() => setManual(true)}>목록에 없어요 · 직접 입력</button>
          <p className="note" style={{ marginTop: 10 }}>사진이나 말로 기록하는 AI 코치는 다음 단계에서 붙습니다.</p>
        </>
      )}
      {preset && (
        <>
          <p className="page-sub" style={{ marginTop: 16 }}>{preset.name} · {preset.serving}</p>
          <div className="seg" style={{ marginTop: 10 }}>
            {PORTIONS.map((p) => <button key={p.id} type="button" aria-pressed={portion === p.id} onClick={() => setPortion(p.id)}>{p.label}</button>)}
          </div>
        </>
      )}
      {manual && (
        <>
          <input className="input" style={{ width: '100%', marginTop: 16 }} placeholder="무엇을 먹었는지 (예: 회사 근처 쌀국수)" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="pad-display"><b className={pad.fresh ? 'fresh' : ''}>{fmt(pad.n)}</b><small>kcal</small></div>
          <div className="slot-chips" role="group" aria-label="단백질">
            {[0, 10, 20, 30, 40].map((g) => <button key={g} type="button" aria-pressed={protein === g} onClick={() => setProtein(g)}>단백질 {g}g</button>)}
          </div>
          <Keypad onKey={(k) => setPad((s) => keypadReduce(s, k))} />
        </>
      )}
      {(preset || manual) && (
        <>
          <div className="food-sum">
            <div><b>{fmt(kcal)}</b><span>kcal</span></div>
            <div><b>{prot}g</b><span>단백질</span></div>
            <div><b>{fmt(Math.max(0, leftAfter))}</b><span>{leftAfter >= 0 ? '오늘 남는 kcal' : '오늘 초과'}</span></div>
          </div>
          <div className="sheet-acts">
            <button type="button" className="btn-ghost pill" onClick={() => { setPreset(null); setManual(false); }}>다시 고르기</button>
            <button type="button" className="btn-primary pill" disabled={!kcal} onClick={save}><Icon name="check" />기록</button>
          </div>
        </>
      )}
    </div>
  );
}

/** The center + button: every quick log in one place. */
export function ActionSheet({ onStartWorkout }: { onStartWorkout: (r: 'A' | 'B') => void }) {
  const env = useEnv();
  const { open, close, toast } = useOverlay();
  const v = todayView(env);
  const wp = workoutPlan(env, v);
  const next = v.next;
  const tiles = useMemo(() => {
    const t: { id: string; icon: string; title: string; sub: string; primary?: boolean; run: () => void }[] = [];
    if (v.day.wake_min == null) t.push({ id: 'wake', icon: 'sunrise', title: '일어났어요', sub: '끼니 시간 맞추기', primary: true, run: () => open(<TimeSheet />, { focus: '#wh-h' }) });
    if (next) {
      t.push({
        id: 'ate', icon: 'check', title: `${next.name} 먹었어요`, sub: `${fmt(next.kcal)}kcal · 계획대로`, primary: v.day.wake_min != null,
        run: () => { const r = toggleMeal(env, v.ctx.key, next.key); close(); if (r.added) toast(`${next.name} 먹음 표시`, r.undo); },
      });
    }
    t.push({ id: 'other', icon: 'utensils-crossed', title: '다르게 먹었어요', sub: '외식·배달·간식', run: () => open(<FoodSheet />) });
    t.push({ id: 'weight', icon: 'weight', title: '체중', sub: v.weight != null ? `${v.weight.toFixed(1)}kg 고치기` : '아침에 한 번', run: () => open(<WeightSheet i={v.ctx.idx} />, { focus: '#wh-kg' }) });
    t.push({ id: 'water', icon: 'glass-water', title: '물 +1잔', sub: `지금 ${v.day.water_cups}/8잔`, run: () => { setWater(env, v.ctx.key, v.day.water_cups + 1); close(); toast(`물 ${Math.min(8, v.day.water_cups + 1)}잔`, () => setWater(env, v.ctx.key, v.day.water_cups)); } });
    t.push({ id: 'steps', icon: 'footprints', title: '걸음', sub: `${fmt(v.day.steps)} / ${fmt(v.stepsGoal)}보`, run: () => open(<StepsSheet />) });
    if (wp) t.push({ id: 'wo', icon: 'play', title: `홈트 ${wp.routine} 시작`, sub: wp.done ? '오늘 완료 · 다시 하기' : '따라하기', run: () => { close(); onStartWorkout(wp.routine); } });
    return t;
  }, [env, v, next, wp, open, close, toast, onStartWorkout]);
  return (
    <div>
      <SheetHead eyebrow={`${v.ctx.label}`} title="기록하기" />
      <div className="acts-grid">
        {tiles.map((x) => (
          <button key={x.id} type="button" className={`act-tile sq${x.primary ? ' primary' : ''}`} onClick={x.run}>
            <Icon name={x.icon} /><b>{x.title}</b><span>{x.sub}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
