// Apple Maps (no key) showing routes. Two camera modes: follow the runner, or fit every route.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { AppleMaps } from 'expo-maps';
import { routeBBox, simplifyRoute, type LatLng } from '@diet/core';
import { useTheme } from '@/lib/theme';

// AppleMapsMapStyleEmphasis.MUTED; the enum is not re-exported from the package root
const MUTED = 'MUTED' as NonNullable<AppleMaps.MapProperties['emphasis']>;

export type MapCamera = { kind: 'follow'; point: LatLng | null; zoom?: number } | { kind: 'fit' };

const toCoord = (p: LatLng) => ({ latitude: p.lat, longitude: p.lng });

/**
 * expo-maps turns zoom into an equal lat/lng span of 360 / 2^zoom degrees; pick the zoom that holds the box.
 * `bottomCover` is the share of the map hidden under a panel: the box is fitted into the part above it.
 */
function fitCamera(routes: LatLng[][], bottomCover = 0) {
  const bb = routeBBox(routes);
  if (!bb) return undefined;
  const latSpan = Math.max(bb.maxLat - bb.minLat, 0.001);
  const span = (Math.max(latSpan, bb.maxLng - bb.minLng, 0.002) * 1.5) / (1 - bottomCover);
  return {
    coordinates: { latitude: (bb.minLat + bb.maxLat) / 2 - (span * bottomCover) / 2, longitude: (bb.minLng + bb.maxLng) / 2 },
    zoom: Math.min(18, Math.max(3, Math.log2(360 / span))),
  };
}

const ignore = () => {};

export function RunMap({ routes, camera, style, showsUser = false, lineWidth = 5, markEnds = true, bottomCover = 0 }: {
  routes: LatLng[][];
  bottomCover?: number;
  camera: MapCamera;
  style?: StyleProp<ViewStyle>;
  showsUser?: boolean;
  lineWidth?: number;
  markEnds?: boolean;
}) {
  const t = useTheme();
  const ref = useRef<AppleMaps.MapView>(null);
  const lastMove = useRef(0);

  // long routes: thin out for display only (stored data is untouched)
  const polylines = useMemo(() => routes.filter((r) => r.length > 1).map((r, i) => ({
    id: `r${i}`,
    coordinates: (r.length > 600 ? simplifyRoute(r, 3) : r).map(toCoord),
    color: t.orb1,
    width: lineWidth,
  })), [routes, t.orb1, lineWidth]);

  const ends = useMemo(() => {
    const lines = routes.filter((g) => g.length);
    if (!markEnds || !lines.length || lines.flat().length < 2) return [];
    const first = lines[0]![0]!;
    const last = lines[lines.length - 1]!.at(-1)!;
    // circles are sized in metres; scale with the route so the ends read at the fitted zoom
    const bb = routeBBox(lines)!;
    const diag = Math.hypot((bb.maxLat - bb.minLat) * 111_000, (bb.maxLng - bb.minLng) * 111_000 * Math.cos((bb.minLat * Math.PI) / 180));
    const radius = Math.min(150, Math.max(10, diag * 0.028));
    return [
      { id: 'start', center: toCoord(first), radius, color: t.bg, lineColor: t.fg, lineWidth: 3 },
      { id: 'end', center: toCoord(last), radius, color: t.fg, lineColor: t.bg, lineWidth: 3 },
    ];
  }, [routes, markEnds, t.bg, t.fg]);

  const fit = camera.kind === 'fit' ? fitCamera(routes, bottomCover) : undefined;
  const followPoint = camera.kind === 'follow' ? camera.point : null;
  const followZoom = camera.kind === 'follow' ? camera.zoom ?? 16.5 : 16.5;
  const [initial] = useState(() => fit ?? (followPoint ? { coordinates: toCoord(followPoint), zoom: followZoom } : undefined));

  // follow: recentre at most every 2 s so the map does not jitter
  useEffect(() => {
    if (!followPoint) return;
    const now = Date.now();
    if (now - lastMove.current < 2000) return;
    lastMove.current = now;
    ref.current?.setCameraPosition({ coordinates: toCoord(followPoint), zoom: followZoom }).catch(ignore);
  }, [followPoint, followZoom]);

  // fit: refit when the set of routes changes
  const fitKey = fit ? `${fit.coordinates.latitude.toFixed(5)},${fit.coordinates.longitude.toFixed(5)},${fit.zoom.toFixed(2)}` : '';
  const firstFit = useRef(fitKey);
  useEffect(() => {
    // the initial cameraPosition already shows the first fit; the native view may not be registered yet either
    if (!fit || fitKey === firstFit.current) return;
    firstFit.current = fitKey;
    ref.current?.setCameraPosition(fit).catch(ignore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return (
    <AppleMaps.View
      ref={ref}
      style={style}
      cameraPosition={initial}
      polylines={polylines}
      circles={ends}
      properties={{ isMyLocationEnabled: showsUser, emphasis: MUTED, pointsOfInterest: { including: [] }, selectionEnabled: false }}
      uiSettings={{ compassEnabled: false, myLocationButtonEnabled: false, scaleBarEnabled: false, togglePitchEnabled: false }}
    />
  );
}
