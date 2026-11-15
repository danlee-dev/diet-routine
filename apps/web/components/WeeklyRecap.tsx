'use client';
// The weekly recap: trend, kept days as a week strip, workouts and runs, the best day. Shown on the records
// page and drawn on a canvas (1080 x 1350) for KakaoTalk or Instagram, the same card the phone shares.
import { useEffect, useRef, useState } from 'react';
import { DOW, fmt, md, mdw, parseKey, signedKg } from '@diet/core';
import { todayView, weeklyRecapFor, type WeeklyRecapView } from '@diet/data';
import { useEnv } from '@/lib/hooks';
import { Icon } from './Icon';
import { SheetHead, useOverlay } from './ui';

const rangeText = (r: Pick<WeeklyRecapView, 'from' | 'to'>) => `${md(parseKey(r.from))} – ${md(parseKey(r.to))}`;
const movingStat = (r: WeeklyRecapView) =>
  r.runs ? { n: r.runKm.toFixed(1), unit: 'km', label: `달리기 ${r.runs}회` } : r.walks ? { n: r.walkKm.toFixed(1), unit: 'km', label: `걷기 ${r.walks}회` } : { n: '0', unit: '회', label: '달리기' };

export function RecapCard({ onShare }: { onShare: () => void }) {
  const env = useEnv();
  const r = weeklyRecapFor(env);
  const mv = movingStat(r);
  return (
    <section className="recap sq" aria-label={r.current ? '이번 주 회고' : '지난주 회고'}>
      <p className="recap-range">{rangeText(r)} · {r.current ? '이번 주' : '지난주'}</p>
      <h2 className="recap-t">{r.current ? '이번 주 회고' : '지난주 회고'}</h2>
      <p className="recap-delta">
        <span className="num">{r.trend.delta != null ? signedKg(r.trend.delta) : '–'}<small>kg</small></span>
        <span className="recap-trend">{r.trend.end != null ? `추세 ${r.trend.end.toFixed(1)}kg` : '체중 기록이 쌓이면 추세가 나옵니다'}</span>
      </p>
      <ol className="recap-strip" aria-label="요일별 기록">
        {r.strip.map((d) => {
          const date = parseKey(d.key);
          const label = d.state === 'kept' ? '지킴' : d.state === 'logged' ? '기록함' : d.state === 'future' ? '아직' : '기록 없음';
          return <li key={d.key} className={`is-${d.state}`} aria-label={`${mdw(date)} ${label}`}><i aria-hidden="true" /><span>{DOW[date.getDay()]}</span></li>;
        })}
      </ol>
      <dl className="trio">
        <div><dt>지킨 날</dt><dd>{r.kept}<small>/ {r.days}일</small></dd></div>
        <div><dt>홈트</dt><dd>{r.workouts}<small>회</small></dd></div>
        <div><dt>{mv.label}</dt><dd>{mv.n}<small>{mv.unit}</small></dd></div>
      </dl>
      {r.best && (
        <div className="recap-best sq">
          <p className="k">가장 잘 지킨 날 · {mdw(parseKey(r.best.key))}</p>
          <p className="v">{r.best.notes.join(' · ')}</p>
          <p className="s">목표 {fmt(r.best.target)}kcal</p>
        </div>
      )}
      <button type="button" className="btn-ghost pill" style={{ marginTop: 18 }} onClick={onShare}><Icon name="share" size="sm" />공유 이미지 만들기</button>
    </section>
  );
}

// ---------------- image ----------------
const W = 1080, H = 1350, PAD = 78;
export type RecapTone = 'light' | 'dark';
const TONES: Record<RecapTone, { bg: string; fg: string; fg2: string; muted: string; surface: string; ctrl: string }> = {
  light: { bg: '#FCFCFC', fg: '#0B0B0B', fg2: '#3A3A3A', muted: '#6B6B6B', surface: '#F3F3F3', ctrl: '#C9C9C9' },
  dark: { bg: '#0A0A0A', fg: '#F2F2F2', fg2: '#CFCFCF', muted: '#9B9B9B', surface: '#171717', ctrl: '#4A4A4A' },
};

