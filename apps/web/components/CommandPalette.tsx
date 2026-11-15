'use client';
// ⌘K: every action and destination from the keyboard. Matches Korean initial consonants too (ㅊㅈ -> 체중).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

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

export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose: () => void; commands: Command[] }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const list = useMemo(() => (q.trim() ? commands.filter((c) => matches(c, q.trim())) : commands), [q, commands]);
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => input.current?.focus(), 30);
    return () => clearTimeout(id);
  }, [open]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  const run = (c: Command | undefined) => { if (!c) return; onClose(); setQ(''); setSel(0); setTimeout(c.run, 0); };
  return (
    <>
      <div className={`cmdk-scrim${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`cmdk sq${open ? ' open' : ''}`} role="dialog" aria-modal="true" aria-label="검색과 실행">
        <div className="cmdk-in">
          <Icon name="search" />
          <input
            ref={input}
            value={q}
            placeholder="체중, 물, 홈트, 외출, 설정"
            aria-label="명령 검색"
            aria-controls="cmdk-list"
            aria-activedescendant={list[sel] ? `cmd-${list[sel].id}` : undefined}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(list[sel]); }
              else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
          />
          <kbd>esc</kbd>
        </div>
        {list.length ? (
          <ul ref={listRef} id="cmdk-list" role="listbox" aria-label="명령">
            {list.map((c, i) => (
              <Fragment key={c.id}>
                {(i === 0 || list[i - 1]!.group !== c.group) && <li className="cmdk-g" role="presentation">{c.group}</li>}
                <li role="presentation">
                  <button id={`cmd-${c.id}`} type="button" role="option" tabIndex={-1} aria-selected={i === sel} onMouseMove={() => setSel(i)} onClick={() => run(c)}>
                    <Icon name={c.icon} />{c.label}{c.hint && <span className="hint2">{c.hint}</span>}
                  </button>
                </li>
              </Fragment>
            ))}
          </ul>
        ) : <p className="empty2">맞는 항목이 없습니다</p>}
      </div>
    </>
  );
}
