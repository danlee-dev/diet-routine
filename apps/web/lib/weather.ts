'use client';
// Forecast for the rain check: the browser's coarse position when the user turned it on in Settings
// (this device only), otherwise the city chosen there. Cached for an hour per place.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { coarse, openMeteoUrl, parseForecast, type HourRain } from '@diet/core';
import { weatherCity, type Env } from '@diet/data';
import { devicePref } from './client';

const TTL = 60 * 60 * 1000;
const LOC_KEY = 'weatherUseLocation';

// ---------------- the device-location switch (per browser) ----------------
const locListeners = new Set<() => void>();
export const weatherLocation = {
  get: (): boolean => devicePref.get<boolean>(LOC_KEY, false),
  set: (on: boolean) => { devicePref.set(LOC_KEY, on); for (const fn of locListeners) fn(); },
  subscribe: (fn: () => void) => { locListeners.add(fn); return () => { locListeners.delete(fn); }; },
};
export const useWeatherLocation = (): boolean => useSyncExternalStore(weatherLocation.subscribe, weatherLocation.get, () => false);

/** Ask the browser once for a rough position (also triggers its permission prompt). */
export function coarsePosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: coarse(p.coords.latitude), lng: coarse(p.coords.longitude) }),
      () => resolve(null),
      { enableHighAccuracy: false, maximumAge: 3 * 60 * 60 * 1000, timeout: 10_000 },
    );
  });
}

interface Cached { key: string; at: number; hours: HourRain[] }

async function forecastFor(lat: number, lng: number): Promise<HourRain[] | null> {
  const key = `${coarse(lat)},${coarse(lng)}`;
  const c = devicePref.get<Cached | null>('forecast', null);
  if (c && c.key === key && Date.now() - c.at < TTL) return c.hours;
  try {
    const r = await fetch(openMeteoUrl(lat, lng));
    if (!r.ok) return null;
    const hours = parseForecast(await r.json());
    if (hours.length) devicePref.set('forecast', { key, at: Date.now(), hours } satisfies Cached);
    return hours;
  } catch {
    return null;
  }
}

/** Hourly forecast for today, fetched only while `active` (a walking day). null until it arrives or if it fails. */
export function useForecast(env: Env, active: boolean): HourRain[] | null {
  const useLoc = useWeatherLocation();
  const city = weatherCity(env);
  const [hours, setHours] = useState<HourRain[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      const pos = useLoc ? await coarsePosition() : null;
      const at = pos ?? { lat: city.lat, lng: city.lng };
      const h = await forecastFor(at.lat, at.lng);
      if (!cancelled) setHours(h);
    })();
    return () => { cancelled = true; };
  }, [active, useLoc, city.lat, city.lng]);
  return active ? hours : null;
}
