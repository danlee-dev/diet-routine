import { describe, expect, it } from 'vitest';
import {
  RunTracker, WALK_CONFIG, clockText, closedLoopArea, decodePolyline, encodePolyline, estimateRunSteps, fastestSplit, haversine, kmText,
  metForSpeed, newDistance, paceText, pathLength, projectRoutes, replayRun, runKcal, runKcalCredit, simplifyRoute, splitCue,
  type GeoFix, type LatLng, type RunEvent,
} from '../src';

const O: LatLng = { lat: 37.5665, lng: 126.978 }; // Seoul City Hall
const R = 6371008.8;
/** point dx metres east, dy metres north of `o` */
const at = (dx: number, dy: number, o: LatLng = O): LatLng => ({
  lat: o.lat + (dy / R) * (180 / Math.PI),
  lng: o.lng + (dx / (R * Math.cos((o.lat * Math.PI) / 180))) * (180 / Math.PI),
});

/** deterministic noise in [-1, 1] */
function rng(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  };
}

const T0 = Date.UTC(2026, 10, 15, 21, 0, 0);

/** 1 Hz fixes along +x at `speed` m/s for `secs`, with GPS noise of +-`noise` m */
function straight(opts: { from?: number; t0?: number; secs: number; speed: number; noise?: number; acc?: number; withSpeed?: boolean; seed?: number; alt?: (i: number) => number }): GeoFix[] {
  const r = rng(opts.seed ?? 7);
  const out: GeoFix[] = [];
  for (let i = 0; i <= opts.secs; i++) {
    const x = (opts.from ?? 0) + opts.speed * i;
    const p = at(x + (opts.noise ?? 0) * r(), (opts.noise ?? 0) * r());
    out.push({ ...p, t: (opts.t0 ?? T0) + i * 1000, acc: opts.acc ?? 5, speed: opts.withSpeed === false ? null : opts.speed, alt: opts.alt?.(i) ?? null, altAcc: opts.alt ? 4 : null });
  }
  return out;
}

describe('haversine', () => {
  it('measures one degree of latitude as ~111.2 km', () => {
    expect(haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111195, -1);
  });
  it('agrees with the local offset helper', () => {
    expect(haversine(O, at(300, 400))).toBeCloseTo(500, 0);
  });
});

describe('RunTracker distance and splits', () => {
  it('counts a clean 1.1 km run within 1%', () => {
    const tr = new RunTracker(T0);
    const fixes = straight({ secs: 367, speed: 3, noise: 2 });
    const done = fixes.flatMap((f) => tr.ingest(f).splits);
    const s = tr.summary(fixes.at(-1)!.t);
    expect(s.distance_m).toBeGreaterThan(1089);
    expect(s.distance_m).toBeLessThan(1112);
    expect(done).toHaveLength(1);
    expect(done[0]!.km).toBe(1);
    expect(Math.abs(done[0]!.pace - 333)).toBeLessThanOrEqual(6);
    expect(s.splits).toHaveLength(2);
    expect(s.splits[1]!.m).toBeLessThan(1000);
  });

  it('works without device speed (implied speed from the track)', () => {
    const tr = new RunTracker(T0);
    const fixes = straight({ secs: 300, speed: 2.8, noise: 2, withSpeed: false });
    for (const f of fixes) tr.ingest(f);
    const d = tr.summary(fixes.at(-1)!.t).distance_m;
    expect(d).toBeGreaterThan(832);
    expect(d).toBeLessThan(849);
  });

  it('drops inaccurate, stale and impossible fixes', () => {
    const tr = new RunTracker(T0);
    const fixes = straight({ secs: 120, speed: 3, noise: 1 });
    for (const f of fixes.slice(0, 60)) tr.ingest(f);
    expect(tr.ingest({ ...at(1000, 0), t: fixes[60]!.t, acc: 5, speed: 3 }).reason).toBe('speed');
    expect(tr.ingest({ ...fixes[60]!, acc: 45 }).reason).toBe('accuracy');
    expect(tr.ingest({ ...fixes[59]! }).reason).toBe('stale');
    for (const f of fixes.slice(60)) tr.ingest(f);
    expect(tr.summary(fixes.at(-1)!.t).distance_m).toBeCloseTo(360, -1);
  });

  it('re-anchors after a run of outliers (the earlier fix was the bad one)', () => {
    const tr = new RunTracker(T0);
    const a = straight({ secs: 30, speed: 3 });
    for (const f of a) tr.ingest(f);
    // GPS was stuck; now every fix is 600 m away. After 5 rejections the tracker accepts the new place.
    const b = straight({ from: 690, t0: a.at(-1)!.t + 1000, secs: 30, speed: 3 });
    const reasons = b.slice(0, 6).map((f) => tr.ingest(f).reason);
    expect(reasons.slice(0, 4)).toEqual(['speed', 'speed', 'speed', 'speed']);
    expect(reasons[4]).toBeUndefined();
  });
});

