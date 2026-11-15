'use client';
// AI coach panel: right-side panel on tablet/desktop, full-screen sheet on phones.
// Steps stream in as lines, the answer streams as text, change cards are applied only on 적용.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronLeft, ImagePlus, RotateCcw, Square, X } from 'lucide-react';
import { fmt } from '@diet/core';
import { coachSnapshot } from '@diet/data';
import { suggestedPrompts, turnSeconds, type AssistantTurn, type ChatThreadRow, type CoachCard, type CoachStep, type TurnPart } from '@diet/core/coach';
import { useEnv } from '@/lib/hooks';
import { useOverlay } from '../ui';
import { SettingsSheet } from '../Settings';
import { Icon } from '../Icon';
import { prepareImage, type PreparedImage } from './image';
import { useCoachChat } from './useCoachChat';
import { TrendCard } from './TrendCard';
import s from './coach.module.css';

const KIND: Record<CoachCard['kind'], string> = {
  log_food: '기록', plan_change: '식단표', day_adjustment: '오늘만', rebalance: '다시 맞추기', skip_meal: '건너뛰기', workout: '운동', shop: '장보기', event: '약속',
};

/** "14:05" today, "어제", otherwise "11월 9일". */
function whenText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (diff === 1) return '어제';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}
const SLOT_NAME: Record<string, string> = { breakfast: '아침', lunch: '점심', snack: '간식', post: '운동 후', dinner: '저녁' };
const ICON = { size: 18, strokeWidth: 1.9, 'aria-hidden': true } as const;
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** Top-bar entry. */
export function CoachButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="kbtn" aria-label="코치" onClick={onClick}><Icon name="message-circle" size="sm" /><span className="kl">코치</span></button>;
}

/**
 * "보기": go to the screen a card changed and briefly outline the changed row.
 * Targets: plan:meal:<key>, plan:workout:week:<dow>, plan:workout:routine:<A|B>, today:meal:<key>, today:workout.
 * Screens mark rows with data-coach-target="<target>"; the today timeline also works without it (data-slot or meal name).
 */
function openTarget(target: string, flash: string) {
  const view = target.startsWith('plan:') ? 'plan' : 'today';
  if (location.hash.slice(1) !== view) location.hash = view;
  window.dispatchEvent(new CustomEvent('coach:focus', { detail: { target } }));
  const find = (): Element | null => {
    const marked = document.querySelector(`[data-coach-target="${CSS.escape(target)}"]`);
    if (marked) return marked;
    if (target === 'today:workout') return document.querySelector('.tl-item.k-workout');
    const meal = /^today:meal:(\w+)$/.exec(target)?.[1];
    if (!meal || meal === 'extra') return null;
    const exact = document.querySelector(`[data-slot="${meal}"]`);
    if (exact) return exact;
    const name = SLOT_NAME[meal]!;
    return Array.from(document.querySelectorAll('.tl-item')).find((el) => el.querySelector('.tl-main')?.textContent?.trim().startsWith(name)) ?? null;
  };
  let tries = 0;
  const tick = () => {
    const el = find();
    if (!el) { if (++tries < 20) setTimeout(tick, 60); return; }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    el.classList.remove(flash);
    void (el as HTMLElement).offsetWidth;
    el.classList.add(flash);
    setTimeout(() => el.classList.remove(flash), 2200);
  };
  setTimeout(tick, 80);
}