export async function renderRecapImage(r: WeeklyRecapView, footer: string, tone: RecapTone): Promise<Blob> {
  const family = getComputedStyle(document.body).fontFamily;
  await Promise.all(['200', '300', '400', '500', '600'].map((w) => document.fonts.load(`${w} 40px ${family}`).catch(() => [])));
  const C = TONES[tone];
  const font = (w: number, px: number) => `${w} ${px}px ${family}`;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // brand orb cut by the corner, as on the meal table image
  const g = ctx.createRadialGradient(W - 40 - 69, 40 - 69, 0, W - 40, 40, 230);
  g.addColorStop(0, '#FFE6D0'); g.addColorStop(0.35, '#FFB37A'); g.addColorStop(0.7, '#FF7A45'); g.addColorStop(1, '#FF4F6D');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(W - 40, 40, 230, 0, Math.PI * 2); ctx.fill();

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.muted; ctx.font = font(500, 33);
  ctx.fillText(`${rangeText(r)} · ${r.current ? '이번 주' : '지난주'}`, PAD, 150);
  ctx.fillStyle = C.fg; ctx.font = font(300, 96);
  ctx.fillText(r.current ? '이번 주 회고' : '지난주 회고', PAD - 4, 262);

  // trend change, large
  const delta = r.trend.delta != null ? signedKg(r.trend.delta) : '–';
  ctx.font = font(200, 132);
  ctx.fillText(delta, PAD - 6, 430);
  let x = PAD - 6 + ctx.measureText(delta).width + 14;
  ctx.fillStyle = C.muted; ctx.font = font(400, 44);
  ctx.fillText('kg', x, 430);
  x += ctx.measureText('kg').width + 28;
  ctx.font = font(400, 37);
  ctx.fillText(r.trend.end != null ? `추세 ${r.trend.end.toFixed(1)}kg` : '', x, 424);

  // week strip: filled = kept, ring = logged, faint = nothing yet
  const step = (W - PAD * 2) / 7;
  r.strip.forEach((d, i) => {
    const cx = PAD + step * i + step / 2, cy = 545, rad = 33;
    ctx.globalAlpha = d.state === 'empty' || d.state === 'future' ? 0.6 : 1;
    ctx.beginPath(); ctx.arc(cx, cy, d.state === 'kept' ? rad : rad - 2.5, 0, Math.PI * 2);
    if (d.state === 'kept') { ctx.fillStyle = C.fg; ctx.fill(); }
    else {
      ctx.setLineDash(d.state === 'future' ? [8, 8] : []);
      ctx.lineWidth = 4.5; ctx.strokeStyle = d.state === 'logged' ? C.fg : C.ctrl; ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.muted; ctx.font = font(500, 31); ctx.textAlign = 'center';
    ctx.fillText(DOW[parseKey(d.key).getDay()]!, cx, 625);
    ctx.textAlign = 'left';
  });

  // three numbers
  const mv = movingStat(r);
  const stats: [string, string, string][] = [[`${r.kept}`, `/ ${r.days}일`, '지킨 날'], [`${r.workouts}`, '회', '홈트'], [mv.n, mv.unit, mv.label]];
  const colW = (W - PAD * 2) / 3;
  stats.forEach(([n, unit, label], i) => {
    const sx = PAD + colW * i;
    ctx.fillStyle = C.fg; ctx.font = font(300, 66);
    ctx.fillText(n, sx, 760);
    const nw = ctx.measureText(n).width;
    ctx.fillStyle = C.muted; ctx.font = font(400, 34);
    ctx.fillText(` ${unit}`, sx + nw, 760);
    ctx.font = font(400, 33);
    ctx.fillText(label, sx, 812);
  });

  // best day
  if (r.best) {
    const top = 880, h = 210;
    ctx.fillStyle = C.surface;
    ctx.beginPath(); ctx.roundRect(PAD - 6, top, W - (PAD - 6) * 2, h, 48); ctx.fill();
    ctx.fillStyle = C.muted; ctx.font = font(600, 33);
    ctx.fillText(`가장 잘 지킨 날 · ${mdw(parseKey(r.best.key))}`, PAD + 36, top + 66);
    ctx.fillStyle = C.fg; ctx.font = font(600, 42);
    ctx.fillText(r.best.notes.join(' · '), PAD + 36, top + 126);
    ctx.fillStyle = C.fg2; ctx.font = font(400, 34);
    ctx.fillText(`목표 ${fmt(r.best.target)}kcal`, PAD + 36, top + 176);
  }

  ctx.fillStyle = C.muted; ctx.font = font(500, 30);
  ctx.fillText(footer, PAD, H - 90);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('이미지를 만들지 못했습니다'))), 'image/png'));
}

