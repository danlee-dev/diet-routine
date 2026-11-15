'use client';
import { EXTRA, SCEN, SCEN_ORDER, type InfoCard, type ScenId } from '@diet/core';
import { setDay, todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { Icon } from '../Icon';

export function Situations({ onGoToday, embedded }: { onGoToday: () => void; embedded?: boolean }) {
  const env = useEnv();
  const v = todayView(env);
  const card = (s: InfoCard, id: ScenId | null, i: number) => {
    const cur = id != null && v.scen === id;
    return (
      <article key={s.name} className={`card sq${cur ? ' is-current' : ''}`} style={{ ['--i' as string]: i }}>
        <div className="card-head"><span className="tile sq"><Icon name={s.icon} /></span><div><h3>{s.name}</h3><p>{s.short}</p></div></div>
        <ul className="rules dots">{s.rules.map((r) => <li key={r}>{r}</li>)}</ul>
        {id && (
          <button type="button" className="btn-ghost pill" onClick={() => { setDay(env, v.ctx.key, { scenario: id }); onGoToday(); }}>
            {cur ? <><Icon name="check" />오늘 적용 중</> : <>오늘 이걸로 보기<Icon name="chevron-right" /></>}
          </button>
        )}
      </article>
    );
  };
  return (
    <>
      {!embedded && <div className="page-head">
        <span className="eyebrow">상황별</span>
        <h1 className="page-title">이럴 땐 이렇게</h1>
        <p className="page-sub">위쪽 여섯 개는 누르면 오늘 화면의 순서가 그 상황에 맞게 바뀝니다.</p>
      </div>}
      <div className="cards stagger">{SCEN_ORDER.map((id, i) => card(SCEN[id], id, i))}</div>
      <h2 className="section-title">그 밖에</h2>
      <div className="cards stagger">{EXTRA.map((s, i) => card(s, null, i))}</div>
    </>
  );
}