describe('auto-pause and manual pause', () => {
  it('removes a 60 s stop at a crossing from moving time and adds no jitter distance', () => {
    const tr = new RunTracker(T0);
    const run1 = straight({ secs: 100, speed: 3, noise: 1 });
    const r = rng(3);
    const stop: GeoFix[] = Array.from({ length: 60 }, (_, i) => ({ ...at(300 + 3 * r(), 3 * r()), t: run1.at(-1)!.t + (i + 1) * 1000, acc: 8, speed: 0.1 }));
    const run2 = straight({ from: 300, t0: stop.at(-1)!.t + 1000, secs: 100, speed: 3, noise: 1, seed: 11 });
    const statuses: string[] = [];
    for (const f of [...run1, ...stop, ...run2]) {
      const res = tr.ingest(f);
      if (res.status) statuses.push(res.status);
    }
    const s = tr.summary(run2.at(-1)!.t);
    expect(statuses).toEqual(['autoPaused', 'moving']);
    expect(s.distance_m).toBeGreaterThan(588);
    expect(s.distance_m).toBeLessThan(615);
    expect(s.moving_s).toBeGreaterThanOrEqual(199);
    expect(s.moving_s).toBeLessThanOrEqual(203);
    expect(s.elapsed_s).toBe(261);
  });

  it('does not count a 30 min gap after the app was closed, but counts a 90 s tunnel', () => {
    const closed = new RunTracker(T0);
    const a = straight({ secs: 100, speed: 3 });
    const b = straight({ from: 350, t0: a.at(-1)!.t + 30 * 60_000, secs: 100, speed: 3, seed: 4 });
    for (const f of [...a, ...b]) closed.ingest(f);
    const s1 = closed.summary(b.at(-1)!.t);
    expect(s1.moving_s).toBeLessThanOrEqual(202);
    expect(s1.distance_m).toBeCloseTo(600, -1);

    const tunnel = new RunTracker(T0);
    const c = straight({ from: 570, t0: a.at(-1)!.t + 90_000, secs: 100, speed: 3, seed: 4 });
    for (const f of [...a, ...c]) tunnel.ingest(f);
    const s2 = tunnel.summary(c.at(-1)!.t);
    expect(s2.moving_s).toBeCloseTo(290, -1);
    expect(s2.distance_m).toBeCloseTo(870, -1);
  });

  it('does not auto-pause for a short slowdown', () => {
    const tr = new RunTracker(T0);
    const a = straight({ secs: 60, speed: 3 });
    const slow: GeoFix[] = Array.from({ length: 6 }, (_, i) => ({ ...at(180 + 0.3 * (i + 1), 0), t: a.at(-1)!.t + (i + 1) * 1000, acc: 5, speed: 0.3 }));
    const b = straight({ from: 182, t0: slow.at(-1)!.t + 1000, secs: 60, speed: 3 });
    for (const f of [...a, ...slow, ...b]) expect(tr.ingest(f).status).toBeUndefined();
    expect(tr.summary(b.at(-1)!.t).moving_s).toBe(127); // 60 + 6 + 1 + 60 s, nothing removed
  });

  it('excludes manual pause time and ground covered while paused', () => {
    const events: RunEvent[] = [];
    const a = straight({ secs: 100, speed: 3 });
    events.push(...a.map((f) => ({ k: 'fix' as const, f })));
    events.push({ k: 'pause', t: a.at(-1)!.t });
    // walks 100 m to a shop while paused
    const walk = straight({ from: 300, t0: a.at(-1)!.t + 1000, secs: 80, speed: 1.25 });
    events.push(...walk.map((f) => ({ k: 'fix' as const, f })));
    events.push({ k: 'resume', t: walk.at(-1)!.t });
    const b = straight({ from: 400, t0: walk.at(-1)!.t + 1000, secs: 100, speed: 3, seed: 5 });
    events.push(...b.map((f) => ({ k: 'fix' as const, f })));
    const tr = replayRun(T0, events);
    const s = tr.summary(b.at(-1)!.t);
    expect(s.distance_m).toBeCloseTo(600, -1);
    expect(s.moving_s).toBeGreaterThanOrEqual(199);
    expect(s.moving_s).toBeLessThanOrEqual(201);
  });
});