export function CoachPanel({ open, onOpen, onClose }: { open: boolean; onOpen: () => void; onClose: () => void }) {
  const env = useEnv();
  const overlay = useOverlay();
  const chat = useCoachChat(env);
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const stick = useRef(true);

  // recomputed only when the store changes, not on every streamed token
  const version = env.store.getVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const snap = useMemo(() => coachSnapshot(env), [env, version]);
  // applied here or on another device (the card's rows are in the store)
  const applied = new Set(chat.turns.flatMap((t) => (t.role === 'assistant' ? t.parts : [])).flatMap((p) => (p.kind === 'card' && chat.isApplied(p.card, p.state) ? [p.card.id] : [])));
  const next = snap.meals.find((m) => m.state === 'pending');
  const prompts = suggestedPrompts(next ? { key: next.key, name: next.name } : undefined, Number(snap.now.time.slice(0, 2)));

  // other entry points open the panel with window.dispatchEvent(new Event('coach:open')); the today screen's
  // "코치가 바꿈" tag passes { detail: { messageId } } to open the conversation that made the change
  const { openByMessage, refresh } = chat;
  useEffect(() => {
    const on = (e: Event) => {
      onOpen();
      const detail = (e as CustomEvent<{ messageId?: string | null } | undefined>).detail;
      if (detail && 'messageId' in detail) { setListOpen(false); openByMessage(detail.messageId ?? null); }
    };
    window.addEventListener('coach:open', on);
    return () => window.removeEventListener('coach:open', on);
  }, [onOpen, openByMessage]);

  // opening the panel picks up the conversation as saved (it may have continued on the phone)
  useEffect(() => { if (open) refresh(); }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => input.current?.focus({ preventScroll: true }), 120);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !overlay.isOpen) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(id); document.removeEventListener('keydown', onKey); };
  }, [open, onClose, overlay.isOpen]);

  // keep the newest content in view while streaming, unless the reader scrolled up
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat.turns]);

  const autosize = () => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(160, el.scrollHeight)}px`;
  };

  const attach = async (files: FileList | File[]) => {
    setAttachError(null);
    const list = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 3 - images.length);
    try {
      const prepared = await Promise.all(list.map(prepareImage));
      setImages((cur) => [...cur, ...prepared].slice(0, 3));
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : '사진을 읽지 못했습니다');
    }
  };

  const submit = (text = draft) => {
    if (chat.busy || (!text.trim() && !images.length)) return;
    stick.current = true;
    void chat.send(text, images);
    setDraft('');
    setImages([]);
    requestAnimationFrame(autosize);
  };

  const view = (target: string) => { onClose(); openTarget(target, s.flash!); };
  const login = () => { onClose(); overlay.open(<SettingsSheet />); };

  return (
    <>
      <div className={`${s.scrim}${open ? ` ${s.open}` : ''}`} onClick={onClose} aria-hidden="true" />
      <aside
        className={`${s.panel} sq${open ? ` ${s.open}` : ''}`}
        aria-label="코치"
        aria-hidden={!open}
        inert={!open}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); void attach(e.dataTransfer.files); }}
      >
        <header className={s.head}>
          <div>
            <h2 className={s.title}>코치</h2>
            <p className={s.sub}>
              <span className="num">{fmt(snap.totals.eatenKcal)}</span> / <span className="num">{fmt(snap.target.kcal)}</span>kcal 먹음 · 단백질 <span className="num">{snap.totals.eatenProtein}</span>g
            </p>
          </div>
          <div className={s.headActs}>
            {listOpen
              ? <button type="button" className={s.textBtn} onClick={() => setListOpen(false)}><ChevronLeft size={16} aria-hidden />돌아가기</button>
              : chat.threads.length > 0 && <button type="button" className={s.textBtn} onClick={() => setListOpen(true)}>대화 목록</button>}
            {!listOpen && chat.turns.length > 0 && <button type="button" className={s.textBtn} onClick={chat.reset}>새 대화</button>}
            <button type="button" className="icon-btn" aria-label="코치 닫기" onClick={onClose}><X {...ICON} className="lucide" /></button>
          </div>
        </header>

        <div ref={scroller} className={s.scroll} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          {listOpen ? (
            <ThreadList threads={chat.threads} current={chat.threadId} onPick={(id) => { setListOpen(false); stick.current = true; chat.openThread(id); }} onNew={() => { setListOpen(false); chat.reset(); }} />
          ) : chat.turns.length === 0 ? (
            <div className={s.empty}>
              <p className={s.lead}>먹은 것도, 식단표도<br />말로 바꿉니다</p>
              <p className={s.leadSub}>사진이나 영양성분표를 올려도 됩니다. 바뀌는 내용은 카드로 보여드리고, 적용을 눌러야 저장됩니다.</p>
              {chat.load === 'loading' && <p className={s.meta} style={{ marginTop: 14 }}>이전 대화를 불러오는 중입니다</p>}
              {chat.load === 'error' && <p className={s.meta} style={{ marginTop: 14 }}>이전 대화를 불러오지 못했습니다. <button type="button" className={s.inlineBtn} onClick={chat.refresh}>다시 시도</button></p>}
              <ul className={s.prompts}>
                {prompts.map((p) => (
                  <li key={p}><button type="button" className="sq" onClick={() => submit(p)}><span>{p}</span><ArrowUpRight {...ICON} className="lucide" /></button></li>
                ))}
              </ul>
            </div>
          ) : (
            <ol className={s.log}>
              {chat.turns.map((t) => t.role === 'user' ? (
                <li key={t.id} className={s.user}>
                  {t.images.length > 0 && <div className={s.userImgs}>{t.images.map((src, i) => <img key={i} src={src} alt="" className="sq" />)}</div>}
                  {!t.images.length && !!t.sentImages && <p className={s.meta}>사진 {t.sentImages}장</p>}
                  {t.text && <p className={`${s.bubble} sq`}>{t.text}</p>}
                </li>
              ) : (
                <li key={t.id} className={s.reply}>
                  <Reply turn={t} applied={applied} canUndo={chat.canUndo} onApply={(c) => chat.apply(t.id, c)} onUndo={(c) => chat.undo(t.id, c)} onView={view} onLogin={login} onRetry={chat.retry} />
                </li>
              ))}
            </ol>
          )}
        </div>

        <form className={s.composer} onSubmit={(e) => { e.preventDefault(); submit(); }}>
          {dragging && <div className={`${s.drop} sq`}>여기에 사진을 놓으세요</div>}
          {attachError && <p className={s.attachError}>{attachError}</p>}
          <div className={`${s.box} sq`}>
            {images.length > 0 && (
              <div className={s.thumbs}>
                {images.map((img, i) => (
                  <div key={i} className={s.thumb}>
                    <img src={img.preview} alt={`첨부한 사진 ${i + 1}`} className="sq" />
                    <button type="button" aria-label="사진 빼기" onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))}><X size={12} strokeWidth={2.4} aria-hidden /></button>
                  </div>
                ))}
              </div>
            )}
            <div className={s.row}>
              <button type="button" className={s.attach} aria-label="사진 올리기" disabled={images.length >= 3} onClick={() => file.current?.click()}><ImagePlus {...ICON} className="lucide" /></button>
              <textarea
                ref={input}
                rows={1}
                value={draft}
                placeholder="예: 점심에 김치찌개 먹었어"
                aria-label="코치에게 보낼 말"
                onChange={(e) => { setDraft(e.target.value); autosize(); }}
                onPaste={(e) => { const f = Array.from(e.clipboardData.files); if (f.length) { e.preventDefault(); void attach(f); } }}
                onKeyDown={(e) => {
                  // Enter sends; Shift+Enter and Hangul composition keep typing
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); }
                }}
              />
              {chat.busy ? (
                <button type="button" className={s.send} aria-label="멈추기" onClick={chat.stop}><Square size={14} strokeWidth={0} fill="currentColor" aria-hidden /></button>
              ) : (
                <button type="submit" className={s.send} aria-label="보내기" disabled={!draft.trim() && !images.length}><ArrowUp size={18} strokeWidth={2.4} aria-hidden /></button>
              )}
            </div>
          </div>
          <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void attach(e.target.files); e.target.value = ''; }} />
        </form>
      </aside>
    </>
  );
}

function ThreadList({ threads, current, onPick, onNew }: { threads: ChatThreadRow[]; current: string | null; onPick: (id: string) => void; onNew: () => void }) {
  return (
    <div className={s.threads}>
      <p className={s.eyebrow}>최근 대화 · 폰과 같이 보입니다</p>
      <ul>
        <li><button type="button" className="sq" onClick={onNew}><span className={s.threadTitle}>새 대화 시작</span></button></li>
        {threads.map((t) => (
          <li key={t.id}>
            <button type="button" className="sq" aria-current={t.id === current || undefined} onClick={() => onPick(t.id)}>
              <span className={s.threadTitle}>{t.title?.trim() || '제목 없는 대화'}</span>
              <span className={s.threadWhen}>{whenText(t.updated_at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Reply({ turn, applied, canUndo, onApply, onUndo, onView, onLogin, onRetry }: {
  turn: AssistantTurn;
  applied: Set<string>;
  canUndo: (c: CoachCard) => boolean;
  onApply: (c: CoachCard) => string | null;
  onUndo: (c: CoachCard) => void;
  onView: (target: string) => void;
  onLogin: () => void;
  onRetry: () => void;
}) {
  const live = turn.status === 'streaming';
  return (
    <>
      {turn.parts.map((p, i) => <Part key={i} part={p} live={live} turn={turn} applied={applied} canUndo={canUndo} onApply={onApply} onUndo={onUndo} onView={onView} />)}
      {live && turn.parts.length === 0 && <Steps steps={[{ id: 'wait', label: '연결하는 중', state: 'running', kind: 'context' }]} live />}
      {turn.status === 'stopped' && <p className={s.meta}>멈췄습니다</p>}
      {turn.error && (
        <div className={s.error}>
          <p>{turn.error.message}</p>
          {turn.error.code === 'auth'
            ? <button type="button" className="btn-ghost pill" onClick={onLogin}>로그인</button>
            : turn.error.code !== 'refusal' && turn.error.code !== 'forbidden' && <button type="button" className="btn-ghost pill" onClick={onRetry}><RotateCcw size={16} aria-hidden />다시 시도</button>}
        </div>
      )}
    </>
  );
}

function Part({ part, live, turn, applied, canUndo, onApply, onUndo, onView }: {
  part: TurnPart; live: boolean; turn: AssistantTurn; applied: Set<string>; canUndo: (c: CoachCard) => boolean;
  onApply: (c: CoachCard) => string | null; onUndo: (c: CoachCard) => void; onView: (target: string) => void;
}) {
  switch (part.kind) {
    case 'steps': return <Steps steps={part.steps} live={live} seconds={live ? undefined : turnSeconds(turn)} />;
    case 'text': return <Prose text={part.text} />;
    case 'card': return <Card card={part.card} applied={applied.has(part.card.id)} undoable={canUndo(part.card)} blocked={(part.card.dependsOn ?? []).some((id) => !applied.has(id))} onApply={onApply} onUndo={onUndo} onView={onView} />;
    case 'block': return <TrendCard block={part.block} />;
    case 'sources': return (
      <div className={s.sources}>
        <p className={s.eyebrow}>출처</p>
        <ul>{part.items.map((x) => <li key={x.url}><a href={x.url} target="_blank" rel="noreferrer noopener">{x.title || hostOf(x.url)}</a><span>{hostOf(x.url)}</span></li>)}</ul>
      </div>
    );
  }
}

function StepIcon({ state, kind }: { state: CoachStep['state']; kind: CoachStep['kind'] }) {
  if (kind === 'note') return <span className={s.noteMark} aria-hidden="true" />;
  if (state === 'done') return <Check size={14} strokeWidth={2.6} aria-hidden className={s.stepDone} />;
  if (state === 'error') return <X size={14} strokeWidth={2.4} aria-hidden className={s.stepErr} />;
  return <span className={s.ring} aria-hidden="true" />;
}

function Steps({ steps, live, seconds }: { steps: CoachStep[]; live: boolean; seconds?: number }) {
  const [openList, setOpenList] = useState(false);
  if (!live && !openList && steps.length > 1) {
    const work = steps.filter((x) => x.kind !== 'note').length;
    return (
      <button type="button" className={s.stepsSummary} onClick={() => setOpenList(true)} aria-expanded={false}>
        <Check size={14} strokeWidth={2.6} aria-hidden />
        <span>{work}단계 확인{seconds ? ` · ${seconds}초` : ''}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
    );
  }
  return (
    <ul className={s.steps} aria-live="polite">
      {steps.map((x) => (
        <li key={x.id} className={s.step} data-state={x.state} data-kind={x.kind}>
          <StepIcon state={x.state} kind={x.kind} />
          <span>{x.label}</span>
        </li>
      ))}
    </ul>
  );
}

/** Plain paragraphs and "- " lists; the model is asked not to use other markdown. */
function Prose({ text }: { text: string }) {
  const blocks = text.replace(/\*\*(.+?)\*\*/g, '$1').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: ReactNode[] = [];
  blocks.forEach((b, i) => {
    const lines = b.split('\n');
    if (lines.every((l) => /^\s*[-·•]\s+/.test(l))) out.push(<ul key={i} className={s.list}>{lines.map((l, j) => <li key={j}>{l.replace(/^\s*[-·•]\s+/, '')}</li>)}</ul>);
    else out.push(<p key={i}>{lines.map((l, j) => <span key={j}>{j > 0 && <br />}{l}</span>)}</p>);
  });
  return <div className={s.prose}>{out}</div>;
}

const signed = (n: number, unit: string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(Math.round(n)))}${unit}`;

