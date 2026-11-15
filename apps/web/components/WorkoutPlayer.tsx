'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  amrapOf, cueAmrapDone, cueAmrapMark, cueAmrapStart, cueCountdown, cueDone, cueHoldEnd, cueHoldStart, cueLap, cueMove, cueRest, cueRoundGo,
  pad, repMultiplier, workoutRounds, type RoutineKey,
} from '@diet/core';
import { completeWorkout, todayView, toggleMeal } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/client';
import { speak, stopSpeaking, voiceSupported } from '@/lib/voice';
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
  // spoken cues: the move and reps, 3-2-1 for holds and rests, minute marks of a time-boxed workout
  const [voice, setVoice] = useState(() => devicePref.get('workout.voice', true));
  const voiceRef = useRef(voice && open);
  useEffect(() => { voiceRef.current = voice && open; }, [voice, open]);
  const say = useCallback((text: string | null, interrupt = false) => { if (text && voiceRef.current) speak(text, interrupt); }, []);
  const [rounds] = useState(() => (v.session === 'light' ? 3 : workoutRounds(v.ctx.week)));
  const endRef = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lock = useRef<WakeLockSentinel | null>(null);
  const ac = useRef<AudioContext | null>(null);
  const startedAt = useRef<Date | null>(null);
  const onDoneRef = useRef<() => void>(() => {});

  const mult = repMultiplier(v.ctx.week);
  const rdef = v.routines[key];
  // time-boxed format: repeat the list for `min` minutes and count rounds
  const min = amrapOf(rdef);
  const [aPhase, setAPhase] = useState<'ready' | 'go' | 'paused' | 'done'>('ready');
  const [laps, setLaps] = useState(0);
  const lapsRef = useRef(0);
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

  // a new move (fixed rounds): name and reps, the round on its first move
  useEffect(() => {
    if (!open || min || phase !== 'work') return;
    say(cueMove(cur, { idx, total: items.length, round, rounds }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, min, phase, idx, round]);
  // last three seconds of a hold or a rest
  useEffect(() => {
    if (!open || min || (phase !== 'hold' && phase !== 'rest')) return;
    say(cueCountdown(left), true);
  }, [open, min, phase, left, say]);
  // minute marks while a time-boxed workout runs
  useEffect(() => {
    if (!open || !min || aPhase !== 'go') return;
    say(cueAmrapMark(left, min * 60) ?? cueCountdown(left), true);
  }, [open, min, aPhase, left, say]);
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => { if (!open) stopSpeaking(); }, [open]);

  const next = () => {
    stop();
    if (phase === 'hold') say(cueHoldEnd);
    if (idx < items.length - 1) { setIdx(idx + 1); setPhase('work'); }
    else if (round < rounds) {
      setPhase('rest');
      say(cueRest(60, items[0]));
      run(60, () => { say(cueRoundGo); setRound((r) => r + 1); setIdx(0); setPhase('work'); beep(); });
    } else {
      setPhase('done');
      completeWorkout(env, v.ctx.key, key, { rounds, startedAt: startedAt.current ?? new Date(), endedAt: new Date() });
      say(cueDone(rounds));
      beep();
    }
  };

  const finishAmrap = () => {
    stop();
    say(cueAmrapDone(lapsRef.current), true);
    setAPhase('done');
    completeWorkout(env, v.ctx.key, key, { rounds: lapsRef.current, startedAt: startedAt.current ?? new Date(), endedAt: new Date() });
    beep();
  };
  // one-minute warning while the clock runs
  const warned = useRef(false);
  useEffect(() => {
    if (min && aPhase === 'go' && left === 60 && !warned.current) { warned.current = true; beep(); }
  }, [min, aPhase, left, beep]);
  const mmss = (s: number) => `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;

  const nx = items[idx + 1] ?? (round < rounds ? { name: '쉬는 시간 60초', n: 0, unit: '' } : { name: '마지막 동작입니다', n: 0, unit: '' });
  const postDone = v.eaten.has('post');
  const steps = <div className="wo-steps" aria-hidden="true">{items.map((_, i) => <span key={i} className={i < idx || (i === idx && phase !== 'work') ? 'on' : ''} />)}</div>;

  let body: React.ReactNode;
  let foot: React.ReactNode;
  if (min) {
    const clock = aPhase === 'ready' ? min * 60 : left;
    const list = <ul className="amrap-list">{rdef.items.map((x) => <li key={x.name}><span>{x.name}</span><b className="num">{x.n}{x.unit}</b></li>)}</ul>;
    if (aPhase === 'done') {
      body = <><p className="eyebrow">{min}분 끝</p><p className="wo-n">{laps}<small>바퀴</small></p><p className="wo-next">{rdef.items.map((x) => `${x.name} ${x.n * laps}${x.unit}`).join(' · ')}<br />다음에는 {laps + 1}바퀴가 목표입니다.{postDone ? '' : ' 이제 프로틴을 마실 차례입니다.'}</p></>;
      foot = postDone ? <button type="button" className="btn-primary pill" onClick={onClose}>닫기</button> : (
        <>
          <button type="button" className="btn-primary pill" onClick={() => { const r = toggleMeal(env, v.ctx.key, 'post'); onClose(); if (r.added) toast('운동 후 먹음 표시', r.undo); }}><Icon name="check" />프로틴 먹음 표시하고 닫기</button>
          <div className="row"><button type="button" className="btn-ghost pill" onClick={onClose}>그냥 닫기</button></div>
        </>
      );
    } else {
      body = <><p className={`wo-clock num${aPhase === 'paused' ? ' is-paused' : ''}`}>{mmss(clock)}</p>{list}{aPhase !== 'ready' && <p className="wo-n">{laps}<small>바퀴</small></p>}</>;
      foot = aPhase === 'ready'
        ? <button type="button" className="btn-primary pill" onClick={() => { startedAt.current = new Date(); say(cueAmrapStart(min, rdef.items)); setAPhase('go'); run(min * 60, finishAmrap); }}><Icon name="play" />{min}분 시작</button>
        : aPhase === 'go'
          ? <><button type="button" className="btn-primary pill wo-lap" onClick={() => { lapsRef.current += 1; setLaps(lapsRef.current); say(cueLap(lapsRef.current), true); try { navigator.vibrate?.(60); } catch { /* not supported */ } }}><Icon name="check" />한 바퀴 끝</button>
              <div className="row"><button type="button" className="btn-ghost pill" onClick={() => { stop(); setAPhase('paused'); }}>잠깐 멈춤</button><button type="button" className="btn-ghost pill" onClick={finishAmrap}>여기서 끝내기</button></div></>
          : <div className="row"><button type="button" className="btn-primary pill" style={{ width: 'auto', height: 44, fontSize: 15 }} onClick={() => { setAPhase('go'); run(left, finishAmrap); }}><Icon name="play" />계속</button><button type="button" className="btn-ghost pill" onClick={finishAmrap}>여기서 끝내기</button></div>;
    }
  } else if (phase === 'work') {
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
        <button type="button" className="btn-primary pill" onClick={() => { setPhase('hold'); say(cueHoldStart(cur), true); run(cur.n, () => { beep(); next(); }); }}><Icon name="timer" />{cur.n}초 타이머 시작</button>
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
        <button type="button" className="btn-primary pill" style={{ width: 'auto', height: 44, fontSize: 15 }} onClick={() => { stop(); stopSpeaking(); setRound((r) => r + 1); setIdx(0); setPhase('work'); }}><Icon name="skip-forward" />바로 시작</button>
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
            <span className="t">{rdef.name} · {min ? `${min}분 동안 반복` : phase === 'done' ? '완료' : `라운드 ${round}/${rounds}`}</span>
            <div className="acts">
              {voiceSupported() && (
                <button type="button" className="wo-voice" aria-pressed={voice} aria-label={voice ? '음성 안내 끄기' : '음성 안내 켜기'} onClick={() => { const x = !voice; setVoice(x); devicePref.set('workout.voice', x); if (!x) stopSpeaking(); }}>
                  음성 {voice ? '켬' : '끔'}
                </button>
              )}
              <button type="button" className="icon-btn" aria-label={sound ? '소리 끄기' : '소리 켜기'} onClick={() => { const s = !sound; setSound(s); devicePref.set('sound', s); }}><Icon name={sound ? 'volume-2' : 'volume-x'} /></button>
              <button type="button" className="icon-btn" aria-label="닫기" onClick={onClose}><Icon name="x" /></button>
            </div>
          </div>
          <div key={min ? `amrap-${aPhase}` : `${phase}-${idx}-${round}`} className="wo-body enter">{body}</div>
          <div className="wo-foot">{foot}</div>
        </>
      )}
    </div>
  );
}
