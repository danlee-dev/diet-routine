'use client';
// Suggestions on Today that change the plan only when accepted: split yesterday's overshoot, a new daily
// target from the record, or dropping a meal that keeps getting skipped. Same cards as the phone.
import { useState } from 'react';
import { daysBetween, keyOf, parseKey } from '@diet/core';
import { todaySuggestions, type Suggestion } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/client';
import { Icon } from './Icon';
import { useOverlay } from './ui';

interface Dismissed { id: string; on: string }

/** "그대로 두기" hides the morning-after card for that morning, the others for a week. */
function isDismissed(s: Suggestion, today: string): boolean {
  const d = devicePref.get<Dismissed | null>(`sg:${s.kind}`, null);
  if (!d) return false;
  return s.kind === 'carry' ? d.id === s.id : daysBetween(parseKey(d.on), parseKey(today)) < 7;
}

export function SuggestionCards() {
  const env = useEnv();
  const { toast } = useOverlay();
  const [, bump] = useState(0);
  const today = keyOf(env.now());
  // one at a time, most pressing first: the next shows once this one is accepted or dismissed
  const list = todaySuggestions(env).filter((s) => !isDismissed(s, today)).slice(0, 1);
  if (!list.length) return null;
  return (
    <div className="sg-list">
      {list.map((s) => (
        <section key={s.id} className="sg-card sq" aria-label={s.title}>
          <h3 className="sg-t">{s.title}</h3>
          <p className="sg-b">{s.body}</p>
          <div className="card-acts">
            <button type="button" className="btn-primary pill" onClick={() => { const undo = s.apply(); toast(s.done, undo); }}>
              <Icon name="check" size="sm" />{s.accept}
            </button>
            <button type="button" className="link-btn quiet" onClick={() => { devicePref.set(`sg:${s.kind}`, { id: s.id, on: today }); bump((n) => n + 1); }}>그대로 두기</button>
          </div>
        </section>
      ))}
    </div>
  );
}