function Card({ card, applied, undoable, blocked, onApply, onUndo, onView }: {
  card: CoachCard; applied: boolean; undoable: boolean; blocked: boolean;
  onApply: (c: CoachCard) => string | null; onUndo: (c: CoachCard) => void; onView: (target: string) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const showTotals = card.kind === 'rebalance' || card.kind === 'skip_meal' || card.kind === 'day_adjustment';
  const changed = card.delta.kcal !== 0 || card.delta.protein !== 0;
  return (
    <article className={`${s.card} sq`} data-applied={applied || undefined}>
      <div className={s.cardHead}>
        <span className={s.eyebrow}>{KIND[card.kind]}{applied ? ' · 적용함' : ''}</span>
        {changed && (
          <span className={s.delta}>
            <b className="num">{signed(card.delta.kcal, 'kcal')}</b>
            {card.delta.protein !== 0 && <span>단백질 <span className="num">{signed(card.delta.protein, 'g')}</span></span>}
          </span>
        )}
      </div>
      <h3 className={s.cardTitle}>{card.title}</h3>
      <dl className={s.lines}>
        {card.lines.map((l, i) => (
          <div key={i}>
            <dt>{l.label}</dt>
            <dd>{l.before && <del>{l.before}</del>}<span>{l.after}</span></dd>
          </div>
        ))}
        {showTotals && (
          <div>
            <dt>오늘 예상</dt>
            <dd><span><span className="num">{fmt(card.totals.before.kcal)}</span> → <span className="num">{fmt(card.totals.after.kcal)}</span>kcal · 목표 <span className="num">{fmt(card.totals.target)}</span></span></dd>
          </div>
        )}
      </dl>
      {card.note && <p className={s.cardNote}>{card.note}</p>}
      {err && <p className={s.cardErr}>{err}</p>}
      {blocked && !applied && <p className={s.cardNote}>위 카드를 먼저 적용해야 이 숫자가 맞습니다</p>}
      <div className={s.cardActs}>
        {applied ? (
          <>
            <span className={s.appliedTag}><Check size={15} strokeWidth={2.6} aria-hidden />적용했습니다</span>
            {undoable && <button type="button" className="btn-ghost pill" onClick={() => onUndo(card)}><RotateCcw size={15} aria-hidden />되돌리기</button>}
          </>
        ) : (
          <button type="button" className={`btn-primary pill ${s.applyBtn}`} disabled={blocked} onClick={() => setErr(onApply(card))}>적용</button>
        )}
        <button type="button" className={s.viewBtn} onClick={() => onView(card.target)}>보기<ArrowUpRight size={15} aria-hidden /></button>
      </div>
    </article>
  );
}
