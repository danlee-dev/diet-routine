'use client';
import { useState } from 'react';
import { DOW, fmt, hhmm, repMultiplier, ROUTINES, schedule, TARGETS, WEEK, workoutRounds, type RoutineKey } from '@diet/core';
import { todayView, workoutOn } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/client';
import { Icon } from '../Icon';

function RoutineList({ k, mult }: { k: RoutineKey; mult: number }) {
  return (
    <ul className="routine">
      {ROUTINES[k].items.map((x) => <li key={x.name}><span>{x.name}</span><span className="amt num">{Math.round(x.n * mult)}{x.unit}</span></li>)}
    </ul>
  );
}

export function Workout({ onStart, embedded }: { onStart: (k: RoutineKey) => void; embedded?: boolean }) {
  const env = useEnv();
  const v = todayView(env);
  const { dow, week } = v.ctx;
  const t = WEEK[dow]!.t;
  const done = workoutOn(env, v.ctx.key);
  const doneName = done ? (done.type === 'home_a' ? ROUTINES.A.name : done.type === 'home_b' ? ROUTINES.B.name : '운동') : null;
  const sch = schedule(v.day.wake_min);
  const mult = repMultiplier(week);
  const rounds = workoutRounds(week);
  const [rt, setRt] = useState<RoutineKey>(() => devicePref.get<RoutineKey>('routine', t === 'B' ? 'B' : 'A'));
  const pick = (k: RoutineKey) => { setRt(k); devicePref.set('routine', k); };
  const when = sch?.workout ? <p className="hint" style={{ marginTop: 4 }}>추천 시간 {hhmm(sch.workout)}쯤 · 간식 1시간 뒤, 저녁 전</p> : null;
  const doneTag = doneName ? <span className="done-tag"><Icon name="check" />오늘 {doneName} 완료</span> : null;
  const tIdx = Math.min(week, 4);

  let card: React.ReactNode;
  if (t === 'A' || t === 'B') {
    card = (
      <div className="box sq">
        <p className="eyebrow">오늘 · {DOW[dow]}요일</p>
        <h2 className="now-title" style={{ fontSize: 32, margin: '4px 0 2px' }}>{ROUTINES[t].name}</h2>
        <p className="page-sub">{ROUTINES[t].focus} · {rounds}라운드 · 라운드 사이 60초 쉬기</p>{when}
        <div style={{ marginTop: 12 }}><RoutineList k={t} mult={mult} /></div>
        <div className="row" style={{ marginTop: 14 }}>{doneTag}<button type="button" className="btn-primary pill" style={{ marginLeft: 'auto' }} onClick={() => onStart(t)}><Icon name="play" />{done ? '다시 하기' : '따라하기 시작'}</button></div>
      </div>
    );
  } else if (t === 'light') {
    card = (
      <div className="box sq">
        <p className="eyebrow">오늘 · 토요일</p>
        <h2 className="now-title" style={{ fontSize: 32, margin: '4px 0 2px' }}>A 또는 B 가볍게</h2>
        <p className="page-sub">둘 중 하나를 3라운드만 합니다. 피곤하면 걷기로 바꿔도 됩니다.</p>{when}
        <div className="row" style={{ marginTop: 14 }}>{doneTag}
          <button type="button" className="btn-primary pill" onClick={() => onStart('A')}><Icon name="play" />A 시작</button>
          <button type="button" className="btn-primary pill" onClick={() => onStart('B')}><Icon name="play" />B 시작</button>
        </div>
      </div>
    );
  } else {
    card = (
      <div className="box sq">
        <p className="eyebrow">오늘 · {DOW[dow]}요일</p>
        <h2 className="now-title" style={{ fontSize: 32, margin: '4px 0 2px' }}>{t === 'walk' ? '걷기만' : '쉬는 날'}</h2>
        <p className="page-sub">홈트는 쉬고 걸음 수 목표만 채웁니다. 프로틴은 간식 때 마십니다.</p>
        <div className="row" style={{ marginTop: 14 }}>{doneTag}<button type="button" className="btn-ghost pill" style={{ marginLeft: 'auto' }} onClick={() => onStart(rt)}>그래도 할래요</button></div>
      </div>
    );
  }

  return (
    <>
      {!embedded && <div className="page-head">
        <span className="eyebrow">운동 · {week}주차</span>
        <h1 className="page-title">집에서 하는 운동</h1>
        <p className="page-sub">1주차 3라운드, 2주차부터 4라운드, 3주차부터 횟수를 20% 늘립니다.</p>
      </div>}
      <div className="wo-grid">
        <div className="col">
          {card}
          <div className="box sq">
            <p className="eyebrow" style={{ marginBottom: 10 }}>이번 주</p>
            <div className="week">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => <div key={d} className={`day sq${d === dow ? ' is-today' : ''}`}><span>{DOW[d]}</span><b>{WEEK[d]!.label}</b></div>)}
            </div>
          </div>
          <div className="box sq">
            <div className="seg" role="group" aria-label="루틴 선택" style={{ marginBottom: 8 }}>
              <button type="button" aria-pressed={rt === 'A'} onClick={() => pick('A')}>홈트 A · 상체</button>
              <button type="button" aria-pressed={rt === 'B'} onClick={() => pick('B')}>홈트 B · 하체</button>
            </div>
            <RoutineList k={rt} mult={mult} />
            <button type="button" className="btn-ghost pill" style={{ marginTop: 12 }} onClick={() => onStart(rt)}><Icon name="play" />{ROUTINES[rt].name} 따라하기</button>
          </div>
        </div>
        <div className="col">
          <div className="box sq">
            <p className="eyebrow">하루 걸음 목표</p>
            <p className="big num" style={{ margin: '10px 0 6px' }}>{fmt(v.stepsGoal)}<small>보</small></p>
            <p className="note" style={{ marginBottom: 14 }}>오늘 {fmt(v.day.steps)}보 기록됨 · 원래 하루 평균 1,500보</p>
            <ul className="rules">
              <li><Icon name="footprints" />밥 먹고 10분 걷습니다.</li>
              <li><Icon name="car" />차는 입구에서 먼 곳에 세웁니다.</li>
              <li><Icon name="building-2" />엘리베이터 대신 계단을 씁니다.</li>
              <li><Icon name="tv" />비 오는 날은 영상 보면서 제자리 걷기를 합니다.</li>
            </ul>
            <p className="note" style={{ marginTop: 12 }}>1주 4,000보 → 2주 5,500보 → 3주부터 7,000보</p>
          </div>
          <div className="box sq">
            <p className="eyebrow" style={{ marginBottom: 8 }}>체중 목표</p>
            <ul className="routine">
              {TARGETS.map((r, i) => (
                <li key={r.label} style={i === tIdx ? { fontWeight: 600 } : undefined}><span>{r.label}{i === tIdx ? ' · 이번 주' : ''}</span><span className="num">{r.text}</span></li>
              ))}
            </ul>
            <ul className="rules dots" style={{ marginTop: 14 }}><li>목표보다 덜 빠지면 걸음 수를 1,500보 늘립니다.</li><li>그래도 안 빠지면 간식 견과를 귤 1개로 바꿉니다.</li></ul>
          </div>
        </div>
      </div>
    </>
  );
}
