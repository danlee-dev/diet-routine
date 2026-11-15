'use client';
import { useEffect, useState } from 'react';
import {
  fmt, hhmm, keypadReduce, MEALS, ORDER, pad, programDate, programKey, ROUTINES, SCEN, schedule, sgn, mdw, minutesOf, timeLabel,
  type KeypadState, type ScenId,
} from '@diet/core';
import {
  dayRecord, importLegacy, previousWeightFor, setSteps, setWake, setWeight, todayView, toggleMeal,
} from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { Icon } from './Icon';
import { Keypad, SheetHead, useOverlay, Wheel, type WheelItem } from './ui';

const HOURS: WheelItem[] = Array.from({ length: 24 }, (_, i) => ({ v: i, t: pad(i), a: `${i}시` }));
const MINS: WheelItem[] = Array.from({ length: 60 }, (_, i) => ({ v: i, t: pad(i), a: `${i}분` }));
const KG: WheelItem[] = Array.from({ length: 111 }, (_, n) => ({ v: 40 + n, t: String(40 + n), a: `${40 + n}킬로그램` }));
const DEC: WheelItem[] = Array.from({ length: 10 }, (_, n) => ({ v: n, t: String(n), a: `점 ${n}` }));

// ---------------- wake time ----------------
export function TimeSheet() {
  const env = useEnv();
  const { close, toast } = useOverlay();
  const v = todayView(env);
  const start = v.day.wake_min ?? minutesOf(env.now());
  const [h, setH] = useState(Math.floor(start / 60) % 24);
  const [m, setM] = useState(start % 60);
  const wake = h * 60 + m;
  const s = schedule(wake)!;
  const din = v.scen === 'lateHome' ? 19 * 60 : s.d;
  const cells: [string, number][] = s.merge ? [['첫 끼', s.b], ['점심', s.l], ['저녁', din]] : [['아침', s.b], ['점심', s.l], ['간식', s.s], ['저녁', din]];
  const save = () => {
    setWake(env, wake, { lateRule: true });
    close();
    toast(`기상 ${hhmm(wake)} · 끼니 시간을 맞췄습니다`);
  };
  return (
    <div onKeyDown={(e) => { if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); save(); } }}>
      <SheetHead eyebrow="기상 시간" title="몇 시에 일어났어요?" />
      <div className="picker">
        <div className="picker-band sq" />
        <Wheel id="wh-h" items={HOURS} value={h} onChange={setH} label="시" />
        <span className="picker-unit">시</span>
        <Wheel items={MINS} value={m} onChange={setM} label="분" />
        <span className="picker-unit">분</span>
      </div>
      <dl className="pick-plan" aria-live="polite">
        {cells.map(([label, at]) => <div key={label}><dt>{label}</dt><dd>{hhmm(at)}</dd></div>)}
      </dl>
      <div className="sheet-acts">
        <button type="button" className="btn-ghost pill" onClick={() => { const n = minutesOf(env.now()); setH(Math.floor(n / 60)); setM(n % 60); }}>지금</button>
        <button type="button" className="btn-primary pill" onClick={save}><Icon name="check" size="sm" />이 시간으로 맞추기</button>
      </div>
    </div>
  );
}

// ---------------- weight ----------------
export function WeightSheet({ i, backToDay }: { i: number; backToDay?: boolean }) {
  const env = useEnv();
  const { open, close, toast } = useOverlay();
  const key = programKey(env.program, i);
  const isToday = key === todayView(env).ctx.key;
  const has = dayRecord(env, i).weight;
  const prev = previousWeightFor(env, i);
  const start = has ?? prev ?? env.program.startWeight;
  const t10 = Math.round(start * 10);
  const [kg, setKg] = useState(Math.min(150, Math.max(40, Math.floor(t10 / 10))));
  const [dec, setDec] = useState(((t10 % 10) + 10) % 10);
  const value = Math.round((kg + dec / 10) * 10) / 10;
  const label = isToday ? '체중' : `${mdw(programDate(env.program, i))} 체중`;
  const after = () => (backToDay ? open(<DaySheet i={i} />) : close());
  const save = () => {
    const undo = setWeight(env, key, value);
    after();
    toast(`${label} ${value.toFixed(1)}kg 저장`, undo);
  };
  const clear = () => {
    const undo = setWeight(env, key, null);
    after();
    toast(`${label} 기록을 지웠습니다`, undo);
  };
  return (
    <div onKeyDown={(e) => { if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); save(); } }}>
      <SheetHead eyebrow={isToday ? '아침 체중' : `${mdw(programDate(env.program, i))} 체중`} title={has != null ? '체중 고치기' : '몇 kg이에요?'} />
      <div className="picker">
        <div className="picker-band sq" />
        <Wheel id="wh-kg" items={KG} value={kg} onChange={setKg} label="킬로그램" />
        <span className="picker-dot">.</span>
        <Wheel items={DEC} value={dec} onChange={setDec} label="소수점 아래" small />
        <span className="picker-unit">kg</span>
      </div>
      <p className="pick-note" aria-live="polite">
        시작 대비 <b>{sgn(value - env.program.startWeight)}kg</b>
        {prev != null && <> · 지난 기록보다 <b>{sgn(value - prev)}kg</b></>}
      </p>
      <div className="sheet-acts">
        {has != null && <button type="button" className="btn-ghost pill" onClick={clear}>지우기</button>}
        <button type="button" className="btn-primary pill" onClick={save}><Icon name="check" size="sm" />저장</button>
      </div>
    </div>
  );
}

