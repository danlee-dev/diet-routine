'use client';
// "식단표 공유": the day's meals drawn as one clean image (4:5, 1080 wide) for KakaoTalk or Instagram.
// Drawn on a canvas with the page's own fonts and theme colors, so it looks like the app, not a screenshot.
import { useEffect, useRef, useState } from 'react';
import { fmt, hhmm, type AdjustedMeal } from '@diet/core';
import { todayView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { Icon } from './Icon';
import { SheetHead, useOverlay } from './ui';

interface CardData {
  dateLabel: string;
  dayLabel: string;
  meals: AdjustedMeal[];
  total: number;
  protein: number;
  target: number;
}

const W = 1080;
const PAD = 88;

export type CardTone = 'light' | 'dark';
// same neutrals as the app (dark is R=G=B, no blue tint)
const TONES: Record<CardTone, { bg: string; fg: string; fg2: string; muted: string; surface: string }> = {
  light: { bg: '#FCFCFC', fg: '#0B0B0B', fg2: '#3A3A3A', muted: '#6B6B6B', surface: '#F3F3F3' },
  dark: { bg: '#0A0A0A', fg: '#F2F2F2', fg2: '#CFCFCF', muted: '#9B9B9B', surface: '#171717' },
};

/** Cut text to fit a width, ending with an ellipsis. */
function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

export async function renderMealsImage(d: CardData, tone: CardTone): Promise<Blob> {
  const family = getComputedStyle(document.body).fontFamily;
  await Promise.all(['300', '400', '500', '600'].map((w) => document.fonts.load(`${w} 40px ${family}`).catch(() => [])));
  const { bg, fg, fg2, muted, surface } = TONES[tone];
  // without times yet (wake time not logged), names start where the time column would be
  const timed = d.meals.some((m) => m.at != null);
  const nameX = timed ? PAD + 130 : PAD + 8;
  const font = (w: number, px: number) => `${w} ${px}px ${family}`;

  // measure height first: header + total + meals + footer
  const itemH = 50, mealHead = 64, mealGap = 40, cardPad = 44;
  const mealsH = d.meals.reduce((s, m) => s + mealHead + m.items.length * itemH + cardPad * 2, 0) + mealGap * Math.max(0, d.meals.length - 1);
  const H = Math.max(1350, 520 + mealsH + 200);

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // brand orb, cut by the top-right corner like the app's focus card
  const orb = (x: number, y: number, r: number) => {
    const g1 = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    g1.addColorStop(0, '#FFE6D0');
    g1.addColorStop(0.35, '#FFB37A');
    g1.addColorStop(0.7, '#FF7A45');
    g1.addColorStop(1, '#FF4F6D');
    ctx.fillStyle = g1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  orb(W - 40, 40, 230);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = muted;
  ctx.font = font(500, 32);
  ctx.fillText(d.dateLabel, PAD, 150);
  ctx.fillStyle = fg;
  ctx.font = font(300, 96);
  ctx.fillText('오늘 식단', PAD - 4, 262);

  ctx.font = font(300, 72);
  const totalText = fmt(d.total);
  ctx.fillText(totalText, PAD - 2, 380);
  const tw = ctx.measureText(totalText).width;
  ctx.fillStyle = muted;
  ctx.font = font(400, 34);
  ctx.fillText(`kcal · 단백질 ${d.protein}g`, PAD + tw + 18, 380);
  ctx.font = font(400, 30);
  ctx.fillText(`하루 목표 ${fmt(d.target)}kcal`, PAD, 432);

  let y = 500;
  for (const m of d.meals) {
    const h = mealHead + m.items.length * itemH + cardPad * 2;
    // one soft surface per meal, continuous-ish corners
    ctx.fillStyle = surface;
    ctx.beginPath();
    ctx.roundRect(PAD - 28, y, W - (PAD - 28) * 2, h, 44);
    ctx.fill();

    const top = y + cardPad + 42;
    ctx.fillStyle = muted;
    ctx.font = font(500, 30);
    if (m.at != null) ctx.fillText(hhmm(m.at), PAD + 8, top);
    ctx.fillStyle = fg;
    ctx.font = font(600, 42);
    ctx.fillText(m.name, nameX, top);
    ctx.font = font(500, 40);
    const kc = `${m.est ? '약 ' : ''}${fmt(m.kcal)}`;
    ctx.font = font(400, 28);
    const unitW = ctx.measureText(' kcal').width;
    ctx.fillStyle = muted;
    ctx.fillText(' kcal', W - PAD - 8 - unitW, top);
    ctx.fillStyle = fg;
    ctx.font = font(500, 40);
    ctx.fillText(kc, W - PAD - 8 - unitW - ctx.measureText(kc).width, top);

    let iy = top + mealHead - 4;
    for (const it of m.items) {
      ctx.font = font(400, 31);
      ctx.fillStyle = muted;
      const amt = it.amount;
      const aw = ctx.measureText(amt).width;
      ctx.fillText(amt, W - PAD - 8 - aw, iy);
      ctx.fillStyle = fg2;
      ctx.fillText(fit(ctx, it.name, W - PAD - 8 - aw - 40 - nameX), nameX, iy);
      iy += itemH;
    }
    y += h + mealGap;
  }

  ctx.fillStyle = muted;
  ctx.font = font(500, 28);
  ctx.fillText(`감량 루틴 · ${d.dayLabel}`, PAD, H - 90);

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들지 못했습니다'))), 'image/png'));
}

/** Sheet with the image preview, the system share sheet (phones) and a download. */
export function ShareMealsSheet() {
  const env = useEnv();
  const { close, toast } = useOverlay();
  const [url, setUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  // the day as it is when the sheet opens; drawn once (the overlay re-renders while it animates)
  const [data] = useState(() => {
    const v = todayView(env);
    return {
      key: v.ctx.key,
      card: {
        dateLabel: v.ctx.label, dayLabel: `${v.ctx.week}주차 ${v.ctx.no}일째`, meals: v.meals,
        total: v.meals.reduce((s, m) => s + m.kcal, 0), protein: v.meals.reduce((s, m) => s + m.protein, 0), target: v.target,
      },
    };
  });
  const toastRef = useRef(toast);
  const [tone, setTone] = useState<CardTone>(() =>
    (document.documentElement.getAttribute('data-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    let gone = false;
    let made: string | null = null;
    void renderMealsImage(data.card, tone).then((blob) => {
      if (gone) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
      setFile(new File([blob], `식단-${data.key}.png`, { type: 'image/png' }));
    }, () => toastRef.current('이미지를 만들지 못했습니다'));
    return () => { gone = true; if (made) URL.revokeObjectURL(made); };
  }, [data, tone]);

  const canShare = !!file && typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [file] });
  const share = async () => {
    if (!file) return;
    try { await navigator.share({ files: [file], title: '오늘 식단' }); close(); }
    catch { /* cancelled */ }
  };

  return (
    <div className="share-sheet">
      <SheetHead eyebrow="식단표 공유" title="이렇게 보입니다" />
      <div className="seg share-tone" role="group" aria-label="이미지 색">
        {(['light', 'dark'] as const).map((x) => (
          <button key={x} type="button" aria-pressed={tone === x} onClick={() => setTone(x)}>{x === 'light' ? '밝게' : '어둡게'}</button>
        ))}
      </div>
      <div className="share-preview">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not a page image */}
        {url ? <img src={url} alt="오늘 식단표 이미지" /> : <p className="note">이미지를 만드는 중입니다</p>}
      </div>
      <p className="note">휴대폰에서는 이미지를 길게 눌러 사진에 저장할 수도 있습니다.</p>
      <div className="share-actions">
        {canShare && <button type="button" className="btn-primary pill" onClick={() => void share()}><Icon name="share" />공유하기</button>}
        {url && file && (
          <a className={canShare ? 'btn-ghost pill' : 'btn-primary pill'} href={url} download={file.name}><Icon name="download" />이미지 저장</a>
        )}
      </div>
    </div>
  );
}
