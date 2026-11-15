import { describe, expect, it } from 'vitest';
import { cityById, openMeteoUrl, parseForecast, rainCheck, rainText, wetHour } from '../src';

/** An Open-Meteo style reply for one day: [hour, prob %, mm, code]. */
function reply(date: string, rows: [number, number, number, number][]) {
  const all = Array.from({ length: 24 }, (_, h) => rows.find((r) => r[0] === h) ?? [h, 0, 0, 0]);
  return {
    hourly: {
      time: all.map(([h]) => `${date}T${String(h).padStart(2, '0')}:00`),
      precipitation_probability: all.map((r) => r[1]),
      precipitation: all.map((r) => r[2]),
      weather_code: all.map((r) => r[3]),
    },
  };
}

describe('weather', () => {
  it('builds a keyless URL with a coarse position', () => {
    const u = openMeteoUrl(37.56651, 126.97802);
    expect(u).toContain('latitude=37.6');
    expect(u).toContain('longitude=127.0');
    expect(u).not.toContain('key');
    expect(cityById('busan').name).toBe('부산');
    expect(cityById('nowhere').id).toBe('seoul');
  });

  it('reads hourly arrays and survives junk', () => {
    const h = parseForecast(reply('2026-11-15', [[15, 80, 1.2, 61]]));
    expect(h).toHaveLength(24);
    expect(h[15]).toMatchObject({ date: '2026-11-15', min: 900, prob: 80, mm: 1.2, code: 61 });
    expect(parseForecast(null)).toEqual([]);
    expect(parseForecast({ hourly: { time: 'x' } })).toEqual([]);
  });

  it('suggests staying in for two wet hours while one would walk', () => {
    const h = parseForecast(reply('2026-11-15', [[15, 70, 0.6, 61], [16, 80, 1.4, 63]]));
    const r = rainCheck(h, '2026-11-15', 10 * 60);
    expect(r).toMatchObject({ rain: true, snow: false, from: 900, peak: 80 });
    expect(rainText(r, 10 * 60)).toBe('15시부터 비 소식이 있습니다 (최대 80%)');
  });

  it('does not count a passing shower, night rain, rain already over, or another day', () => {
    expect(rainCheck(parseForecast(reply('2026-11-15', [[15, 70, 0.6, 61]])), '2026-11-15', 600).rain).toBe(false);
    expect(rainCheck(parseForecast(reply('2026-11-15', [[22, 90, 3, 63], [23, 90, 3, 63]])), '2026-11-15', 600).rain).toBe(false);
    expect(rainCheck(parseForecast(reply('2026-11-15', [[9, 90, 2, 63], [10, 90, 2, 63]])), '2026-11-15', 14 * 60).rain).toBe(false);
    expect(rainCheck(parseForecast(reply('2026-11-16', [[15, 90, 2, 63], [16, 90, 2, 63]])), '2026-11-15', 600).rain).toBe(false);
  });

  it('counts one heavy hour, and says snow when it snows', () => {
    expect(rainCheck(parseForecast(reply('2026-11-15', [[18, 60, 4, 65]])), '2026-11-15', 600).rain).toBe(true);
    const snow = rainCheck(parseForecast(reply('2026-11-15', [[13, 80, 1, 73], [14, 80, 1, 75]])), '2026-11-15', 13 * 60 + 20);
    expect(snow.snow).toBe(true);
    expect(rainText(snow, 13 * 60 + 20)).toBe('오늘 눈 소식이 있습니다 (최대 80%)');
  });

  it('treats a low chance as dry even with a wet code', () => {
    expect(wetHour({ time: '', date: '', min: 0, prob: 30, mm: 0.3, code: 61 })).toBe(false);
  });
});
