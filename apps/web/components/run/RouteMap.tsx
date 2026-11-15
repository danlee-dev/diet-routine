'use client';
// Runs on a real map: MapLibre GL with OpenFreeMap tiles (free, no key). Every colour in the base style is turned
// into its own grey (R=G=B), so the route in the brand gradient is the only colour on the map.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Map as MLMap, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { routeBBox, type LatLng } from '@diet/core';

const STYLE_URL = { light: 'https://tiles.openfreemap.org/styles/positron', dark: 'https://tiles.openfreemap.org/styles/dark' } as const;
const ORB = { light: ['#FF7A45', '#FF4F6D'], dark: ['#F0743F', '#E24C68'] } as const;
type Mode = keyof typeof STYLE_URL;

// ---------------- theme ----------------
const readMode = (): Mode => {
  const forced = document.documentElement.getAttribute('data-theme');
  if (forced === 'dark' || forced === 'light') return forced;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};
function subscribeMode(fn: () => void) {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', fn);
  const mo = new MutationObserver(fn);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => { mq.removeEventListener('change', fn); mo.disconnect(); };
}
export const useMapMode = (): Mode => useSyncExternalStore(subscribeMode, readMode, () => 'light');

// ---------------- grey style ----------------
const NAMED: Record<string, [number, number, number]> = { white: [255, 255, 255], black: [0, 0, 0] };

/** "#abc", "#aabbcc", "rgb(a)", "hsl(a)", white/black -> [r, g, b, a], or null for anything else. */
function parseColor(s: string): [number, number, number, number] | null {
  const t = s.trim().toLowerCase();
  if (NAMED[t]) return [...NAMED[t]!, 1];
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    const h = m[1]!;
    const full = h.length <= 4 ? h.split('').map((c) => c + c).join('') : h;
    const n = (i: number) => parseInt(full.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(t);
  if (m) {
    const [r, g, b, a] = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
    return [r ?? 0, g ?? 0, b ?? 0, a ?? 1];
  }
  m = /^hsla?\(([^)]+)\)$/.exec(t);
  if (m) {
    const [h, sRaw, lRaw, a] = m[1]!.split(/[ ,/]+/).filter(Boolean);
    const H = Number.parseFloat(h ?? '0'), S = Number.parseFloat(sRaw ?? '0') / 100, L = Number.parseFloat(lRaw ?? '0') / 100;
    const k = (n: number) => (n + H / 30) % 12;
    const f = (n: number) => L - S * Math.min(L, 1 - L) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0) * 255, f(8) * 255, f(4) * 255, a == null ? 1 : Number.parseFloat(a)];
  }
  return null;
}

function toGrey(s: string): string {
  const c = parseColor(s);
  if (!c) return s;
  const l = Math.round(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]);
  return c[3] < 1 ? `rgba(${l},${l},${l},${+c[3].toFixed(3)})` : `rgb(${l},${l},${l})`;
}

const greyDeep = (v: unknown): unknown =>
  typeof v === 'string' ? toGrey(v) : Array.isArray(v) ? v.map(greyDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, greyDeep(x)])) : v;

function greyStyle(style: StyleSpecification): StyleSpecification {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      const paint = { ...(layer.paint ?? {}) } as Record<string, unknown>;
      for (const k of Object.keys(paint)) if (k.endsWith('-color')) paint[k] = greyDeep(paint[k]);
      if (layer.type === 'raster') paint['raster-saturation'] = -1;
      return { ...layer, paint } as typeof layer;
    }),
  };
}

const styleCache = new Map<Mode, Promise<StyleSpecification>>();
function loadStyle(mode: Mode): Promise<StyleSpecification> {
  let p = styleCache.get(mode);
  if (!p) {
    p = fetch(STYLE_URL[mode]).then((r) => { if (!r.ok) throw new Error(`style ${r.status}`); return r.json() as Promise<StyleSpecification>; }).then(greyStyle);
    p.catch(() => styleCache.delete(mode));
    styleCache.set(mode, p);
  }
  return p;
}

// ---------------- map ----------------
const lineFeatures = (routes: LatLng[][]) => ({
  type: 'FeatureCollection' as const,
  features: routes.filter((r) => r.length > 1).map((r) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates: r.map((p) => [p.lng, p.lat]) } })),
});