/** Sheet with the image preview, the system share sheet (phones), copy (computers) and a download. */
export function ShareRecapSheet() {
  const env = useEnv();
  const { close, toast } = useOverlay();
  // the week as it is when the sheet opens; drawn once (the overlay re-renders while it animates)
  const [data] = useState(() => ({ r: weeklyRecapFor(env), footer: `다루 · ${todayView(env).ctx.week}주차` }));
  const [url, setUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const toastRef = useRef(toast);
  const [tone, setTone] = useState<RecapTone>(() =>
    (document.documentElement.getAttribute('data-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    let gone = false;
    let made: string | null = null;
    void renderRecapImage(data.r, data.footer, tone).then((blob) => {
      if (gone) return;
      made = URL.createObjectURL(blob);
      setUrl(made);
      setFile(new File([blob], `주간회고-${data.r.from}.png`, { type: 'image/png' }));
    }, () => toastRef.current('이미지를 만들지 못했습니다'));
    return () => { gone = true; if (made) URL.revokeObjectURL(made); };
  }, [data, tone]);

  const [phone] = useState(() => matchMedia('(pointer: coarse)').matches);
  const canShare = phone && !!file && !!navigator.canShare?.({ files: [file] });
  const canCopy = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;
  const share = async () => {
    if (!file) return;
    try { await navigator.share({ files: [file], title: '주간 회고' }); close(); } catch { /* cancelled */ }
  };
  const copy = async () => {
    if (!file) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': file })]);
      toast('복사했습니다. 카톡 대화창에 붙여넣으면 사진 한 장으로 갑니다');
    } catch {
      toast('이 브라우저는 이미지 복사를 막아서, 이미지 저장을 써 주세요');
    }
  };

  return (
    <div className="share-sheet">
      <SheetHead eyebrow="주간 회고 공유" title="이렇게 보입니다" />
      <div className="seg share-tone" role="group" aria-label="이미지 색">
        {(['light', 'dark'] as const).map((x) => (
          <button key={x} type="button" aria-pressed={tone === x} onClick={() => setTone(x)}>{x === 'light' ? '밝게' : '어둡게'}</button>
        ))}
      </div>
      <div className="share-preview">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not a page image */}
        {url ? <img src={url} alt="주간 회고 이미지" draggable={false} /> : <p className="note">이미지를 만드는 중입니다</p>}
      </div>
      <p className="note">{phone ? '이미지를 길게 눌러 사진에 저장할 수도 있습니다.' : '복사한 뒤 카톡 대화창에 붙여넣으면 사진 한 장으로 보내집니다.'}</p>
      <div className="share-actions">
        {canShare && <button type="button" className="btn-primary pill" onClick={() => void share()}><Icon name="share" />공유하기</button>}
        {!canShare && canCopy && file && <button type="button" className="btn-primary pill" onClick={() => void copy()}><Icon name="copy" />이미지 복사</button>}
        {url && file && (
          <a className={canShare || canCopy ? 'btn-ghost pill' : 'btn-primary pill'} href={url} download={file.name}><Icon name="download" />이미지 저장</a>
        )}
      </div>
    </div>
  );
}
