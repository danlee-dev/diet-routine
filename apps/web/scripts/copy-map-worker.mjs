// MapLibre runs its tile work in a module worker it loads by URL. Bundlers do not ship that file, so copy it
// into public/ before dev and build (gitignored; always the installed version).
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(require.resolve('maplibre-gl/package.json'));
const out = path.join(import.meta.dirname, '..', 'public', 'maplibre');
mkdirSync(out, { recursive: true });
copyFileSync(path.join(pkgDir, 'dist', 'maplibre-gl-worker.mjs'), path.join(out, 'maplibre-gl-worker.mjs'));
