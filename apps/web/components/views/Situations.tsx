'use client';
// Situations as one compact list: a row per situation, tap to open its rules and "오늘 이걸로".
import { useState } from 'react';
import { EXTRA, SCEN, SCEN_ORDER, type InfoCard, type ScenId } from '@diet/core';
import { setDay, todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { Icon } from '../Icon';
import { useOverlay } from '../ui';

export function Situations({ onGoToday }: { onGoToday: () => void }) {
  const env = useEnv();
  const { toast } = useOverlay();
  const v = todayView(env);
  const [openId, setOpenId] = useState<string | null>(null);

  const row = (s: InfoCard, id: ScenId | null) => {
    const key = id ?? s.name;
    const cur = id != null && v.scen === id;
    const expanded = openId === key;
    const panel = `sit-${key}`;
    return (
      <li key={key} className={`sit${expanded ? ' is-open' : ''}${cur ? ' is-current' : ''}`}>
        <button type="button" className="sit-row" aria-expanded={expanded} aria-controls={panel} onClick={() => setOpenId(expanded ? null : key)}>
          <Icon name={s.icon} />
          <span className="sit-tx"><b>{s.name}</b><span>{s.short}</span></span>
          {cur && <span className="sit-now">오늘</span>}
          <Icon name="chevron-down" size="sm" className="sit-chev" />
        </button>
        {expanded && (
          <div className="sit-body" id={panel}>
            <ol className="rule-list">{s.rules.map((r) => <li key={r}>{r}</li>)}</ol>
            {id && (cur
              ? <p className="sit-on"><Icon name="check" size="sm" />오늘 이 상황으로 보고 있습니다</p>
              : (
                <button type="button" className="btn-primary pill" onClick={() => { setDay(env, v.ctx.key, { scenario: id }); toast(`오늘 상황: ${s.name}`); onGoToday(); }}>
                  오늘 이걸로<Icon name="chevron-right" size="sm" />
                </button>
              ))}
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      <p className="lead-note">고르면 오늘 화면의 끼니 순서가 그 상황에 맞게 바뀝니다.</p>
      <ul className="sit-list">{SCEN_ORDER.map((id) => row(SCEN[id], id))}</ul>
      <h2 className="section-title">그 밖에</h2>
      <ul className="sit-list">{EXTRA.map((s) => row(s, null))}</ul>
    </>
  );
}