describe('pace', () => {
  it('reports current pace over the last 30 s and null when stopped', () => {
    const tr = new RunTracker(T0);
    const easy = straight({ secs: 120, speed: 2.5 }); // 6'40"
    const fast = straight({ from: 300, t0: easy.at(-1)!.t + 1000, secs: 60, speed: 4 }); // 4'10"
    for (const f of [...easy, ...fast]) tr.ingest(f);
    const live = tr.live();
    expect(Math.abs(live.currentPace! - 250)).toBeLessThanOrEqual(5);
    expect(live.avgPace!).toBeGreaterThan(250);
    expect(live.avgPace!).toBeLessThan(400);
    tr.pause();
    expect(tr.live().currentPace).toBeNull();
  });

  it('picks the fastest full km', () => {
    const splits = [
      { km: 1, m: 1000, s: 380, pace: 380, elev: 0 },
      { km: 2, m: 1000, s: 352, pace: 352, elev: 0 },
      { km: 3, m: 1000, s: 361, pace: 361, elev: 0 },
      { km: 4, m: 300, s: 90, pace: 300, elev: 0 },
    ];
    expect(fastestSplit(splits)).toBe(1);
    expect(fastestSplit([])).toBe(-1);
  });
});

describe('elevation', () => {
  it('sums a steady 30 m climb and ignores flat noise', () => {
    const r = rng(9);
    const climb = new RunTracker(T0);
    const c = straight({ secs: 400, speed: 3, alt: (i) => 20 + (30 * i) / 400 + 1.5 * r() });
    for (const f of c) climb.ingest(f);
    const g = climb.summary(c.at(-1)!.t).elev_gain_m!;
    expect(g).toBeGreaterThan(24);
    expect(g).toBeLessThan(34);

    const flat = new RunTracker(T0);
    const f2 = straight({ secs: 400, speed: 3, alt: () => 20 + 1.5 * r() });
    for (const f of f2) flat.ingest(f);
    expect(flat.summary(f2.at(-1)!.t).elev_gain_m!).toBeLessThan(3);
  });

  it('reports null elevation when the source has none', () => {
    const tr = new RunTracker(T0);
    const f = straight({ secs: 30, speed: 3 });
    for (const x of f) tr.ingest(x);
    expect(tr.summary(f.at(-1)!.t).elev_gain_m).toBeNull();
  });
});

describe('energy, steps, credit', () => {
  it('interpolates MET between table rows', () => {
    expect(metForSpeed(0)).toBe(1);
    expect(metForSpeed(8.0)).toBeCloseTo(8.3);
    expect(metForSpeed(9.05)).toBeCloseTo(9.4, 1);
    expect(metForSpeed(40)).toBe(19);
  });

  it('gives ~350 active kcal for 5 km at 6\'30" and 76 kg', () => {
    const splits = Array.from({ length: 5 }, (_, i) => ({ km: i + 1, m: 1000, s: 390, pace: 390, elev: 0 }));
    const kcal = runKcal(splits, 76);
    expect(kcal).toBeGreaterThan(320);
    expect(kcal).toBeLessThan(380);
    expect(runKcalCredit(kcal)).toBe(Math.round(kcal / 2));
    expect(runKcalCredit(null)).toBe(0);
    expect(runKcalCredit(300, 2)).toBe(300);
  });

  it('estimates steps for running and walking', () => {
    const run = estimateRunSteps([{ m: 1000, s: 390 }], 171); // ~162 spm x 6.5 min
    expect(run).toBeGreaterThan(1000);
    expect(run).toBeLessThan(1150);
    const walk = estimateRunSteps([{ m: 1000, s: 720 }], 171); // 0.71 m stride
    expect(walk).toBeGreaterThan(1350);
    expect(walk).toBeLessThan(1450);
  });
});

describe('formatting', () => {
  it('formats pace, clock and km', () => {
    expect(paceText(372)).toBe(`6'12"`);
    expect(paceText(null)).toBe(`-'--"`);
    expect(clockText(1925)).toBe('32:05');
    expect(clockText(3725)).toBe('1:02:05');
    expect(kmText(5023.4)).toBe('5.02');
    expect(kmText(999)).toBe('0.99');
  });

  it('speaks a Korean split cue', () => {
    expect(splitCue({ km: 1, m: 1000, s: 372, pace: 372, elev: 0 })).toBe('1킬로미터. 이번 구간 페이스 6분 12초.');
  });
});

