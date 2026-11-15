'use client';
// The user's shopping list from todayView (their generated list, or the owner's built-in one), with what is left
// of each item. Checking an item means bought: its count refills. Items running out are listed first with a
// Coupang link. Date-based reorders stay only for items whose count is not kept. Empty sections hide.
import { useState } from 'react';
import { cycleSchedule, daysLeftText, diffText, fmt, mdw, pantryName, programDate, stockText, type PantryStatus, type ShopItem } from '@diet/core';
import { checklistSet, clearChecklist, pantryView, stockAlertsFor, todayView, toggleBought, toggleChecklist } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { devicePref } from '@/lib/client';
import { Icon } from '../Icon';
import { useOverlay } from '../ui';
import { PantrySheet } from '../PantrySheet';

type Tab = 'now' | 'weekly' | 'cycle';
const sumPrice = (list: ShopItem[], skipOpt?: boolean) => list.reduce((a, x) => a + (skipOpt && x.optional ? 0 : x.price), 0);

/** "12개 남음 · 6일분", or a prompt to count it. */
function StockButton({ s, listId }: { s: PantryStatus | undefined; listId: string }) {
  const { open } = useOverlay();
  if (!s) return null;
  const low = s.daysLeft != null && s.daysLeft <= 3;
  return (
    <button type="button" className={`stock-btn${low ? ' is-low' : ''}${s.stock == null ? ' is-unknown' : ''}`} onClick={() => open(<PantrySheet listId={listId} />)}>
      {s.stock == null
        ? <>남은 양 세기<Icon name="chevron-right" size="sm" /></>
        : <>{stockText(s.stock, s.item)} 남음{s.daysLeft != null ? ` · ${s.daysLeft <= 0 ? '오늘 떨어짐' : `${s.daysLeft}일분`}` : ''}<Icon name="chevron-right" size="sm" /></>}
    </button>
  );
}

export function Shop() {
  const env = useEnv();
  const { toast } = useOverlay();
  const v = todayView(env);
  const shop = checklistSet(env, 'shop');
  const cycle = checklistSet(env, 'cycle');
  const pantry = pantryView(env);
  const alerts = stockAlertsFor(env);
  const statusOf = (id: string) => pantry.find((p) => p.item.ids.includes(id));
  // the owner's built-in list carries its own notes (prices as of a date, the Thursday salad); a generated list does not
  const builtIn = v.override?.shop == null;
  const { now, week } = v.shop;
  const allCycle = cycleSchedule(v.ctx.idx, cycle, v.shop.cycle);
  // a counted product is reordered by what is left, not by date
  const cycleRows = allCycle.filter((r) => statusOf(r.itemId)?.record == null);
  const countedCycle = new Set(allCycle.filter((r) => statusOf(r.itemId)?.record != null).map((r) => r.itemId)).size;
  const sections = ([['now', '지금 한 번', now.length], ['weekly', '매주', week.length], ['cycle', '날짜별', cycleRows.length]] as [Tab, string, number][]).filter(([, , n]) => n > 0);
  const [tabPref, setTabState] = useState<Tab>(() => devicePref.get<Tab>('shopTab', 'now'));
  const tab = sections.some(([k]) => k === tabPref) ? tabPref : (sections[0]?.[0] ?? 'now');
  const setTab = (t: Tab) => { setTabState(t); devicePref.set('shopTab', t); };
  const [armed, setArmed] = useState(false);

  const bought = (x: ShopItem) => {
    const r = toggleBought(env, x.id);
    const s = r.status;
    if (r.checked && s) toast(`${pantryName(x.name)} 샀음 · ${stockText(s.stock ?? 0, s.item)} 있습니다`, r.undo);
    else toast(`${pantryName(x.name)} 샀음 표시를 지웠습니다`, r.undo);
  };

  const item = (x: ShopItem) => {
    const done = shop.has(x.id);
    return (
      <li key={x.id} className={`shop-item${done ? ' is-done' : ''}`}>
        <button type="button" className="cb" aria-pressed={done} aria-label={`${x.name} 샀음 표시`} onClick={() => bought(x)}><Icon name="check" size="sm" /></button>
        <div style={{ minWidth: 0 }}>
          <div className="shop-name">{x.name}</div>
          <div className="shop-meta">{x.qty} · <span className="num">{fmt(x.price)}</span>원</div>
          <StockButton s={statusOf(x.id)} listId={x.id} />
        </div>
        <a className="ext" href={x.url} target="_blank" rel="noopener" aria-label={`${x.name} 쿠팡에서 열기`}>쿠팡<Icon name="arrow-up-right" size="sm" /></a>
      </li>
    );
  };

  if (!sections.length && !pantry.length) return <p className="lead-note">장보기 목록이 아직 없습니다. 코치에게 &ldquo;장보기 목록 만들어 줘&rdquo; 라고 하면 만들어 줍니다.</p>;

  return (
    <>
      {alerts.length > 0 && (
        <section className="card sq low-card" aria-label="곧 떨어지는 것">
          <p className="card-k">곧 떨어지는 것 · {alerts.length}개</p>
          <ul className="low-list">
            {alerts.map((a) => (
              <li key={a.id}>
                <span className="tx"><b>{a.name}</b><span>{daysLeftText(a.daysLeft)} · {a.detail}</span></span>
                <a className="chip-btn" href={a.url} target="_blank" rel="noopener" aria-label={`${a.name} 쿠팡에서 주문하기`}>쿠팡<Icon name="arrow-up-right" size="sm" /></a>
              </li>
            ))}
          </ul>
          <p className="card-meta">받으면 아래 목록에서 체크합니다. 체크하면 한 번 산 만큼 채워집니다.</p>
        </section>
      )}
      <p className="lead-note">
        {builtIn ? '링크를 누르면 적힌 용량이 선택된 쿠팡 상품이 열립니다. 가격은 11월 13일 기준입니다.' : '링크를 누르면 쿠팡 검색 결과가 열립니다. 가격은 대략입니다.'}
        {' '}남은 양을 세어 두면 먹을 때마다 줄고, 3일분이 남으면 오늘 화면에서 알려 줍니다.
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
                const s = statusOf(r.itemId);
                return (
                  <li key={r.id} className={`shop-item${r.done ? ' is-done' : ''}`}>
                    <button type="button" className="cb" aria-pressed={r.done} aria-label={`${r.name} 주문함 표시`} onClick={() => toggleChecklist(env, 'cycle', r.id)}><Icon name="check" size="sm" /></button>
                    <div style={{ minWidth: 0 }}>
                      <div className="shop-name">{r.name}</div>
                      <div className="shop-meta">{mdw(programDate(env.program, r.dayNo - 1))} · {r.sub}</div>
                      {/* only items that live in this list alone (e.g. tangerines) offer counting here */}
                      {s && s.item.id === r.itemId && <StockButton s={s} listId={r.itemId} />}
                    </div>
                    {r.done ? null : due
                      ? <a className="ext" href={r.url} target="_blank" rel="noopener" aria-label={`${r.name} 쿠팡에서 열기`}>쿠팡<Icon name="arrow-up-right" size="sm" /></a>
                      : <span className="dday">{diffText(r.diff)}</span>}
                  </li>
                );
              })}
            </ul>
            <p className="note" style={{ marginTop: 8 }}>
              주문 날짜가 되면 오늘 화면 위쪽에 알려 줍니다.{countedCycle > 0 ? ` 남은 양을 세는 ${countedCycle}개 품목은 날짜 대신 남은 양으로 알려 줍니다.` : ''}
            </p>
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
