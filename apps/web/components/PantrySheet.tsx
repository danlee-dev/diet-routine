'use client';
// One shopping item's count: pick how many are left now, or mark a purchase. Meals logged later use it up.
import { useMemo, useState } from 'react';
import { fmt, pantryName, stockText, type PantryStatus } from '@diet/core';
import { markBought, pantryFor, setStock, stopCounting } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { Icon } from './Icon';
import { SheetHead, useOverlay, Wheel, type WheelItem } from './ui';

/** Wheel values for an item: pieces one by one, weights and volumes in sensible steps, up to two purchases. */
function wheelItems(s: PantryStatus): WheelItem[] {
  const { unit, pack } = s.item;
  const step = unit === 'ea' ? (pack > 120 ? 5 : 1) : pack >= 2000 ? 100 : pack >= 500 ? 50 : 10;
  const max = Math.max(pack * 2, s.stock ?? 0);
  const out: WheelItem[] = [];
  // plain numbers on the wheel (the unit sits beside it), every value distinct
  for (let v = 0; v <= max + 1e-9; v += step) out.push({ v, t: fmt(v), a: stockText(v, s.item) });
  // the exact count now is always a stop, so saving without moving the wheel keeps it
  if (s.stock != null && !out.some((x) => Math.abs(x.v - s.stock!) < 1e-9)) out.push({ v: s.stock, t: fmt(s.stock), a: stockText(s.stock, s.item) });
  return out.sort((a, b) => a.v - b.v);
}
const nearest = (items: WheelItem[], v: number) => items.reduce((a, x) => (Math.abs(x.v - v) < Math.abs(a.v - v) ? x : a), items[0]!).v;

export function PantrySheet({ listId }: { listId: string }) {
  const env = useEnv();
  const { close, toast } = useOverlay();
  const s = pantryFor(env, listId);
  const items = useMemo(() => (s ? wheelItems(s) : []), [s?.item.id, s?.item.pack, s?.stock]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pick, setPick] = useState<number>(() => (s ? nearest(items, s.stock ?? s.item.pack) : 0));
  if (!s) return <div><SheetHead eyebrow="재고" title="찾을 수 없습니다" /></div>;
  const name = pantryName(s.item.name);
  const days = s.daily > 0 ? Math.floor(pick / s.daily + 1e-9) : null;
  return (
    <div className="pantry-sheet">
      <SheetHead eyebrow="남은 양" title={name} />
      <p className="s-lead">
        {s.stock == null
          ? '지금 집에 있는 만큼 고르면 그때부터 먹을 때마다 줄어듭니다.'
          : `${s.daysLeft == null ? `지금 ${stockText(s.stock, s.item)} 남았습니다` : s.daysLeft <= 0 ? `지금 ${stockText(s.stock, s.item)} 남아 오늘 떨어집니다` : `지금 ${stockText(s.stock, s.item)}, ${s.daysLeft}일분이 남았습니다`}. 고르면 이 숫자부터 다시 셉니다.`}
      </p>
      <div className="picker">
        <div className="picker-band sq" />
        <Wheel id="pantry-wheel" items={items} value={pick} onChange={setPick} label={`${name} 남은 양`} wide />
        <span className="picker-unit">{s.item.unit === 'ea' ? s.item.label : s.item.unit}</span>
      </div>
      <p className="note pantry-rate">
        {s.daily > 0
          ? `계획대로면 하루 ${stockText(s.daily, s.item)}씩 써서 ${days != null && days <= 0 ? '오늘 떨어집니다' : `${days}일 갑니다`}`
          : '지금 식단에는 이 품목이 들어 있지 않아 줄어들지 않습니다'}
      </p>
      <div className="sheet-acts">
        <button type="button" className="btn-ghost pill" onClick={() => {
          const undo = markBought(env, listId);
          close();
          toast(`${name} ${stockText(s.item.pack, s.item)} 채웠습니다`, undo);
        }}>
          <Icon name="package" size="sm" />샀어요 +{stockText(s.item.pack, s.item)}
        </button>
        <button type="button" className="btn-primary pill" onClick={() => {
          const undo = setStock(env, listId, pick);
          close();
          toast(`${name} ${stockText(pick, s.item)} 남음으로 맞췄습니다`, undo);
        }}>
          <Icon name="check" size="sm" />이만큼 있어요
        </button>
      </div>
      <div className="quiet-acts">
        <a className="link-btn quiet" href={s.item.url} target="_blank" rel="noopener">쿠팡에서 보기<Icon name="arrow-up-right" size="sm" /></a>
        {s.record && (
          <button type="button" className="link-btn quiet" onClick={() => { const undo = stopCounting(env, listId); close(); toast(`${name} 재고를 그만 셉니다`, undo); }}>
            그만 세기
          </button>
        )}
      </div>
    </div>
  );
}
