'use client';
// Overlay system (sheet, toast, scroll lock) and custom input primitives (wheel picker, keypad).
// Nothing here uses native pickers: time and numbers are chosen with our own controls.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

// ---------------- overlay ----------------
interface Overlay {
  open: (node: ReactNode, opts?: { focus?: string }) => void;
  close: () => void;
  isOpen: boolean;
  toast: (text: string, undo?: () => void) => void;
  setPlayerOpen: (open: boolean) => void;
}

const OverlayCtx = createContext<Overlay | null>(null);
export const useOverlay = (): Overlay => {
  const o = useContext(OverlayCtx);
  if (!o) throw new Error('OverlayProvider missing');
  return o;
};

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<{ node: ReactNode; key: number; swap: boolean } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [toastState, setToast] = useState<{ text: string; undo?: () => void; show: boolean; key: number }>({ text: '', show: false, key: 0 });
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const keyRef = useRef(0);
  const focusSel = useRef<string | undefined>(undefined);

  const open = useCallback((node: ReactNode, opts?: { focus?: string }) => {
    setIsOpen((was) => {
      if (!was) {
        lastFocus.current = document.activeElement as HTMLElement | null;
        setToast((t) => ({ ...t, show: false }));
      }
      keyRef.current += 1;
      setContent({ node, key: keyRef.current, swap: was });
      return true;
    });
    focusSel.current = opts?.focus;
  }, []);

  const close = useCallback(() => {
    setIsOpen((was) => {
      if (was && lastFocus.current && document.body.contains(lastFocus.current)) {
        const el = lastFocus.current;
        setTimeout(() => el.focus({ preventScroll: true }), 0);
      }
      return false;
    });
  }, []);

  const toast = useCallback((text: string, undo?: () => void) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast((t) => ({ text, undo, show: true, key: t.key + 1 }));
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, show: false, undo: undefined })), 4000);
  }, []);

  // focus management + scroll lock
  useEffect(() => {
    document.documentElement.classList.toggle('locked', isOpen || playerOpen);
  }, [isOpen, playerOpen]);
  useEffect(() => {
    if (!isOpen || !content) return;
    const id = setTimeout(() => {
      const el = sheetRef.current?.querySelector<HTMLElement>(focusSel.current ?? '[data-close]');
      el?.focus({ preventScroll: true });
    }, 60);
    if (sheetRef.current) sheetRef.current.scrollTop = 0;
    return () => clearTimeout(id);
  }, [isOpen, content]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen) close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  const value = useMemo(() => ({ open, close, isOpen, toast, setPlayerOpen }), [open, close, isOpen, toast]);

  return (
    <OverlayCtx.Provider value={value}>
      {children}
      <div className={`scrim${isOpen || playerOpen ? ' open' : ''}`} onClick={() => { if (isOpen) close(); }} />
      <div ref={sheetRef} className={`sheet sq${isOpen ? ' open' : ''}`} role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div className="grab" aria-hidden="true" />
        {content && <div key={content.key} className={`sheet-body${content.swap ? ' is-swap' : ''}`}>{content.node}</div>}
      </div>
      <div className={`toast${toastState.show ? ' show' : ''}`} role="status" aria-live="polite">
        <span>{toastState.text}</span>
        {toastState.undo && (
          <button type="button" onClick={() => { const u = toastState.undo; setToast((t) => ({ ...t, show: false, undo: undefined })); u?.(); }}>되돌리기</button>
        )}
      </div>
    </OverlayCtx.Provider>
  );
}

export function SheetHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  const { close } = useOverlay();
  return (
    <div className="sheet-head">
      <div><p className="eyebrow">{eyebrow}</p><h2 className="sheet-title" id="sheet-title">{title}</h2></div>
      <button type="button" className="icon-btn" data-close aria-label="닫기" onClick={close}><Icon name="x" /></button>
    </div>
  );
}

/** Large page title. `trailing` sits on the title row (the person button on the phone). */
export function PageHead({ eyebrow, title, trailing, children }: { eyebrow: ReactNode; title: string; trailing?: ReactNode; children?: ReactNode }) {
  return (
    <header className="ph">
      <p className="eyebrow">{eyebrow}</p>
      <div className="ph-row"><h1 className="ph-title">{title}</h1>{trailing}</div>
      {children}
    </header>
  );
}

