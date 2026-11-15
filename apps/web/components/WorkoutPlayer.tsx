'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { repMultiplier, workoutRounds, type RoutineKey } from '@diet/core';
import { completeWorkout, todayView, toggleMeal } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/client';
import { Icon } from './Icon';
import { useOverlay } from './ui';

type Phase = 'work' | 'hold' | 'rest' | 'done';
const C = 2 * Math.PI * 104;

function Ring({ left, total }: { left: number; total: number }) {
  return (
    <svg className="ring" viewBox="0 0 240 240" aria-hidden="true">
      <circle className="bg" cx="120" cy="120" r="104" />
      <circle className="fg" cx="120" cy="120" r="104" strokeDasharray={C.toFixed(1)} strokeDashoffset={(C * (1 - (total ? left / total : 0))).toFixed(1)} transform="rotate(-90 120 120)" />
      <text x="120" y="142" textAnchor="middle">{left}</text>
    </svg>
  );
}

/** Mount with a new `key` for every start so state initializes from props; keep it mounted after close for the slide-out. */
export function WorkoutPlayer({ routine, onClose }: { routine: RoutineKey | null; onClose: () => void }) {
  const env = useEnv();
  const { toast } = useOverlay();
  const v = todayView(env);
  const open = routine != null;
  const [key] = useState<RoutineKey>(() => routine ?? 'A');
  const [round, setRound] = useState(1);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('work');
  const [left, setLeft] = useState(0);
  const [total, setTotal] = useState(0);
  const [sound, setSound] = useState(() => devicePref.get('sound', true));
  const [rounds] = useState(() => (v.session === 'light' ? 3 : workoutRounds(v.ctx.week)));
  const endRef = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lock = useRef<WakeLockSentinel | null>(null);
  const ac = useRef<AudioContext | null>(null);
  const startedAt = useRef<Date | null>(null);
  const onDoneRef = useRef<() => void>(() => {});

  const mult = repMultiplier(v.ctx.week);
  const rdef = v.routines[key];
  const items = rdef.items.map((x) => ({ ...x, n: Math.round(x.n * mult) }));
  const cur = items[idx]!;

  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  const beep = useCallback(() => {
    try { navigator.vibrate?.([120, 80, 120]); } catch { /* not supported */ }
    if (!sound || !ac.current) return;
    try {
      const a = ac.current;
      for (const t0 of [0, 0.22]) {
        const o = a.createOscillator(), g = a.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, a.currentTime + t0);
        g.gain.exponentialRampToValueAtTime(0.22, a.currentTime + t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + t0 + 0.18);
        o.connect(g); g.connect(a.destination); o.start(a.currentTime + t0); o.stop(a.currentTime + t0 + 0.2);
      }
    } catch { /* audio blocked */ }
  }, [sound]);

  const run = useCallback((secs: number, done: () => void) => {
    if (timer.current) clearInterval(timer.current);
    setLeft(secs); setTotal(secs);
    endRef.current = Date.now() + secs * 1000;
    onDoneRef.current = done;
    timer.current = setInterval(() => {
      const l = Math.max(0, Math.ceil((endRef.current - Date.now()) / 1000));
      setLeft(l);
      if (l <= 0) { if (timer.current) clearInterval(timer.current); timer.current = null; onDoneRef.current(); }
    }, 200);
  }, []);

  // external systems while open: audio, screen wake lock
  useEffect(() => {
    if (!open) return;
    startedAt.current = new Date();
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!ac.current && AC) ac.current = new AC();
      void ac.current?.resume();
    } catch { /* ignore */ }
    const req = async () => { try { lock.current = await navigator.wakeLock?.request('screen'); } catch { /* ignore */ } };
    void req();
    const vis = () => { if (!document.hidden && !lock.current) void req(); };
    document.addEventListener('visibilitychange', vis);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', vis);
      void lock.current?.release().catch(() => {});
      lock.current = null;
    };
  }, [open]);

  const next = () => {
    stop();
    if (idx < items.length - 1) { setIdx(idx + 1); setPhase('work'); }
    else if (round < rounds) {
      setPhase('rest');
      run(60, () => { setRound((r) => r + 1); setIdx(0); setPhase('work'); beep(); });
    } else {
      setPhase('done');
      completeWorkout(env, v.ctx.key, key, { rounds, startedAt: startedAt.current ?? new Date(), endedAt: new Date() });
      beep();
    }
  };

  const nx = items[idx + 1] ?? (round < rounds ? { name: '쉬는 시간 60초', n: 0, unit: '' } : { name: '마지막 동작입니다', n: 0, unit: '' });
  const postDone = v.eaten.has('post');
  const steps = <div className="wo-steps" aria-hidden="true">{items.map((_, i) => <span key={i} className={i < idx || (i === idx && phase !== 'work') ? 'on' : ''} />)}</div>;

  let body: React.ReactNode;
  let foot: React.ReactNode;
  if (phase === 'work') {
    body = (
      <>
        {steps}
        <p className="eyebrow" style={{ marginTop: 14 }}>{idx + 1} / {items.length}</p>
        <p className="wo-name">{cur.name}</p>
        <p className="wo-n">{cur.n}<small>{cur.unit}</small></p>
        <p className="wo-next">다음: {nx.name}{nx.n ? ` ${nx.n}${nx.unit}` : ''}</p>
      </>
    );
    foot = cur.unit === '초' ? (
      <>
        <button type="button" className="btn-primary pill" onClick={() => { setPhase('hold'); run(cur.n, () => { beep(); next(); }); }}><Icon name="timer" />{cur.n}초 타이머 시작</button>
        <div className="row"><button type="button" className="btn-ghost pill" onClick={next}>타이머 없이 완료</button>{idx > 0 && <button type="button" className="btn-ghost pill" onClick={() => { stop(); setIdx(idx - 1); setPhase('work'); }}>이전</button>}</div>
      </>
    ) : (
      <>
        <button type="button" className="btn-primary pill" onClick={next}><Icon name="check" />{cur.n}{cur.unit.replace(' (양쪽)', '')} 했어요</button>
        {idx > 0 && <div className="row"><button type="button" className="btn-ghost pill" onClick={() => { stop(); setIdx(idx - 1); setPhase('work'); }}>이전</button></div>}
      </>
    );
  } else if (phase === 'hold') {
    body = <>{steps}<p className="wo-name" style={{ fontSize: 32 }}>{cur.name}</p><Ring left={left} total={total} /><p className="wo-next">자세를 유지합니다</p></>;
    foot = <button type="button" className="btn-primary pill" onClick={next}><Icon name="check" />끝났어요</button>;
  } else if (phase === 'rest') {
    body = <><p className="eyebrow">쉬는 시간</p><Ring left={left} total={total} /><p className="wo-next">다음 라운드: {items[0]!.name} {items[0]!.n}{items[0]!.unit}</p></>;
    foot = (
      <div className="row">
        <button type="button" className="btn-ghost pill" onClick={() => { endRef.current += 15000; setLeft((l) => l + 15); setTotal((t) => t + 15); }}>+15초</button>
        <button type="button" className="btn-primary pill" style={{ width: 'auto', height: 44, fontSize: 15 }} onClick={() => { stop(); setRound((r) => r + 1); setIdx(0); setPhase('work'); }}><Icon name="skip-forward" />바로 시작</button>
      </div>
    );
  } else {
    body = <><p className="eyebrow">오늘 홈트 끝</p><p className="wo-name">잘했습니다</p><p className="wo-next">{rdef.name} {rounds}라운드를 마쳤습니다.{postDone ? '' : ' 이제 프로틴 + 우유를 마실 차례입니다.'}</p></>;
    foot = postDone ? <button type="button" className="btn-primary pill" onClick={onClose}>닫기</button> : (
      <>
        <button type="button" className="btn-primary pill" onClick={() => { const r = toggleMeal(env, v.ctx.key, 'post'); onClose(); if (r.added) toast('운동 후 먹음 표시', r.undo); }}><Icon name="check" />프로틴 먹음 표시하고 닫기</button>
        <div className="row"><button type="button" className="btn-ghost pill" onClick={onClose}>그냥 닫기</button></div>
      </>
    );
  }

  return (
    <div className={`wo sq${open ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label="홈트">
      {(
        <>
          <div className="wo-head">
            <span className="t">{rdef.name} · {phase === 'done' ? '완료' : `라운드 ${round}/${rounds}`}</span>
            <div className="acts">
              <button type="button" className="icon-btn" aria-label={sound ? '소리 끄기' : '소리 켜기'} onClick={() => { const s = !sound; setSound(s); devicePref.set('sound', s); }}><Icon name={sound ? 'volume-2' : 'volume-x'} /></button>
              <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}><Icon name="x" /></button>
            </div>
          </div>
          <div key={`${phase}-${idx}-${round}`} className="wo-body enter">{body}</div>
          <div className="wo-foot">{foot}</div>
        </>
      )}
    </div>
  );
}
