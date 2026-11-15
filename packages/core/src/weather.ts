// Rain on walking days: read an Open-Meteo forecast (no key) and decide whether to suggest a home workout.
// Fetching happens in each app; this file only builds the URL, reads the reply and makes the call.

export interface City { id: string; name: string; lat: number; lng: number }

/** Cities to pick from when the device location is off. */
export const CITIES: City[] = [
  { id: 'seoul', name: '서울', lat: 37.5665, lng: 126.978 },
  { id: 'incheon', name: '인천', lat: 37.4563, lng: 126.7052 },
  { id: 'suwon', name: '수원', lat: 37.2636, lng: 127.0286 },
  { id: 'seongnam', name: '성남', lat: 37.42, lng: 127.1266 },
  { id: 'goyang', name: '고양', lat: 37.6584, lng: 126.832 },
  { id: 'yongin', name: '용인', lat: 37.2411, lng: 127.1776 },
  { id: 'chuncheon', name: '춘천', lat: 37.8813, lng: 127.7298 },
  { id: 'gangneung', name: '강릉', lat: 37.7519, lng: 128.8761 },
  { id: 'cheongju', name: '청주', lat: 36.6424, lng: 127.489 },
  { id: 'cheonan', name: '천안', lat: 36.8151, lng: 127.1139 },
  { id: 'sejong', name: '세종', lat: 36.48, lng: 127.289 },
  { id: 'daejeon', name: '대전', lat: 36.3504, lng: 127.3845 },
  { id: 'jeonju', name: '전주', lat: 35.8242, lng: 127.148 },
  { id: 'gwangju', name: '광주', lat: 35.1595, lng: 126.8526 },
  { id: 'daegu', name: '대구', lat: 35.8714, lng: 128.6014 },
  { id: 'pohang', name: '포항', lat: 36.019, lng: 129.3435 },
  { id: 'ulsan', name: '울산', lat: 35.5384, lng: 129.3114 },
  { id: 'changwon', name: '창원', lat: 35.2281, lng: 128.6811 },
  { id: 'busan', name: '부산', lat: 35.1796, lng: 129.0756 },
  { id: 'jeju', name: '제주', lat: 33.4996, lng: 126.5312 },
];
export const DEFAULT_CITY = 'seoul';
export const cityById = (id: string | null | undefined): City => CITIES.find((c) => c.id === id) ?? CITIES[0]!;

/** About 11 km: enough for a forecast, without sending an exact position. */
export const coarse = (x: number): number => Math.round(x * 10) / 10;

export function openMeteoUrl(lat: number, lng: number): string {
  const q = new URLSearchParams({
    latitude: coarse(lat).toFixed(1),
    longitude: coarse(lng).toFixed(1),
    hourly: 'precipitation_probability,precipitation,weather_code',
    timezone: 'Asia/Seoul',
    forecast_days: '2',
  });
  return `https://api.open-meteo.com/v1/forecast?${q.toString()}`;
}

export interface HourRain {
  /** local 'YYYY-MM-DDTHH:00' */
  time: string;
  date: string;
  /** minutes since midnight */
  min: number;
  prob: number;
  mm: number;
  code: number;
}

/** Reads Open-Meteo's hourly arrays. Returns [] for anything unexpected. */
export function parseForecast(json: unknown): HourRain[] {
  const h = (json as { hourly?: { time?: unknown; precipitation_probability?: unknown; precipitation?: unknown; weather_code?: unknown } } | null)?.hourly;
  if (!h || !Array.isArray(h.time)) return [];
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const prob = arr(h.precipitation_probability), mm = arr(h.precipitation), code = arr(h.weather_code);
  const out: HourRain[] = [];
  h.time.forEach((t, i) => {
    if (typeof t !== 'string' || t.length < 16) return;
    out.push({
      time: t, date: t.slice(0, 10), min: Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)),
      prob: Number(prob[i]) || 0, mm: Number(mm[i]) || 0, code: Number(code[i]) || 0,
    });
  });
  return out;
}

// WMO codes: drizzle, rain, freezing rain, snow, showers, thunderstorm
const WET = (c: number) => (c >= 51 && c <= 67) || (c >= 71 && c <= 77) || (c >= 80 && c <= 86) || c >= 95;
const SNOW = (c: number) => (c >= 71 && c <= 77) || c === 85 || c === 86;

/** An hour worth staying in for. */
export const wetHour = (h: HourRain): boolean => h.mm >= 1 || (h.prob >= 60 && (h.mm >= 0.2 || WET(h.code)));

export interface RainCheck {
  rain: boolean;
  snow: boolean;
  /** first wet hour in the window, minutes */
  from: number | null;
  /** highest chance in the window, % */
  peak: number;
  /** total mm in the window */
  mm: number;
}

/**
 * Rain while one would walk today: from now (not before 07:00) until 21:00. Two wet hours, or one heavy
 * hour (3 mm+), is enough to suggest staying in.
 */
export function rainCheck(hours: HourRain[], date: string, nowMin: number, endMin = 21 * 60): RainCheck {
  const start = Math.max(nowMin - 59, 7 * 60);
  const win = hours.filter((h) => h.date === date && h.min >= start && h.min < endMin);
  const wet = win.filter(wetHour);
  const rain = wet.length >= 2 || wet.some((h) => h.mm >= 3);
  return {
    rain,
    snow: rain && wet.some((h) => SNOW(h.code)),
    from: wet[0]?.min ?? null,
    peak: Math.max(0, ...win.map((h) => h.prob)),
    mm: Math.round(win.reduce((a, h) => a + h.mm, 0) * 10) / 10,
  };
}

/** "15시부터 비 소식이 있습니다 (최대 80%)". */
export function rainText(r: RainCheck, nowMin: number): string {
  const what = r.snow ? '눈' : '비';
  const when = r.from == null || r.from <= nowMin ? '오늘' : `${Math.floor(r.from / 60)}시부터`;
  return `${when} ${what} 소식이 있습니다 (최대 ${r.peak}%)`;
}