// ---------------- steps keypad ----------------
export function StepsSheet() {
  const env = useEnv();
  const { close, toast } = useOverlay();
  const v = todayView(env);
  const [pad, setPad] = useState<KeypadState>({ n: v.day.steps, fresh: true });
  const { n, fresh } = pad;
  const press = (k: string) => setPad((s) => keypadReduce(s, k));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key)) { e.preventDefault(); setPad((s) => keypadReduce(s, e.key)); }
      else if (e.key === 'Backspace') { e.preventDefault(); setPad((s) => keypadReduce(s, 'b')); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const left = v.stepsGoal - n;
  const save = () => {
    const undo = setSteps(env, v.ctx.key, n);
    close();
    toast(n >= v.stepsGoal ? `걸음 ${fmt(n)}보 · 오늘 목표 달성` : `걸음 ${fmt(n)}보 저장`, undo);
  };
  return (
    <div>
      <SheetHead eyebrow="오늘 걸음" title="몇 걸음 걸었어요?" />
      <div className="pad-display"><b className={fresh && n > 0 ? 'fresh' : ''} aria-live="polite">{fmt(n)}</b><small>보</small></div>
      <p className="pick-note" style={{ marginTop: 2 }}>
        {left > 0 ? <>목표 {fmt(v.stepsGoal)}보까지 <b>{fmt(left)}보</b></> : <>오늘 목표 <b>{fmt(v.stepsGoal)}보</b> 달성</>}
      </p>
      <div className="quick">
        {[500, 1000, 2000].map((x) => (
          <button key={x} type="button" onClick={() => press(`+${x}`)}>+{fmt(x)}</button>
        ))}
      </div>
      <Keypad onKey={press} />
      <div className="sheet-acts"><button type="button" className="btn-primary pill" onClick={save}><Icon name="check" size="sm" />저장</button></div>
    </div>
  );
}

// ---------------- meal detail (phone) ----------------
export function MealSheet({ mealKey }: { mealKey: keyof typeof MEALS }) {
  const env = useEnv();
  const { close, toast } = useOverlay();
  const v = todayView(env);
  const m = v.meals.find((x) => x.key === mealKey);
  if (!m) return null;
  const done = v.eaten.has(mealKey);
  return (
    <div>
      <SheetHead eyebrow={timeLabel(m)} title={m.name} />
      <ul className="kv-list" style={{ marginTop: 14 }}>{m.items.map((x) => <li key={x.name}><span>{x.name}</span><span>{x.amount}</span></li>)}</ul>
      <dl className="trio two">
        <div><dt>칼로리</dt><dd>{m.est ? '약 ' : ''}{fmt(m.kcal)}<small>kcal</small></dd></div>
        <div><dt>단백질</dt><dd>{m.protein}<small>g</small></dd></div>
      </dl>
      {(m.hint || m.swaps.length > 0) && (
        <>
          <h3 className="section-title">알아둘 것</h3>
          <ul className="rule-list plain">{m.hint && <li>{m.hint}</li>}{m.swaps.map((s) => <li key={s}>{s}</li>)}</ul>
        </>
      )}
      <button
        type="button"
        className="btn-primary pill wide-btn"
        onClick={() => {
          const r = toggleMeal(env, v.ctx.key, mealKey);
          close();
          if (r.added) toast(`${m.name} 먹음 표시`, r.undo);
        }}
      >
        <Icon name={done ? 'rotate-ccw' : 'check'} size="sm" />{done ? '먹음 표시 취소' : '먹었습니다'}
      </button>
    </div>
  );
}

