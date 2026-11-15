'use client';
// ⌘K: every action and destination from the keyboard. Matches Korean initial consonants too (ㅊㅈ -> 체중).
import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  icon: string;
  group: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const chosung = (s: string) =>
  Array.from(s).map((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : ch;
  }).join('');

export function matches(cmd: Command, q: string): boolean {
  const hay = `${cmd.label} ${cmd.keywords ?? ''} ${cmd.group}`.toLowerCase();
  const hayCho = chosung(hay);
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t) || hayCho.includes(t));
}

export function CommandPalette({ open, onClose, commands, IconC }: {
  open: boolean; onClose: () => void; commands: Command[]; IconC: (p: { name: string }) => React.ReactNode;
}) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(() => (q.trim() ? commands.filter((c) => matches(c, q.trim())) : commands), [q, commands]);
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => input.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [open]);
  const run = (c: Command | undefined) => { if (!c) return; onClose(); setQ(''); setSel(0); setTimeout(c.run, 0); };
  return (
    <>
      <div className={`cmdk-scrim${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`cmdk sq${open ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label="검색과 실행">
        <input
          ref={input}
          value={q}
          placeholder="무엇을 할까요? 예: 체중, 물, 홈트, 외출"
          aria-label="명령 검색"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); run(list[sel]); }
            else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
          }}
        />
        {list.length ? (
          <ul role="listbox">
            {list.map((c, i) => (
              <li key={c.id}>
                <button type="button" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => run(c)}>
                  <IconC name={c.icon} />{c.label}<span className="hint2">{c.hint ?? c.group}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="empty2">맞는 항목이 없습니다</p>}
      </div>
    </>
  );
}
