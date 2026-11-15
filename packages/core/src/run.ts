// GPS runs and walks: fix filtering, distance, auto-pause, km splits, pace, kcal, elevation,
// encoded routes and route geometry for maps and share cards.
// The phone feeds fixes into RunTracker live; anything stored can be replayed through the same code,
// so the iPhone and the web always agree on distance, pace and kcal.

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeoFix extends LatLng {
  /** epoch ms */
  t: number;
  /** horizontal accuracy radius in metres; null when the source does not say */
  acc?: number | null;
  /** altitude in metres */
  alt?: number | null;
  altAcc?: number | null;
  /** device ground speed in m/s (CoreLocation Doppler); negative or null when unknown */
  speed?: number | null;
}

export interface RunConfig {
  /** fixes with a worse accuracy radius are dropped */
  maxAccuracy: number;
  /** accuracy assumed when the source gives none */
  assumedAccuracy: number;
  /** speed no runner reaches (m/s); a jump faster than this is a GPS outlier */
  maxSpeed: number;
  /** consecutive outliers after which the filter re-anchors (the earlier fix was the bad one) */
  maxOutliers: number;
  /** distance is counted in steps of at least this many metres, so standing still adds nothing */
  minStep: number;
  /** below this speed the runner counts as stopped */
  pauseSpeed: number;
  /** stopped this long becomes auto-pause, and the stopped time is not counted */
  pauseAfterS: number;
  /** speed needed to leave auto-pause */
  resumeSpeed: number;
  /** current pace looks back this much moving time */
  paceWindowS: number;
  /** Kalman process noise floor (m/s) */
  kalmanQ: number;
  /** elevation gain ignores wiggles smaller than this */
  elevHysteresis: number;
  maxAltAccuracy: number;
  /** a gap between fixes longer than this is judged by the speed across it (tunnel vs app closed) */
  maxGapS: number;
}

export const RUN_CONFIG: RunConfig = {
  maxAccuracy: 20,
  assumedAccuracy: 10,
  maxSpeed: 11,
  maxOutliers: 5,
  minStep: 5,
  pauseSpeed: 0.5,
  pauseAfterS: 10,
  resumeSpeed: 1.0,
  paceWindowS: 30,
  kalmanQ: 3,
  elevHysteresis: 3,
  maxAltAccuracy: 15,
  maxGapS: 60,
};

