'use client';
// Settings: account and sync, the program numbers, the rules that never change, legacy import and the app version.
// Opened from the person button (top bar on wide screens, page title row on the phone) and from ⌘K.
import { useRef, useState } from 'react';
import { addDays, dateLabel, fmt, parseKey } from '@diet/core';
import { profileOf, todayView, type SyncState } from '@diet/data';
import { useAuth, useEnv, useFlow } from '@/lib/hooks';
import { APP_VERSION, authStore, getSupabase, signInWithGoogle, signOut } from '@/lib/client';
import { Icon } from './Icon';
import { SheetHead, useOverlay } from './ui';
import { ImportSheet } from './sheets';

const SYNC_TEXT: Record<SyncState, string> = {
  local: '이 기기에만 저장 중입니다',
  syncing: '기록을 맞추는 중입니다',
  synced: '웹과 아이폰이 같은 기록을 봅니다',
  offline: '오프라인입니다. 연결되면 올립니다',
  error: '동기화하지 못했습니다',
};

/** Google's four-color G, as required next to "Google로 계속하기". */
function GoogleMark() {
  return (
    <svg className="g-mark" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Six digit cells over one real input, so paste and one-time-code autofill still work. */
function CodeField({ value, onChange, onDone }: { value: string; onChange: (v: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className="code-field" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        id="otp-code"
        value={value}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="메일로 받은 6자리 코드"
        maxLength={6}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
        onKeyDown={(e) => { if (e.key === 'Enter' && value.length === 6) { e.preventDefault(); onDone(); } }}
      />
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={`cell sq${i === Math.min(value.length, 5) ? ' at' : ''}`} aria-hidden="true">{value[i] ?? ''}</span>
      ))}
    </label>
  );
}

function EmailSignIn() {
  const supa = getSupabase()!;
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const addr = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(addr)) { setMsg('이메일 주소를 확인해 주세요'); return; }
    setBusy(true);
    const { error } = await supa.auth.signInWithOtp({ email: addr, options: { emailRedirectTo: location.origin } });
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setStep('code');
    setMsg('');
    setTimeout(() => document.getElementById('otp-code')?.focus(), 30);
  };
  const verify = async () => {
    if (code.length !== 6) return;
    setBusy(true);
    const { data, error } = await supa.auth.verifyOtp({ email: email.trim(), token: code, type: 'email' });
    setBusy(false);
    // startAuth() attaches sync from the SIGNED_IN event; here only report failures
    if (error || !data.user) setMsg(error?.message ?? '코드가 맞지 않습니다');
  };

  return (
    <div className="email-in">
      {step === 'email' ? (
        <div className="inline-form">
          <input
            className="input sq"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="이메일 주소"
            aria-label="이메일 주소"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
          />
          <button type="button" className="btn-ghost pill" disabled={busy} onClick={() => void send()}>코드 받기</button>
        </div>
      ) : (
        <>
          <p className="s-lead code-lead">메일로 받은 6자리 코드를 입력합니다<b>{email.trim()}</b></p>
          <CodeField value={code} onChange={setCode} onDone={() => void verify()} />
          <div className="inline-acts">
            <button type="button" className="link-btn" onClick={() => { setStep('email'); setCode(''); setMsg(''); }}>주소 바꾸기</button>
            <button type="button" className="btn-primary pill" disabled={busy || code.length !== 6} onClick={() => void verify()}>로그인</button>
          </div>
        </>
      )}
      <p className="form-msg" aria-live="polite">{msg}</p>
    </div>
  );
}

/** Google first, email code as the quieter fallback. Used in Settings and on the welcome screen. */
export function SignInOptions() {
  const auth = useAuth();
  const [emailOpen, setEmailOpen] = useState(false);
  const [msg, setMsg] = useState('');
  return (
    <>
      {auth.error && (
        <p className="s-error" role="alert">
          로그인하지 못했습니다. 다시 시도해 주세요.<span>{auth.error}</span>
        </p>
      )}
      <button
        type="button"
        className="g-btn pill"
        onClick={async () => {
          authStore.clearError();
          setMsg('Google로 이동합니다');
          const err = await signInWithGoogle();
          if (err) setMsg(err);
        }}
      >
        <GoogleMark />Google로 계속하기
      </button>
      {msg && <p className="form-msg" role="status">{msg}</p>}
      {emailOpen
        ? <EmailSignIn />
        : <button type="button" className="link-btn s-quiet" onClick={() => { authStore.clearError(); setMsg(''); setEmailOpen(true); }}><Icon name="mail" size="sm" />이메일 코드로 로그인</button>}
    </>
  );
}

