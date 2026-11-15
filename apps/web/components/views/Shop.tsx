'use client';
// The user's shopping list from todayView (their generated list, or the owner's built-in one). Empty sections hide.
import { useState } from 'react';
import { cycleSchedule, diffText, fmt, mdw, programDate, type ShopItem } from '@diet/core';
import { checklistSet, clearChecklist, todayView, toggleChecklist } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/client';
import { Icon } from '../Icon';

type Tab = 'now' | 'weekly' | 'cycle';
const sumPrice = (list: ShopItem[], skipOpt?: boolean) => list.reduce((a, x) => a + (skipOpt && x.optional ? 0 : x.price), 0);

export function Shop() {
  const env = useEnv();
  const v = todayView(env);
  const shop = checklistSet(env, 'shop');
  const cycle = checklistSet(env, 'cycle');
  // the owner's built-in list carries its own notes (prices as of a date, the Thursday salad); a generated list does not
  const builtIn = v.override?.shop == null;
  const { now, week } = v.shop;
  const cycleRows = cycleSchedule(v.ctx.idx, cycle, v.shop.cycle);
  const sections = ([['now', '지금 한 번', now.length], ['weekly', '매주', week.length], ['cycle', '날짜별', cycleRows.length]] as [Tab, string, number][]).filter(([, , n]) => n > 0);
  const [tabPref, setTabState] = useState<Tab>(() => devicePref.get<Tab>('shopTab', 'now'));
  const tab = sections.some(([k]) => k === tabPref) ? tabPref : (sections[0]?.[0] ?? 'now');
  const setTab = (t: Tab) => { setTabState(t); devicePref.set('shopTab', t); };
  const [armed, setArmed] = useState(false);

  const item = (x: ShopItem) => {
    const done = shop.has(x.id);
    return (
      <li key={x.id} className={`shop-item${done ? ' is-done' : ''}`}>
        <button type="button" className="cb" aria-pressed={done} aria-label={`${x.name} 담음 표시`} onClick={() => toggleChecklist(env, 'shop', x.id)}><Icon name="check" size="sm" /></button>
        <div style={{ minWidth: 0 }}><div className="shop-name">{x.name}</div><div className="shop-meta">{x.qty} · <span className="num">{fmt(x.price)}</span>원</div></div>
        <a className="ext" href={x.url} target="_blank" rel="noopener" aria-label={`${x.name} 쿠팡에서 열기`}>쿠팡<Icon name="arrow-up-right" size="sm" /></a>
      </li>
    );
  };

  if (!sections.length) return <p className="lead-note">장보기 목록이 아직 없습니다. 코치에게 &ldquo;장보기 목록 만들어 줘&rdquo; 라고 하면 만들어 줍니다.</p>;

  return (
    <>
      <p className="lead-note">
        {builtIn ? '링크를 누르면 적힌 용량이 선택된 쿠팡 상품이 열립니다. 가격은 11월 13일 기준입니다.' : '링크를 누르면 쿠팡 검색 결과가 열립니다. 가격은 대략입니다.'}
      </p>
      {sections.length > 1 && (
        <div className="subtabs only-phone" role="group" aria-label="장보기 구분">
          {sections.map(([k, l]) => <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      )}
      <div className="shop-cols">
        {now.length > 0 && (
          <section className={`shop-col${tab !== 'now' ? ' is-off' : ''}`}>
            <h3>지금 한 번<span>{fmt(sumPrice(now, true))}원</span></h3>
            <ul className="shop-list">{now.map(item)}</ul>
            {now.some((x) => x.optional) && <p className="note" style={{ marginTop: 8 }}>합계는 선택 항목을 뺀 금액입니다.</p>}
          </section>
        )}
        {week.length > 0 && (
          <section className={`shop-col${tab !== 'weekly' ? ' is-off' : ''}`}>
            <h3>매주<span>{fmt(sumPrice(week))}원</span></h3>
            <ul className="shop-list">{week.map(item)}</ul>
            <p className="note" style={{ marginTop: 8 }}>
              {builtIn ? '월요일에 주문합니다. 샐러드는 3~4일이면 시들어서 목요일에 3개 더 삽니다.' : '신선식품이라 매주 월요일에 다시 삽니다.'}
            </p>
          </section>
        )}
        {cycleRows.length > 0 && (
          <section className={`shop-col${tab !== 'cycle' ? ' is-off' : ''}`}>
            <h3>날짜별</h3>
            <ul className="shop-list">
              {cycleRows.map((r) => {
                const due = !r.done && r.diff <= 1;
                return (
                  <li key={r.id} className={`shop-item${r.done ? ' is-done' : ''}`}>
                    <button type="button" className="cb" aria-pressed={r.done} aria-label={`${r.name} 주문함 표시`} onClick={() => toggleChecklist(env, 'cycle', r.id)}><Icon name="check" size="sm" /></button>
                    <div style={{ minWidth: 0 }}><div className="shop-name">{r.name}</div><div className="shop-meta">{mdw(programDate(env.program, r.dayNo - 1))} · {r.sub}</div></div>
                    {r.done ? null : due
                      ? <a className="ext" href={r.url} target="_blank" rel="noopener" aria-label={`${r.name} 쿠팡에서 열기`}>쿠팡<Icon name="arrow-up-right" size="sm" /></a>
                      : <span className="dday">{diffText(r.diff)}</span>}
                  </li>
                );
              })}
            </ul>
            <p className="note" style={{ marginTop: 8 }}>주문 날짜가 되면 오늘 화면 위쪽에 알려 줍니다.</p>
          </section>
        )}
      </div>
      <div className="shop-foot">
        {builtIn ? <span className="note">한 달 합계 약 40만 원</span> : <span />}
        <button
          type="button"
          className="btn-ghost pill"
          onClick={() => {
            if (armed) { clearChecklist(env, 'shop'); setArmed(false); return; }
            setArmed(true);
            setTimeout(() => setArmed(false), 3000);
          }}
        >
          {armed ? '한 번 더 누르면 지웁니다' : <><Icon name="rotate-ccw" size="sm" />체크 모두 지우기</>}
        </button>
      </div>
    </>
  );
}
