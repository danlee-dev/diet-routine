// Same tokens as the web (apps/web/app/globals.css). Dark neutrals are R=G=B, no blue tint.
import { useColorScheme } from 'react-native';

const light = {
  bg: '#FCFCFC', surface: '#F3F3F3', surface2: '#E8E8E8', line: '#E2E2E2', ctrl: '#C9C9C9',
  fg: '#0B0B0B', fg2: '#3A3A3A', muted: '#6B6B6B', onFg: '#FFFFFF', scrim: 'rgba(0,0,0,0.36)',
  orb1: '#FF7A45', orb2: '#FF4F6D', orb3: '#FFB37A', orb4: '#FFE6D0',
};
const dark: typeof light = {
  bg: '#0A0A0A', surface: '#171717', surface2: '#262626', line: '#262626', ctrl: '#4A4A4A',
  fg: '#F2F2F2', fg2: '#CFCFCF', muted: '#9B9B9B', onFg: '#0A0A0A', scrim: 'rgba(0,0,0,0.6)',
  orb1: '#F0743F', orb2: '#E24C68', orb3: '#D88C55', orb4: '#5E3E2C',
};

export type Theme = typeof light;
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);

export const R = { xs: 12, sm: 16, md: 22, lg: 28, xl: 34 } as const;
/** Apple continuous corners on every rounded surface. */
export const squircle = { borderCurve: 'continuous' as const };