describe('corners', () => {
  it('keeps an L-shaped 1 km route within 1% (no corner cutting)', () => {
    const tr = new RunTracker(T0);
    const r = rng(21);
    const fixes: GeoFix[] = [];
    for (let i = 0; i <= 333; i++) {
      const d = i * 3;
      const p = d <= 500 ? at(d, 0) : at(500, d - 500);
      fixes.push({ ...at(2 * r(), 2 * r(), p), t: T0 + i * 1000, acc: 5, speed: 3 });
    }
    for (const f of fixes) tr.ingest(f);
    const dist = tr.summary(fixes.at(-1)!.t).distance_m;
    expect(dist).toBeGreaterThan(990);
    expect(dist).toBeLessThan(1012);
  });
});

describe('polyline and geometry', () => {
  it('matches the reference encoding and round-trips', () => {
    const pts = [{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }];
    const enc = encodePolyline(pts);
    expect(enc).toBe('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
    expect(decodePolyline(enc)).toEqual(pts);
  });

  it('simplifies a straight line to its ends and keeps corners', () => {
    const line = Array.from({ length: 50 }, (_, i) => at(i * 10, 0));
    expect(simplifyRoute(line)).toHaveLength(2);
    const corner = [...line, ...Array.from({ length: 50 }, (_, i) => at(490, (i + 1) * 10))];
    expect(simplifyRoute(corner)).toHaveLength(3);
  });

  it('fits routes into a box north-up', () => {
    const p = projectRoutes([[at(0, 0), at(0, 1000)]], 100, 200, 10);
    expect(p.paths[0]!.startsWith('M')).toBe(true);
    expect(p.start!.y).toBeGreaterThan(p.end!.y); // north is up
    expect(p.start!.y).toBeCloseTo(190, 0);
    expect(p.end!.y).toBeCloseTo(10, 0);
    expect(p.metersPerUnit).toBeCloseTo(1000 / 180, 1);
  });

  it('counts only ground not covered before as new distance', () => {
    const route = Array.from({ length: 41 }, (_, i) => at(i * 25, 0));
    expect(newDistance(route, [])).toBeCloseTo(1000, -1);
    const offset = route.map((p) => at(0, 8, p)); // other sidewalk
    expect(newDistance(route, [offset])).toBe(0);
    const half = route.slice(0, 21);
    expect(newDistance(route, [half])).toBeGreaterThan(400);
    expect(newDistance(route, [half])).toBeLessThan(500);
  });

  it('measures a closed loop and ignores an out-and-back line', () => {
    const sq: LatLng[] = [];
    for (let i = 0; i <= 20; i++) sq.push(at(i * 10, 0));
    for (let i = 1; i <= 20; i++) sq.push(at(200, i * 10));
    for (let i = 1; i <= 20; i++) sq.push(at(200 - i * 10, 200));
    for (let i = 1; i <= 20; i++) sq.push(at(0, 200 - i * 10));
    expect(closedLoopArea(sq)).toBeCloseTo(40000, -2);
    const line = Array.from({ length: 30 }, (_, i) => at(i * 30, 0));
    expect(closedLoopArea(line)).toBeNull();
    expect(pathLength(sq)).toBeCloseTo(800, 0);
  });
});

describe('review regressions', () => {
  it('does not count paused time when every fix during the pause was rejected', () => {
    const tr = new RunTracker(T0);
    const a = straight({ secs: 100, speed: 3 });
    for (const f of a) tr.ingest(f);
    tr.pause();
    for (let i = 1; i <= 55; i++) tr.ingest({ ...at(300, 0), t: a.at(-1)!.t + i * 1000, acc: 35, speed: 0 }); // indoors
    tr.resume();
    const b = straight({ from: 300, t0: a.at(-1)!.t + 56_000, secs: 100, speed: 3, seed: 3 });
    for (const f of b) tr.ingest(f);
    expect(tr.summary(b.at(-1)!.t).moving_s).toBeLessThanOrEqual(201);
  });

  it('keeps a slow walk through a 40 s stop with the walking thresholds', () => {
    const tr = new RunTracker(T0, WALK_CONFIG);
    const r = rng(5);
    const fixes: GeoFix[] = [];
    let x = 0;
    let t = T0;
    for (let i = 0; i <= 120; i++) { const v = 0.85 + 0.1 * r(); x += v; fixes.push({ ...at(x, 0), t, acc: 6, speed: v }); t += 1000; }
    for (let i = 0; i < 40; i++) { fixes.push({ ...at(x + 2 * r(), 2 * r()), t, acc: 8, speed: 0.05 }); t += 1000; }
    for (let i = 0; i < 1200; i++) { const v = 0.85 + 0.1 * r(); x += v; fixes.push({ ...at(x, 0), t, acc: 6, speed: v }); t += 1000; }
    for (const f of fixes) tr.ingest(f);
    const s = tr.summary(t);
    expect(s.distance_m).toBeGreaterThan(x * 0.97);
    expect(s.distance_m).toBeLessThan(x * 1.03);
    expect(s.moving_s).toBeGreaterThan(1300);
  });

  it('leaves auto-pause on net ground covered even when the speed reads low', () => {
    const tr = new RunTracker(T0);
    const a = straight({ secs: 60, speed: 3 });
    const stop: GeoFix[] = Array.from({ length: 20 }, (_, i) => ({ ...at(180, 0), t: a.at(-1)!.t + (i + 1) * 1000, acc: 5, speed: 0 }));
    // slow shuffle at 0.8 m/s reported speed: below resumeSpeed, but 40 m of real ground
    const slow: GeoFix[] = Array.from({ length: 50 }, (_, i) => ({ ...at(180 + 0.8 * (i + 1), 0), t: stop.at(-1)!.t + (i + 1) * 1000, acc: 5, speed: 0.8 }));
    for (const f of [...a, ...stop, ...slow]) tr.ingest(f);
    expect(tr.state).toBe('moving');
  });

  it('starts a new segment after a manual pause and after an uncounted gap, not across a tunnel', () => {
    const paused = new RunTracker(T0);
    const a = straight({ secs: 60, speed: 3 });
    for (const f of a) paused.ingest(f);
    paused.pause();
    for (const f of straight({ from: 180, t0: a.at(-1)!.t + 1000, secs: 60, speed: 1.3, seed: 2 })) paused.ingest(f);
    paused.resume();
    for (const f of straight({ from: 260, t0: a.at(-1)!.t + 62_000, secs: 60, speed: 3, seed: 4 })) paused.ingest(f);
    expect(paused.summary(a.at(-1)!.t + 122_000).segments).toHaveLength(2);

    const closed = new RunTracker(T0);
    for (const f of a) closed.ingest(f);
    for (const f of straight({ from: 400, t0: a.at(-1)!.t + 20 * 60_000, secs: 60, speed: 3, seed: 4 })) closed.ingest(f);
    expect(closed.summary(a.at(-1)!.t + 21 * 60_000).segments).toHaveLength(2);

    const tunnel = new RunTracker(T0);
    for (const f of a) tunnel.ingest(f);
    for (const f of straight({ from: 450, t0: a.at(-1)!.t + 90_000, secs: 60, speed: 3, seed: 4 })) tunnel.ingest(f);
    expect(tunnel.summary(a.at(-1)!.t + 150_000).segments).toHaveLength(1);
  });

  it('drops a cached fix from before the start', () => {
    const tr = new RunTracker(T0);
    expect(tr.ingest({ ...at(-300, 0), t: T0 - 120_000, acc: 5, speed: 0 }).reason).toBe('stale');
  });

  it('auto-pauses while standing even without device speed', () => {
    const tr = new RunTracker(T0);
    const a = straight({ secs: 100, speed: 3, withSpeed: false });
    const r = rng(8);
    const stand: GeoFix[] = Array.from({ length: 120 }, (_, i) => ({ ...at(300 + 3 * r(), 3 * r()), t: a.at(-1)!.t + (i + 1) * 1000, acc: 8, speed: -1 }));
    for (const f of [...a, ...stand]) tr.ingest(f);
    const s = tr.summary(stand.at(-1)!.t);
    expect(s.moving_s).toBeLessThanOrEqual(115);
    expect(s.distance_m).toBeLessThan(312);
  });

  it('does not ratchet up elevation from +-4 m noise on flat ground', () => {
    const r = rng(13);
    const tr = new RunTracker(T0);
    const f = straight({ secs: 1700, speed: 3, alt: () => 20 + 4 * r() });
    for (const x of f) tr.ingest(x);
    expect(tr.summary(f.at(-1)!.t).elev_gain_m!).toBeLessThan(15);
  });
});
