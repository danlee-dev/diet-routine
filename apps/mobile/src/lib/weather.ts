// Forecast for the rain check: this phone's rough position when the user turned it on in Settings (asks for
// location permission then), otherwise the city chosen there. Cached for an hour per place.
import { useEffect, useState, useSyncExternalStore } from 'react';
import * as Location from 'expo-location';
import { coarse, openMeteoUrl, parseForecast, type HourRain } from '@diet/core';
import { weatherCity, type Env } from '@diet/data';
import { devicePref } from './env';

const TTL = 60 * 60 * 1000;
const LOC_KEY = 'weatherUseLocation';

const listeners = new Set<() => void>();
export const weatherLocation = {
  get: (): boolean => devicePref.get<boolean>(LOC_KEY, false),
  set: (on: boolean) => { devicePref.set(LOC_KEY, on); for (const fn of listeners) fn(); },
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
};
export const useWeatherLocation = (): boolean => useSyncExternalStore(weatherLocation.subscribe, weatherLocation.get, weatherLocation.get);

/** Ask once (when switching on) and return a rough position, or null if not allowed. */
export async function coarsePosition(ask: boolean): Promise<{ lat: number; lng: number } | null> {
  try {
    const perm = ask ? await Location.requestForegroundPermissionsAsync() : await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') return null;
    const p = (await Location.getLastKnownPositionAsync({ maxAge: 3 * 60 * 60 * 1000 }))
      ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest }));
    return { lat: coarse(p.coords.latitude), lng: coarse(p.coords.longitude) };
  } catch {
    return null;
  }
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

/** Hourly forecast, fetched only while `active` (a walking day). null until it arrives or if it fails. */
export function useForecast(env: Env, active: boolean): HourRain[] | null {
  const useLoc = useWeatherLocation();
  const city = weatherCity(env);
  const [hours, setHours] = useState<HourRain[] | null>(null);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      const pos = useLoc ? await coarsePosition(false) : null;
      const at = pos ?? { lat: city.lat, lng: city.lng };
      const h = await forecastFor(at.lat, at.lng);
      if (!cancelled) setHours(h);
    })();
    return () => { cancelled = true; };
  }, [active, useLoc, city.lat, city.lng]);
  return active ? hours : null;
}