export function RulesSheet({ id }: { id: ScenId }) {
  const s = SCEN[id];
  return (
    <div>
      <SheetHead eyebrow="오늘 상황" title={s.name} />
      <p className="s-lead">{s.short}</p>
      <ol className="rule-list" style={{ marginTop: 14 }}>{s.rules.map((r) => <li key={r}>{r}</li>)}</ol>
    </div>
  );
}

// ---------------- a past day (records calendar) ----------------
export function DaySheet({ i }: { i: number }) {
  const env = useEnv();
  const { open } = useOverlay();
  const rec = dayRecord(env, i);
  const isToday = rec.key === todayView(env).ctx.key;
  return (
    <div>
      <SheetHead eyebrow={isToday ? '오늘' : `${i + 1}일째`} title={mdw(rec.date)} />
      <ul className="toggles">
        {ORDER.map((k) => {
          const on = rec.eaten.includes(k);
          return (
            <li key={k}>
              <span>{MEALS[k].name}</span>
              <button type="button" className="check" aria-pressed={on} aria-label={`${MEALS[k].name} 먹음 표시`} onClick={() => toggleMeal(env, rec.key, k)}>
                <Icon name="check" size="sm" />
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="field-row" onClick={() => open(<WeightSheet i={i} backToDay />, { focus: '#wh-kg' })}>
        <span className="lbl">체중</span>
        {rec.weight != null ? <span className="num">{rec.weight.toFixed(1)} kg</span> : <span className="muted">기록 없음</span>}
        <Icon name="chevron-right" size="sm" />
      </button>
      <p className="note" style={{ marginTop: 14 }}>
        물 {rec.water}/8잔 · 걸음 {fmt(rec.steps)}보{rec.workout ? ` · ${rec.workout.type === 'home_a' ? ROUTINES.A.name : rec.workout.type === 'home_b' ? ROUTINES.B.name : '운동'} 완료` : ''}
      </p>
    </div>
  );
}

// ---------------- import from the old site ----------------
export function ImportSheet() {
  const env = useEnv();
  const { close, toast } = useOverlay();
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [armed, setArmed] = useState(false);
  return (
    <div>
      <SheetHead eyebrow="백업" title="예전 기록 가져오기" />
      <p className="s-lead">예전 사이트의 기록 탭에서 복사한 백업 코드를 붙여넣습니다. 같은 날짜 기록은 코드 내용으로 바뀝니다.</p>
      <textarea className="input sq" style={{ marginTop: 14 }} placeholder="백업 코드를 붙여넣으세요" aria-label="백업 코드" autoComplete="off" spellCheck={false} value={code} onChange={(e) => { setCode(e.target.value); setArmed(false); }} />
      <p className="form-msg" aria-live="polite">{msg}</p>
      <div className="sheet-acts" style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn-ghost pill"
          onClick={() => {
            if (!navigator.clipboard?.readText) { setMsg('입력칸을 길게 눌러 붙여넣으세요'); return; }
            navigator.clipboard.readText().then((x) => { setCode(x.trim()); setMsg(x ? '붙여넣었습니다. 가져오기를 누르세요' : '클립보드가 비어 있습니다'); }, () => setMsg('입력칸을 길게 눌러 붙여넣으세요'));
          }}
        >
          <Icon name="clipboard-paste" size="sm" />붙여넣기
        </button>
        <button
          type="button"
          className="btn-primary pill"
          onClick={() => {
            if (!code.trim()) { setMsg('백업 코드를 먼저 붙여넣으세요'); return; }
            if (!armed) { setArmed(true); setMsg('같은 날짜 기록이 바뀝니다'); return; }
            try {
              const c = importLegacy(env, code);
              close();
              toast(`${c.days}일치 기록을 가져왔습니다`);
            } catch {
              setArmed(false);
              setMsg('코드가 올바르지 않습니다. 다시 복사해서 붙여넣으세요');
            }
          }}
        >
          {armed ? '덮어쓰려면 한 번 더' : '가져오기'}
        </button>
      </div>
    </div>
  );
}