const EARTH_R = 6371008.8;
const rad = (d: number): number => (d * Math.PI) / 180;
const clampN = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function pathLength(pts: LatLng[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversine(pts[i - 1]!, pts[i]!);
  return d;
}

// ---------------- smoothing ----------------
/** Position-only Kalman filter; the variance is in m^2 and the noise grows with time since the last fix. */
class LatLngKalman {
  private v = -1;
  private lat = 0;
  private lng = 0;
  private t = 0;

  reset(): void {
    this.v = -1;
  }

  step(f: GeoFix, acc: number, q: number): LatLng {
    if (this.v < 0) {
      this.lat = f.lat;
      this.lng = f.lng;
      this.v = acc * acc;
      this.t = f.t;
      return { lat: f.lat, lng: f.lng };
    }
    const dt = (f.t - this.t) / 1000;
    if (dt > 0) {
      this.v += dt * q * q;
      this.t = f.t;
    }
    const k = this.v / (this.v + acc * acc);
    this.lat += k * (f.lat - this.lat);
    this.lng += k * (f.lng - this.lng);
    this.v = (1 - k) * this.v;
    return { lat: this.lat, lng: this.lng };
  }
}

// ---------------- tracker ----------------
export type RunStatus = 'moving' | 'autoPaused' | 'paused';

export interface Split {
  /** 1-based km index */
  km: number;
  /** metres in this split: 1000, or less for the last partial split */
  m: number;
  /** moving seconds */
  s: number;
  /** seconds per km */
  pace: number;
  /** elevation gained in this split (m) */
  elev: number;
}

export interface RunLive {
  status: RunStatus;
  distance: number;
  movingS: number;
  currentPace: number | null;
  avgPace: number | null;
  elevGain: number;
  splits: Split[];
  /** the unfinished km so far (null under 10 m) */
  partial: Split | null;
  /** accuracy radius of the latest fix, accepted or not */
  accuracy: number | null;
  /** latest smoothed position */
  point: LatLng | null;
}

export type RejectReason = 'accuracy' | 'stale' | 'speed';

export interface IngestResult {
  accepted: boolean;
  reason?: RejectReason;
  /** km splits completed by this fix (usually none, sometimes one) */
  splits: Split[];
  /** status after this fix, when it changed */
  status?: RunStatus;
}

export interface RunSummary {
  distance_m: number;
  moving_s: number;
  elapsed_s: number;
  avg_pace_s_per_km: number | null;
  /** full km splits plus the last partial one */
  splits: Split[];
  elev_gain_m: number | null;
  route: LatLng[];
}

/** Recorded input, so a run can be rebuilt after the app restarts or replayed elsewhere. */
export type RunEvent = { k: 'fix'; f: GeoFix } | { k: 'pause'; t: number } | { k: 'resume'; t: number };

export class RunTracker {
  readonly cfg: RunConfig;
  readonly startedAt: number;
  private kf = new LatLngKalman();
  private status: RunStatus = 'moving';
  private lastRaw: GeoFix | null = null;
  private lastRawAcc = 0;
  private lastT = 0;
  private outliers = 0;
  private anchor: LatLng | null = null;
  private recent: { t: number; lat: number; lng: number }[] = [];
  private dist = 0;
  private movingMs = 0;
  private pendingMs = 0;
  private pendingDist = 0;
  private splitList: Split[] = [];
  private splitStartMs = 0;
  private splitStartElev = 0;
  private paceSamples: { ms: number; d: number }[] = [{ ms: 0, d: 0 }];
  private ema: number | null = null;
  private elevRef: number | null = null;
  private gain = 0;
  private hasAlt = false;
  private lastAcc: number | null = null;
  private point: LatLng | null = null;
  readonly route: LatLng[] = [];

  constructor(startedAt: number, cfg: Partial<RunConfig> = {}) {
    this.startedAt = startedAt;
    this.cfg = { ...RUN_CONFIG, ...cfg };
  }

  get state(): RunStatus {
    return this.status;
  }

  /** Manual pause: time until now still counts (the runner was moving when they pressed). */
  pause(): void {
    if (this.status === 'paused') return;
    this.settle();
    this.status = 'paused';
  }

  /**
   * Close the current stretch at the newest raw fix: counts the metres the step quantum and the filter lag
   * still hold back, and any short slowdown before it. Called on pause and finish.
   */
  private settle(): void {
    if (this.status !== 'moving') return;
    if (this.anchor && this.lastRaw) {
      const end = { lat: this.lastRaw.lat, lng: this.lastRaw.lng };
      const d = haversine(this.anchor, end);
      if (d > 0 && d <= 30) {
        this.pendingDist += d;
        this.anchor = end;
        this.route.push(end);
      }
    }
    if (this.pendingMs > 0 || this.pendingDist > 0) this.credit(this.pendingMs, this.pendingDist);
    this.pendingMs = 0;
    this.pendingDist = 0;
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.status = 'moving';
    this.anchor = null; // ground covered while paused does not count
  }

  ingest(f: GeoFix): IngestResult {
    const cfg = this.cfg;
    const acc = f.acc != null && Number.isFinite(f.acc) && f.acc > 0 ? f.acc : cfg.assumedAccuracy;
    this.lastAcc = acc;
    if (acc > cfg.maxAccuracy) return { accepted: false, reason: 'accuracy', splits: [] };
    if (this.lastT && f.t <= this.lastT) return { accepted: false, reason: 'stale', splits: [] };
    if (this.lastRaw) {
      const dt = (f.t - this.lastRaw.t) / 1000;
      const jump = Math.max(0, haversine(this.lastRaw, f) - 0.5 * (acc + this.lastRawAcc));
      if (jump / dt > cfg.maxSpeed) {
        this.outliers++;
        if (this.outliers < cfg.maxOutliers) return { accepted: false, reason: 'speed', splits: [] };
        // several "impossible" fixes in a row: the fix before them was the bad one; start over from here
        this.kf.reset();
        this.recent = [];
        this.anchor = null;
      }
    }
    this.outliers = 0;
    const dtMs = this.lastT ? f.t - this.lastT : 0;
    if (dtMs > cfg.maxGapS * 1000) this.settle(); // close the stretch before the gap at its last real fix
    this.lastRaw = f;
    this.lastRawAcc = acc;
    this.lastT = f.t;

    // After a long gap the device speed says nothing about the gap itself: a tunnel keeps a running speed
    // across it, a closed app or a long stop does not (and then the gap becomes auto-pause, uncounted).
    const v = dtMs > cfg.maxGapS * 1000 && this.point ? haversine(this.point, f) / (dtMs / 1000) : this.speedEstimate(f);
    const s = this.kf.step(f, acc, clampN(v, cfg.kalmanQ, 8));
    this.point = s;
    this.recent.push({ t: f.t, lat: s.lat, lng: s.lng });
    while (this.recent.length > 2 && this.recent[0]!.t < f.t - 10000) this.recent.shift();
    this.trackElevation(f);

    const prevStatus = this.status;
    const before = this.splitList.length;
    if (this.status === 'paused') {
      this.anchor = s;
      return { accepted: true, splits: [] };
    }

    if (this.status === 'autoPaused') {
      // anchor stays where the stop began: only net displacement counts, so jitter while stopped adds nothing
      if (v >= cfg.resumeSpeed) {
        this.status = 'moving';
        const d = this.anchor ? haversine(this.anchor, s) : 0;
        this.anchor = s;
        this.route.push(s);
        this.credit(dtMs, d);
      }
    } else {
      let d = 0;
      if (!this.anchor) {
        this.anchor = s;
        this.route.push(s);
      } else {
        const step = haversine(this.anchor, s);
        if (step >= cfg.minStep) {
          d = step;
          this.anchor = s;
          this.route.push(s);
        }
      }
      if (v >= cfg.pauseSpeed) {
        this.credit(this.pendingMs + dtMs, this.pendingDist + d);
        this.pendingMs = 0;
        this.pendingDist = 0;
      } else {
        this.pendingMs += dtMs;
        this.pendingDist += d;
        if (this.pendingMs >= cfg.pauseAfterS * 1000) {
          this.status = 'autoPaused';
          this.pendingMs = 0;
          this.pendingDist = 0;
        }
      }
    }
    return {
      accepted: true,
      splits: this.splitList.slice(before),
      ...(this.status !== prevStatus ? { status: this.status } : {}),
    };
  }

  /** Device speed when it has one, else displacement of the smoothed track over the last ~5 s. */
  private speedEstimate(f: GeoFix): number {
    if (f.speed != null && Number.isFinite(f.speed) && f.speed >= 0) return f.speed;
    const ref = this.recent.find((r) => r.t >= f.t - 5000) ?? this.recent[0];
    if (!ref || f.t - ref.t < 1000) return 0;
    return haversine(ref, f) / ((f.t - ref.t) / 1000);
  }

  private trackElevation(f: GeoFix): void {
    if (f.alt == null || !Number.isFinite(f.alt)) return;
    if (f.altAcc != null && (!(f.altAcc > 0) || f.altAcc > this.cfg.maxAltAccuracy)) return;
    this.hasAlt = true;
    this.ema = this.ema == null ? f.alt : this.ema + 0.3 * (f.alt - this.ema);
    if (this.elevRef == null) this.elevRef = this.ema;
    const rise = this.ema - this.elevRef;
    if (rise >= this.cfg.elevHysteresis) {
      if (this.status === 'moving') this.gain += rise;
      this.elevRef = this.ema;
    } else if (this.ema < this.elevRef) {
      this.elevRef = this.ema;
    }
  }

  private credit(dMs: number, dDist: number): void {
    const before = this.dist;
    const msBefore = this.movingMs;
    this.dist += dDist;
    this.movingMs += dMs;
    while (this.dist >= (this.splitList.length + 1) * 1000) {
      const boundary = (this.splitList.length + 1) * 1000;
      const frac = dDist > 0 ? (boundary - before) / dDist : 1;
      const at = msBefore + frac * dMs;
      const sec = (at - this.splitStartMs) / 1000;
      this.splitList.push({ km: this.splitList.length + 1, m: 1000, s: Math.round(sec), pace: Math.round(sec), elev: Math.round(this.gain - this.splitStartElev) });
      this.splitStartMs = at;
      this.splitStartElev = this.gain;
    }
    this.paceSamples.push({ ms: this.movingMs, d: this.dist });
    const cut = this.movingMs - this.cfg.paceWindowS * 1000;
    while (this.paceSamples.length > 2 && this.paceSamples[1]!.ms <= cut) this.paceSamples.shift();
  }

  /** Pace over the last ~30 s of moving time; null while stopped or when too little ground was covered. */
  currentPace(): number | null {
    if (this.status !== 'moving') return null;
    const first = this.paceSamples[0]!;
    const dms = this.movingMs - first.ms;
    const dd = this.dist - first.d;
    if (dd < 20 || dms < 10000) return null;
    return Math.round(dms / 1000 / (dd / 1000));
  }

  live(): RunLive {
    return {
      status: this.status,
      distance: this.dist,
      movingS: Math.round(this.movingMs / 1000),
      currentPace: this.currentPace(),
      avgPace: avgPace(this.dist, this.movingMs / 1000),
      elevGain: Math.round(this.gain),
      splits: [...this.splitList],
      partial: this.allSplits()[this.splitList.length] ?? null,
      accuracy: this.lastAcc,
      point: this.point,
    };
  }

  /** Full km splits plus the unfinished last one (when it is at least 10 m). */
  allSplits(): Split[] {
    const out = [...this.splitList];
    const m = this.dist - this.splitList.length * 1000;
    if (m >= 10) {
      const sec = (this.movingMs - this.splitStartMs) / 1000;
      out.push({ km: this.splitList.length + 1, m: Math.round(m), s: Math.round(sec), pace: Math.round(sec / (m / 1000)), elev: Math.round(this.gain - this.splitStartElev) });
    }
    return out;
  }

  summary(endedAt: number): RunSummary {
    this.settle();
    const moving = Math.round(this.movingMs / 1000);
    return {
      distance_m: Math.round(this.dist * 10) / 10,
      moving_s: moving,
      elapsed_s: Math.max(moving, Math.round((endedAt - this.startedAt) / 1000)),
      avg_pace_s_per_km: avgPace(this.dist, this.movingMs / 1000),
      splits: this.allSplits(),
      elev_gain_m: this.hasAlt ? Math.round(this.gain * 10) / 10 : null,
      route: [...this.route],
    };
  }
}

/** Rebuild a tracker from recorded events (app restart, or re-analysis on the web). */
export function replayRun(startedAt: number, events: RunEvent[], cfg: Partial<RunConfig> = {}): RunTracker {
  const tr = new RunTracker(startedAt, cfg);
  for (const e of events) {
    if (e.k === 'fix') tr.ingest(e.f);
    else if (e.k === 'pause') tr.pause();
    else tr.resume();
  }
  return tr;
}

export const avgPace = (distanceM: number, movingS: number): number | null =>
  distanceM >= 50 && movingS > 0 ? Math.round(movingS / (distanceM / 1000)) : null;

/** Index of the fastest full km (partial last split excluded unless it is the only one). */
export function fastestSplit(splits: Split[]): number {
  const full = splits.filter((s) => s.m >= 1000);
  const pool = full.length ? full : splits;
  if (!pool.length) return -1;
  const best = pool.reduce((a, b) => (b.pace < a.pace ? b : a));
  return splits.indexOf(best);
}

// ---------------- energy and steps ----------------
// Speed (km/h) -> MET. Walking and running from the Compendium of Physical Activities,
// joined linearly between brisk walking (6.4 km/h) and an easy run (8.0 km/h).
const MET_TABLE: [number, number][] = [
  [0, 1.0], [3.2, 2.8], [4.0, 3.0], [4.8, 3.5], [5.6, 4.3], [6.4, 5.0], [8.0, 8.3], [8.4, 9.0], [9.7, 9.8],
  [10.8, 10.5], [11.3, 11.0], [12.1, 11.5], [12.9, 11.8], [13.8, 12.3], [14.5, 12.8], [16.1, 14.5], [17.7, 16.0], [19.3, 19.0],
];

export function metForSpeed(kmh: number): number {
  if (!(kmh > 0)) return 1;
  for (let i = 1; i < MET_TABLE.length; i++) {
    const [x1, y1] = MET_TABLE[i]!;
    if (kmh <= x1) {
      const [x0, y0] = MET_TABLE[i - 1]!;
      return y0 + ((kmh - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return MET_TABLE[MET_TABLE.length - 1]![1];
}

/**
 * Active kcal (on top of resting burn, like Apple's Active Energy): sum over splits of (MET - 1) x kg x hours.
 * Resting burn is already inside the daily maintenance estimate, so only this part is extra.
 */
export function runKcal(splits: Pick<Split, 'm' | 's'>[], weightKg: number): number {
  let kcal = 0;
  for (const sp of splits) {
    if (!(sp.s > 0) || !(sp.m > 0)) continue;
    const kmh = (sp.m / sp.s) * 3.6;
    kcal += (metForSpeed(kmh) - 1) * weightKg * (sp.s / 3600);
  }
  return Math.round(kcal);
}

/** Share of run kcal added to the day's food budget (the rest is the deficit). */
export const RUN_CREDIT_RATIO = 0.5;
export const runKcalCredit = (kcal: number | null | undefined, ratio = RUN_CREDIT_RATIO): number =>
  kcal && kcal > 0 ? Math.round(kcal * clampN(ratio, 0, 1)) : 0;

/**
 * Steps estimated from splits when no pedometer count is available.
 * Running (>= 7 km/h): cadence rises with speed, about 163 spm at 9 km/h. Walking: stride = 0.415 x height.
 */
export function estimateRunSteps(splits: Pick<Split, 'm' | 's'>[], heightCm: number): number {
  let steps = 0;
  for (const sp of splits) {
    if (!(sp.s > 0) || !(sp.m > 0)) continue;
    const kmh = (sp.m / sp.s) * 3.6;
    if (kmh >= 7) steps += (clampN(140 + 2.5 * kmh, 150, 185) * sp.s) / 60;
    else steps += sp.m / (0.415 * (heightCm / 100));
  }
  return Math.round(steps);
}

// ---------------- formatting and voice ----------------
/** 372 -> 6'12" */
export function paceText(sPerKm: number | null | undefined): string {
  if (sPerKm == null || !Number.isFinite(sPerKm) || sPerKm <= 0 || sPerKm >= 3600) return `-'--"`;
  const r = Math.round(sPerKm);
  return `${Math.floor(r / 60)}'${String(r % 60).padStart(2, '0')}"`;
}

/** 1925 -> 32:05, 3725 -> 1:02:05 */
export function clockText(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 5023.4 -> '5.02' (km, two decimals, truncated like run apps so 0.999 never shows as 1.00) */
export const kmText = (m: number): string => (Math.floor(Math.max(0, m) / 10) / 100).toFixed(2);

/** Spoken cue at each km: "1킬로미터. 페이스 6분 12초." */
export function splitCue(split: Split, totalS?: number): string {
  const p = Math.round(split.pace);
  const pace = `${Math.floor(p / 60)}분 ${p % 60}초`;
  const total = totalS != null ? ` 총 시간 ${Math.floor(totalS / 60)}분 ${Math.floor(totalS % 60)}초.` : '';
  return `${split.km}킬로미터. 이번 구간 페이스 ${pace}.${total}`;
}

// ---------------- encoded polyline (Google format) ----------------
export function encodePolyline(pts: LatLng[], precision = 5): string {
  const f = 10 ** precision;
  let out = '';
  let pLat = 0;
  let pLng = 0;
  const enc = (v: number) => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    while (x >= 0x20) {
      out += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>= 5;
    }
    out += String.fromCharCode(x + 63);
  };
  for (const p of pts) {
    const lat = Math.round(p.lat * f);
    const lng = Math.round(p.lng * f);
    enc(lat - pLat);
    enc(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return out;
}

export function decodePolyline(s: string, precision = 5): LatLng[] {
  const f = 10 ** precision;
  const out: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const dec = (): number => {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < s.length);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += dec();
    lng += dec();
    out.push({ lat: lat / f, lng: lng / f });
  }
  return out;
}

// ---------------- geometry ----------------
/** Local flat projection in metres around a reference latitude (fine at city scale). */
const projector = (lat0: number) => {
  const kx = (Math.PI / 180) * EARTH_R * Math.cos(rad(lat0));
  const ky = (Math.PI / 180) * EARTH_R;
  return (p: LatLng) => ({ x: p.lng * kx, y: p.lat * ky });
};

/** Douglas-Peucker in metres; keeps the shape within `tolM`. */
export function simplifyRoute(pts: LatLng[], tolM = 2): LatLng[] {
  if (pts.length <= 2) return [...pts];
  const proj = projector(pts[0]!.lat);
  const xy = pts.map(proj);
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const A = xy[a]!;
    const B = xy[b]!;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const P = xy[i]!;
      let d: number;
      if (len2 === 0) d = Math.hypot(P.x - A.x, P.y - A.y);
      else {
        const t = clampN(((P.x - A.x) * dx + (P.y - A.y) * dy) / len2, 0, 1);
        d = Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
      }
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx >= 0 && maxD > tolM) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export function routeBBox(routes: LatLng[][]): BBox | null {
  let b: BBox | null = null;
  for (const r of routes) for (const p of r) {
    if (!b) b = { minLat: p.lat, minLng: p.lng, maxLat: p.lat, maxLng: p.lng };
    else {
      b.minLat = Math.min(b.minLat, p.lat);
      b.maxLat = Math.max(b.maxLat, p.lat);
      b.minLng = Math.min(b.minLng, p.lng);
      b.maxLng = Math.max(b.maxLng, p.lng);
    }
  }
  return b;
}

export interface ProjectedRoutes {
  /** SVG path data per route, north up, fitted into the box */
  paths: string[];
  start: { x: number; y: number } | null;
  end: { x: number; y: number } | null;
  /** metres per output unit */
  metersPerUnit: number;
}

/** Fit routes into a w x h box (with padding) for SVG drawing: share cards, history thumbnails, territory art. */
export function projectRoutes(routes: LatLng[][], w: number, h: number, pad = 0): ProjectedRoutes {
  const bb = routeBBox(routes);
  if (!bb) return { paths: [], start: null, end: null, metersPerUnit: 1 };
  const proj = projector((bb.minLat + bb.maxLat) / 2);
  const lo = proj({ lat: bb.minLat, lng: bb.minLng });
  const hi = proj({ lat: bb.maxLat, lng: bb.maxLng });
  const spanX = Math.max(hi.x - lo.x, 1);
  const spanY = Math.max(hi.y - lo.y, 1);
  const scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
  const ox = (w - spanX * scale) / 2;
  const oy = (h - spanY * scale) / 2;
  const toXY = (p: LatLng) => {
    const q = proj(p);
    return { x: ox + (q.x - lo.x) * scale, y: h - (oy + (q.y - lo.y) * scale) };
  };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const paths = routes.map((r) => r.map((p, i) => { const q = toXY(p); return `${i ? 'L' : 'M'}${r2(q.x)} ${r2(q.y)}`; }).join(''));
  const first = routes.find((r) => r.length);
  const last = [...routes].reverse().find((r) => r.length);
  return {
    paths,
    start: first ? toXY(first[0]!) : null,
    end: last ? toXY(last[last.length - 1]!) : null,
    metersPerUnit: 1 / scale,
  };
}

// ---------------- my map: new ground and closed loops ----------------
const cellKey = (x: number, y: number) => `${x},${y}`;

/**
 * Metres of `route` that pass through ground none of `previous` covered.
 * Previous routes are rasterised into cells; a neighbouring cell counts as covered, so a street run on
 * the other sidewalk or with GPS offset is not "new".
 */
export function newDistance(route: LatLng[], previous: LatLng[][], cellM = 25): number {
  if (route.length < 2) return 0;
  const proj = projector(route[0]!.lat);
  const covered = new Set<string>();
  const mark = (a: LatLng, b: LatLng) => {
    const A = proj(a);
    const B = proj(b);
    const n = Math.max(1, Math.ceil(Math.hypot(B.x - A.x, B.y - A.y) / (cellM / 2)));
    for (let i = 0; i <= n; i++) {
      const x = A.x + ((B.x - A.x) * i) / n;
      const y = A.y + ((B.y - A.y) * i) / n;
      covered.add(cellKey(Math.floor(x / cellM), Math.floor(y / cellM)));
    }
  };
  for (const r of previous) {
    if (r.length === 1) mark(r[0]!, r[0]!);
    for (let i = 1; i < r.length; i++) mark(r[i - 1]!, r[i]!);
  }
  const near = (x: number, y: number) => {
    const cx = Math.floor(x / cellM);
    const cy = Math.floor(y / cellM);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (covered.has(cellKey(cx + dx, cy + dy))) return true;
    return false;
  };
  let fresh = 0;
  for (let i = 1; i < route.length; i++) {
    const A = proj(route[i - 1]!);
    const B = proj(route[i]!);
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const n = Math.max(1, Math.ceil(len / (cellM / 2)));
    for (let k = 0; k < n; k++) {
      const x = A.x + ((B.x - A.x) * (k + 0.5)) / n;
      const y = A.y + ((B.y - A.y) * (k + 0.5)) / n;
      if (!near(x, y)) fresh += len / n;
    }
  }
  return Math.round(fresh);
}

/** Area (m^2) enclosed by a route that ends near where it started; null when it is not a loop. */
export function closedLoopArea(route: LatLng[], maxGapM = 80, minLengthM = 400): number | null {
  if (route.length < 4) return null;
  if (haversine(route[0]!, route[route.length - 1]!) > maxGapM) return null;
  if (pathLength(route) < minLengthM) return null;
  const proj = projector(route[0]!.lat);
  const xy = route.map(proj);
  let a = 0;
  for (let i = 0; i < xy.length; i++) {
    const p = xy[i]!;
    const q = xy[(i + 1) % xy.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.round(Math.abs(a) / 2);
}

// ---------------- stored row ----------------
/** Row shape of public.runs (supabase/migrations). */
export interface RunRow {
  id: string;
  kind: 'run' | 'walk';
  started_at: string;
  ended_at: string | null;
  distance_m: number;
  moving_s: number;
  elapsed_s: number;
  avg_pace_s_per_km: number | null;
  kcal: number | null;
  elev_gain_m: number | null;
  avg_cadence: number | null;
  splits: Split[] | null;
  /** encoded, simplified route */
  polyline: string | null;
  bbox: BBox | null;
  new_distance_m: number | null;
  closed_area_m2: number | null;
  health_uuid: string | null;
  updated_at?: string;
  deleted_at?: string | null;
}
