// A route (or every route) drawn as a clean line, north up, fitted into a box. Used for list thumbnails,
// the "my map" preview and the share card. Geometry comes from @diet/core so the web draws the same shape.
import { Circle, Path, Svg } from 'react-native-svg';
import { projectRoutes, type LatLng } from '@diet/core';

export function RouteArt({ routes, width, height, color, strokeWidth = 3, pad = 6, ends = false, endColor, opacity = 1 }: {
  routes: LatLng[][];
  width: number;
  height: number;
  color: string;
  strokeWidth?: number;
  pad?: number;
  /** start ring and end dot */
  ends?: boolean;
  endColor?: string;
  opacity?: number;
}) {
  const p = projectRoutes(routes, width, height, pad + strokeWidth);
  const dot = strokeWidth * 1.15;
  return (
    <Svg width={width} height={height}>
      {p.paths.map((d, i) => (
        <Path key={i} d={d} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" fill="none" opacity={opacity} />
      ))}
      {ends && p.start && <Circle cx={p.start.x} cy={p.start.y} r={dot} fill="none" stroke={endColor ?? color} strokeWidth={strokeWidth * 0.6} />}
      {ends && p.end && <Circle cx={p.end.x} cy={p.end.y} r={dot} fill={endColor ?? color} />}
    </Svg>
  );
}