const endFeatures = (routes: LatLng[][]) => {
  const lines = routes.filter((r) => r.length);
  const first = lines[0]?.[0];
  const last = lines.at(-1)?.at(-1);
  if (!first || !last) return { type: 'FeatureCollection' as const, features: [] };
  return {
    type: 'FeatureCollection' as const,
    features: [
      { type: 'Feature' as const, properties: { end: 0 }, geometry: { type: 'Point' as const, coordinates: [first.lng, first.lat] } },
      { type: 'Feature' as const, properties: { end: 1 }, geometry: { type: 'Point' as const, coordinates: [last.lng, last.lat] } },
    ],
  };
};

export function RouteMap({ routes, markEnds = true, lineWidth = 5, padding = 48, className, label }: {
  routes: LatLng[][];
  markEnds?: boolean;
  lineWidth?: number;
  padding?: number;
  className?: string;
  label: string;
}) {
  const mode = useMapMode();
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const routesKey = routes.map((r) => `${r.length}:${r[0]?.lat ?? ''}`).join('|');

  useEffect(() => {
    let cancelled = false;
    let map: MLMap | null = null;
    void (async () => {
      const [ml, style] = await Promise.all([import('maplibre-gl'), loadStyle(mode)]).catch(() => [null, null] as const);
      if (cancelled || !box.current || !ml || !style) return;
      // the worker file is copied into public/ by scripts/copy-map-worker.mjs
      if (!ml.getWorkerUrl().includes('/maplibre/maplibre-gl-worker')) ml.setWorkerUrl(`${location.origin}/maplibre/maplibre-gl-worker.mjs?v=${ml.getVersion()}`);
      const bb = routeBBox(routes);
      const fg = mode === 'dark' ? '#F2F2F2' : '#0B0B0B';
      const bg = mode === 'dark' ? '#0A0A0A' : '#FCFCFC';
      map = new ml.Map({
        container: box.current,
        style,
        bounds: bb ? [[bb.minLng, bb.minLat], [bb.maxLng, bb.maxLat]] : undefined,
        fitBoundsOptions: { padding, maxZoom: 16.5 },
        center: bb ? undefined : [126.978, 37.5665],
        zoom: bb ? undefined : 11,
        attributionControl: { compact: true },
        cooperativeGestures: true,
        pitchWithRotate: false,
        dragRotate: false,
        locale: {
          'CooperativeGesturesHandler.WindowsHelpText': 'Ctrl 키를 누른 채 스크롤하면 지도를 확대합니다',
          'CooperativeGesturesHandler.MacHelpText': '⌘ 키를 누른 채 스크롤하면 지도를 확대합니다',
          'CooperativeGesturesHandler.MobileHelpText': '두 손가락으로 지도를 움직입니다',
        },
      });
      mapRef.current = map;
      map.on('load', () => {
        if (!map) return;
        map.addSource('route', { type: 'geojson', data: lineFeatures(routes), lineMetrics: true });
        // a thin halo in the page colour keeps the line readable over roads
        map.addLayer({ id: 'route-halo', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': bg, 'line-width': lineWidth + 3, 'line-opacity': 0.9 } });
        map.addLayer({
          id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-width': lineWidth, 'line-gradient': ['interpolate', ['linear'], ['line-progress'], 0, ORB[mode][0], 1, ORB[mode][1]] },
        });
        if (markEnds) {
          map.addSource('ends', { type: 'geojson', data: endFeatures(routes) });
          map.addLayer({
            id: 'ends', type: 'circle', source: 'ends',
            paint: {
              'circle-radius': 6.5, 'circle-stroke-width': 3,
              'circle-color': ['case', ['==', ['get', 'end'], 1], fg, bg],
              'circle-stroke-color': ['case', ['==', ['get', 'end'], 1], bg, fg],
            },
          });
        }
      });
    })();
    return () => { cancelled = true; map?.remove(); mapRef.current = null; };
    // routesKey stands for the routes; a theme change rebuilds the map with the other base style
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, routesKey, markEnds, lineWidth, padding]);

  // keep the canvas sized to its box (two-column layout, window resizes)
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => mapRef.current?.resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return <div ref={box} className={`route-map${className ? ` ${className}` : ''}`} role="img" aria-label={label} />;
}