// ---------------- wheel picker ----------------
const IH = 46;

export interface WheelItem {
  v: number;
  t: string;
  a?: string;
}

export function Wheel({ items, value, onChange, label, small, wide, id }: {
  items: WheelItem[]; value: number; onChange: (v: number) => void; label: string; small?: boolean; wide?: boolean; id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idxRef = useRef(-1);
  const raf = useRef(0);
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => { onChangeRef.current = onChange; });
  const last = items.length - 1;

  const paint = useCallback(() => {
    raf.current = 0;
    const el = ref.current;
    if (!el) return;
    const kids = el.querySelectorAll<HTMLElement>('.wheel-item');
    const c = el.scrollTop / IH;
    const clamp = (i: number) => Math.max(0, Math.min(last, i));
    const i = clamp(Math.round(c));
    for (let k = clamp(Math.floor(c) - 3); k <= clamp(Math.ceil(c) + 3); k++) {
      const a = Math.min(Math.abs(k - c), 3);
      const kid = kids[k];
      if (kid) kid.style.transform = `scale(${(1 - a * 0.08).toFixed(3)})`;
    }
    if (i !== idxRef.current) {
      if (idxRef.current >= 0) kids[idxRef.current]?.classList.remove('on');
      kids[i]?.classList.add('on');
      idxRef.current = i;
      const item = items[i];
      if (item) {
        el.setAttribute('aria-valuenow', String(item.v));
        el.setAttribute('aria-valuetext', item.a ?? item.t);
        onChangeRef.current(item.v);
      }
    }
  }, [items, last]);

  const scrollToIdx = useCallback((i: number, smooth: boolean) => {
    const el = ref.current;
    if (!el) return;
    const t = Math.max(0, Math.min(last, i)) * IH;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (smooth && !reduce) el.scrollTo({ top: t, behavior: 'smooth' });
    else { el.scrollTop = t; paint(); }
  }, [last, paint]);

  // initial position and external value changes (e.g. "지금" button)
  useLayoutEffect(() => {
    const i = items.findIndex((x) => x.v === value);
    if (i >= 0 && i !== idxRef.current) scrollToIdx(i, idxRef.current >= 0);
  }, [value, items, scrollToIdx]);

  return (
    <div
      ref={ref}
      id={id}
      className={`wheel${small ? ' sm' : ''}${wide ? ' wide' : ''}`}
      tabIndex={0}
      role="spinbutton"
      aria-label={label}
      aria-valuemin={items[0]?.v}
      aria-valuemax={items[last]?.v}
      onScroll={() => { if (!raf.current) raf.current = requestAnimationFrame(paint); }}
      onClick={(e) => {
        const it = (e.target as HTMLElement).closest<HTMLElement>('.wheel-item');
        if (it) scrollToIdx(Number(it.dataset.wi), true);
      }}
      onKeyDown={(e) => {
        const step = ({ ArrowUp: -1, ArrowDown: 1, PageUp: -5, PageDown: 5 } as Record<string, number>)[e.key];
        if (step) { e.preventDefault(); scrollToIdx(idxRef.current + step, false); }
        else if (e.key === 'Home') { e.preventDefault(); scrollToIdx(0, false); }
        else if (e.key === 'End') { e.preventDefault(); scrollToIdx(last, false); }
      }}
    >
      <div className="wheel-pad" />
      {items.map((x, i) => <div key={x.v} className="wheel-item" data-wi={i}>{x.t}</div>)}
      <div className="wheel-pad" />
    </div>
  );
}

// ---------------- keypad ----------------
export function Keypad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <div className="keypad" role="group" aria-label="숫자 키패드">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((n) => (
        <button key={n} type="button" className="sq" onClick={() => onKey(n)}>{n}</button>
      ))}
      <button type="button" className="fn sq" onClick={() => onKey('c')}>비우기</button>
      <button type="button" className="sq" onClick={() => onKey('0')}>0</button>
      <button type="button" className="fn sq" aria-label="한 자리 지우기" onClick={() => onKey('b')}><Icon name="delete" size="lg" /></button>
    </div>
  );
}
