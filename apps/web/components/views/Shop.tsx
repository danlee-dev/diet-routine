'use client';
import { useState } from 'react';
import { cycleSchedule, diffText, fmt, mdw, programDate, SHOP_NOW, SHOP_WEEK, type ShopItem } from '@diet/core';
import { checklistSet, clearChecklist, todayView, toggleChecklist } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/client';
import { Icon } from '../Icon';

type Tab = 'now' | 'weekly' | 'cycle';
const sumPrice = (list: ShopItem[], skipOpt?: boolean) => list.reduce((a, x) => a + (skipOpt && x.optional ? 0 : x.price), 0);

export function Shop({ embedded }: { embedded?: boolean }) {
  const env = useEnv();
  const v = todayView(env);
  const shop = checklistSet(env, 'shop');
  const cycle = checklistSet(env, 'cycle');
  const [tab, setTabState] = useState<Tab>(() => devicePref.get<Tab>('shopTab', 'now'));
  const setTab = (t: Tab) => { setTabState(t); devicePref.set('shopTab', t); };
  const [armed, setArmed] = useState(false);

  const item = (x: ShopItem) => {
    const done = shop.has(x.id);
    return (
      <li key={x.id} className={`shop-item${done ? ' is-done' : ''}`}>
        <button type="button" className="cb" aria-pressed={done} aria-label={`${x.name} 담음 표시`} onClick={() => toggleChecklist(env, 'shop', x.id)}><Icon name="check" /></button>
        <div style={{ minWidth: 0 }}><div className="shop-name">{x.name}</div><div className="shop-meta">{x.qty} · <span className="num">{fmt(x.price)}</span>원</div></div>
        <a className="go" href={x.url} target="_blank" rel="noopener">쿠팡<Icon name="arrow-up-right" /></a>
      </li>
    );
  };

  return (
    <>
      {!embedded && <div className="page-head">
        <span className="eyebrow">장보기</span>
        <h1 className="page-title">살 것</h1>
        <p className="page-sub">링크를 누르면 적힌 용량 옵션이 선택된 쿠팡 상품이 열립니다. 가격은 11월 13일 기준입니다.</p>
      </div>}
      <div className="seg only-phone" role="group" aria-label="장보기 구분">
        {([['now', '지금 한 번'], ['weekly', '매주'], ['cycle', '날짜별']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <div className="shop-cols">
        <section className={`shop-col${tab !== 'now' ? ' is-off' : ''}`}>
          <h3>지금 한 번<span>{fmt(sumPrice(SHOP_NOW, true))}원</span></h3>
          <ul className="shop-list">{SHOP_NOW.map(item)}</ul>
          <p className="note" style={{ marginTop: 8 }}>합계는 카누(선택) 제외 금액입니다.</p>
        </section>
        <section className={`shop-col${tab !== 'weekly' ? ' is-off' : ''}`}>
          <h3>매주<span>{fmt(sumPrice(SHOP_WEEK))}원</span></h3>
          <ul className="shop-list">{SHOP_WEEK.map(item)}</ul>
          <p className="note" style={{ marginTop: 8 }}>월요일에 주문합니다. 샐러드는 3~4일이면 시들어서 목요일에 3개 더 삽니다.</p>
        </section>
        <section className={`shop-col${tab !== 'cycle' ? ' is-off' : ''}`}>
          <h3>날짜별</h3>
          <ul className="shop-list">
            {cycleSchedule(v.ctx.idx, cycle).map((r) => {
              const due = !r.done && r.diff <= 1;
              return (
                <li key={r.id} className={`shop-item${r.done ? ' is-done' : ''}`}>
                  <button type="button" className="cb" aria-pressed={r.done} aria-label={`${r.name} 주문함 표시`} onClick={() => toggleChecklist(env, 'cycle', r.id)}><Icon name="check" /></button>
                  <div style={{ minWidth: 0 }}><div className="shop-name">{r.name}</div><div className="shop-meta">{mdw(programDate(env.program, r.dayNo - 1))} · {r.sub}</div></div>
                  {r.done ? null : due
                    ? <a className="go" href={r.url} target="_blank" rel="noopener">쿠팡<Icon name="arrow-up-right" /></a>
                    : <span className="dday">{diffText(r.diff)}</span>}
                </li>
              );
            })}
          </ul>
          <p className="note" style={{ marginTop: 8 }}>주문 날짜가 되면 오늘 화면 위쪽에 알려줍니다.</p>
        </section>
      </div>
      <div className="shop-foot">
        <span className="note">한 달 합계 약 40만 원</span>
        <button
          type="button"
          className="btn-ghost pill"
          onClick={() => {
            if (armed) { clearChecklist(env, 'shop'); setArmed(false); return; }
            setArmed(true);
            setTimeout(() => setArmed(false), 3000);
          }}
        >
          {armed ? '한 번 더 누르면 지웁니다' : <><Icon name="rotate-ccw" />체크 모두 지우기</>}
        </button>
      </div>
    </>
  );
}
