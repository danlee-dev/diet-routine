'use client';
import { useState } from 'react';
import { DOW, fmt, hhmm, repMultiplier, ROUTINES, schedule, TARGETS, WEEK, workoutRounds, type RoutineKey } from '@diet/core';
import { todayView, workoutOn } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/client';
import { Icon } from '../Icon';

function RoutineList({ k, mult }: { k: RoutineKey; mult: number }) {
  return (
    <ul className="kv-list">
      {ROUTINES[k].items.map((x) => <li key={x.name}><span>{x.name}</span><span className="num">{Math.round(x.n * mult)}{x.unit}</span></li>)}
    </ul>
  );
}

export function Workout({ onStart }: { onStart: (k: RoutineKey) => void }) {
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
  const when = sch?.workout ? <p className="card-meta">추천 시간 {hhmm(sch.workout)}쯤 · 간식 1시간 뒤, 저녁 전</p> : null;
  const doneTag = doneName ? <span className="done-tag"><Icon name="check" size="sm" />오늘 {doneName} 완료</span> : null;
  const tIdx = Math.min(week, 4);

  let card: React.ReactNode;
  if (t === 'A' || t === 'B') {
    card = (
      <section className="card sq" aria-label="오늘 운동">
        <p className="card-k">오늘 · {DOW[dow]}요일</p>
        <h2 className="card-t">{ROUTINES[t].name}</h2>
        <p className="card-sub">{ROUTINES[t].focus} · {rounds}라운드 · 라운드 사이 60초 쉬기</p>
        {when}
        <RoutineList k={t} mult={mult} />
        <div className="card-acts">
          <button type="button" className="btn-primary pill" onClick={() => onStart(t)}><Icon name="play" size="sm" />{done ? '다시 하기' : '따라하기 시작'}</button>
          {doneTag}
        </div>
      </section>
    );
  } else if (t === 'light') {
    card = (
      <section className="card sq" aria-label="오늘 운동">
        <p className="card-k">오늘 · 토요일</p>
        <h2 className="card-t">A 또는 B 가볍게</h2>
        <p className="card-sub">둘 중 하나를 3라운드만 합니다. 피곤하면 걷기로 바꿔도 됩니다.</p>
        {when}
        <div className="card-acts">
          <button type="button" className="btn-primary pill" onClick={() => onStart('A')}><Icon name="play" size="sm" />A 시작</button>
          <button type="button" className="btn-ghost pill" onClick={() => onStart('B')}><Icon name="play" size="sm" />B 시작</button>
          {doneTag}
        </div>
      </section>
    );
  } else {
    card = (
      <section className="card sq" aria-label="오늘 운동">
        <p className="card-k">오늘 · {DOW[dow]}요일</p>
        <h2 className="card-t">{t === 'walk' ? '걷기만' : '쉬는 날'}</h2>
        <p className="card-sub">홈트는 쉬고 걸음 수 목표만 채웁니다. 프로틴은 간식 때 마십니다.</p>
        <div className="card-acts">
          <button type="button" className="btn-ghost pill" onClick={() => onStart(rt)}>그래도 할래요</button>
          {doneTag}
        </div>
      </section>
    );
  }

  return (
    <div className="two-col">
      <div className="col">
        {card}
        <section>
          <h2 className="section-title">이번 주</h2>
          <ol className="week" aria-label="요일별 운동">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <li key={d} className={d === dow ? 'is-today' : undefined} aria-current={d === dow ? 'date' : undefined}>
                <span>{DOW[d]}</span><b>{WEEK[d]!.label}</b>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h2 className="section-title">루틴 보기</h2>
          <div className="seg" role="group" aria-label="루틴 선택">
            <button type="button" aria-pressed={rt === 'A'} onClick={() => pick('A')}>A · 상체</button>
            <button type="button" aria-pressed={rt === 'B'} onClick={() => pick('B')}>B · 하체</button>
          </div>
          <RoutineList k={rt} mult={mult} />
          <button type="button" className="btn-ghost pill" style={{ marginTop: 12 }} onClick={() => onStart(rt)}><Icon name="play" size="sm" />{ROUTINES[rt].name} 따라하기</button>
          <p className="note" style={{ marginTop: 12 }}>1주차 3라운드, 2주차부터 4라운드, 3주차부터 횟수를 20% 늘립니다.</p>
        </section>
      </div>
      <div className="col">
        <section>
          <h2 className="section-title">하루 걸음 목표</h2>
          <p className="big num">{fmt(v.stepsGoal)}<small>보</small></p>
          <p className="note">오늘 {fmt(v.day.steps)}보 기록됨 · 1주 4,000보, 2주 5,500보, 3주부터 7,000보</p>
          <ul className="rule-list plain" style={{ marginTop: 14 }}>
            <li>밥 먹고 10분 걷습니다.</li>
            <li>차는 입구에서 먼 곳에 세웁니다.</li>
            <li>엘리베이터 대신 계단을 씁니다.</li>
            <li>비 오는 날은 영상 보면서 제자리 걷기를 합니다.</li>
          </ul>
        </section>
        <section>
          <h2 className="section-title">체중 목표</h2>
          <ul className="kv-list">
            {TARGETS.map((r, i) => (
              <li key={r.label} className={i === tIdx ? 'is-now' : undefined}><span>{r.label}{i === tIdx ? ' · 이번 주' : ''}</span><span className="num">{r.text}</span></li>
            ))}
          </ul>
          <p className="note" style={{ marginTop: 12 }}>목표보다 덜 빠지면 걸음 수를 1,500보 늘립니다. 그래도 안 빠지면 간식 견과를 귤 1개로 바꿉니다.</p>
        </section>
      </div>
    </div>
  );
}
