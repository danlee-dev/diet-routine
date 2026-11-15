// Pure reducers for custom inputs, shared by the web keypad and the iPhone keypad.

export interface KeypadState {
  n: number;
  /** true until the first key: the first digit replaces the shown value. */
  fresh: boolean;
}

export const KEYPAD_MAX_DIGITS = 5;

/** k: '0'-'9', 'b' (backspace), 'c' (clear), or '+<number>' (add). */
export function keypadReduce(s: KeypadState, k: string): KeypadState {
  if (k.startsWith('+')) return { n: Math.min(99999, s.n + Number(k.slice(1))), fresh: false };
  if (k === 'b') return { n: parseInt(String(s.n).slice(0, -1) || '0', 10), fresh: false };
  if (k === 'c') return { n: 0, fresh: false };
  if (!/^\d$/.test(k)) return s;
  const base = s.fresh ? '' : String(s.n || '');
  if (base.length >= KEYPAD_MAX_DIGITS) return { ...s, fresh: false };
  return { n: parseInt(base + k, 10), fresh: false };
}