function Account() {
  const env = useEnv();
  const auth = useAuth();
  const supa = getSupabase();

  if (!supa) {
    return <p className="s-lead">기록은 이 브라우저에 저장되고 있습니다. 동기화 서버가 연결되면 여기서 로그인합니다.</p>;
  }
  if (!auth.ready) return <p className="s-lead">로그인 상태를 확인하고 있습니다</p>;

  if (auth.user) {
    const st = env.store.syncState;
    const pending = env.store.pendingCount();
    return (
      <>
        <dl className="s-rows">
          <div><dt>계정</dt><dd className="ellip">{auth.user.email ?? 'Google 계정'}</dd></div>
          <div><dt>동기화</dt><dd>{SYNC_TEXT[st]}</dd></div>
          <div><dt>올릴 기록</dt><dd className="num">{pending ? `${fmt(pending)}개` : '없음'}</dd></div>
          {env.store.lastError && <div><dt>마지막 오류</dt><dd className="err">{env.store.lastError}</dd></div>}
        </dl>
        <div className="s-acts">
          {(st === 'error' || st === 'offline') && (
            <button type="button" className="btn-ghost pill" onClick={() => void env.store.attach(supa, auth.user!.id)}>
              <Icon name="rotate-ccw" size="sm" />다시 맞추기
            </button>
          )}
          <button type="button" className="btn-ghost pill" onClick={() => void signOut(env)}><Icon name="log-out" size="sm" />로그아웃</button>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="s-lead">로그인하면 웹과 아이폰이 같은 기록을 봅니다. 지금 이 기기에 있는 기록은 로그인하면 그대로 올라갑니다.</p>
      <SignInOptions />
    </>
  );
}

function Program() {
  const env = useEnv();
  const P = env.program;
  const name = profileOf(env.store)?.display_name;
  const start = parseKey(P.startDate);
  const end = addDays(start, P.days - 1);
  return (
    <dl className="s-rows">
      {name && <div><dt>이름</dt><dd className="ellip">{name}</dd></div>}
      <div><dt>시작일</dt><dd>{start.getFullYear()}년 {dateLabel(start)}</dd></div>
      <div><dt>기간</dt><dd>{P.days}일 · {dateLabel(end)}까지</dd></div>
      <div><dt>시작 체중</dt><dd className="num">{P.startWeight.toFixed(1)}kg</dd></div>
      <div><dt>목표 체중</dt><dd className="num">{P.goalWeight.toFixed(1)}kg</dd></div>
      <div><dt>키</dt><dd className="num">{P.heightCm}cm</dd></div>
      <div><dt>하루 기본 칼로리</dt><dd className="num">{fmt(P.baseKcal)}kcal</dd></div>
      <div><dt>단백질 하한</dt><dd className="num">{P.proteinFloor}g</dd></div>
    </dl>
  );
}

export function SettingsSheet() {
  const { open, close } = useOverlay();
  const env = useEnv();
  const { redoOnboarding } = useFlow();
  const rules = todayView(env).rules;
  return (
    <div className="settings">
      <SheetHead eyebrow="다루" title="설정" />

      <section aria-labelledby="s-account">
        <h3 className="s-h" id="s-account">계정과 동기화</h3>
        <Account />
      </section>

      <section aria-labelledby="s-program">
        <h3 className="s-h" id="s-program">내 프로그램</h3>
        <Program />
        <button type="button" className="btn-ghost pill" onClick={() => { close(); redoOnboarding(); }}>
          <Icon name="rotate-ccw" size="sm" />내 정보 다시 입력
        </button>
        <p className="note" style={{ marginTop: 8 }}>답을 바꾸면 식단, 운동, 장보기 목록을 다시 만듭니다. 지금까지의 기록은 그대로 둡니다.</p>
      </section>

      <section aria-labelledby="s-keep">
        <h3 className="s-h" id="s-keep">항상 지키는 것</h3>
        <ul className="s-keep">
          {rules.map((k) => (
            <li key={k.title}><Icon name={k.icon} /><div><b>{k.title}</b><span>{k.desc}</span></div></li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="s-legacy">
        <h3 className="s-h" id="s-legacy">예전 기록</h3>
        <p className="s-lead">예전 사이트의 기록 탭에서 복사한 백업 코드를 붙여넣어 옮깁니다.</p>
        <button type="button" className="btn-ghost pill" onClick={() => open(<ImportSheet />, { focus: 'textarea' })}>
          <Icon name="clipboard-paste" size="sm" />백업 코드 가져오기
        </button>
      </section>

      <section aria-labelledby="s-app">
        <h3 className="s-h" id="s-app">앱 정보</h3>
        <dl className="s-rows">
          <div><dt>버전</dt><dd className="num">{APP_VERSION}</dd></div>
        </dl>
      </section>
    </div>
  );
}

/** The person button: initial when signed in, an outline figure when not. */
export function AccountButton({ className }: { className?: string }) {
  const auth = useAuth();
  const { open } = useOverlay();
  const initial = auth.user?.email?.[0]?.toUpperCase();
  return (
    <button
      type="button"
      className={`avatar${auth.user ? ' is-in' : ''}${className ? ` ${className}` : ''}`}
      aria-label={auth.user ? `설정 · ${auth.user.email ?? '로그인됨'}` : '설정 · 로그인 전'}
      onClick={() => open(<SettingsSheet />)}
    >
      {initial ? <span aria-hidden="true">{initial}</span> : <Icon name="user-round" />}
    </button>
  );
}
