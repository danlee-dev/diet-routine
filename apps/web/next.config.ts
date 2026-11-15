import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// Monorepo root (pnpm-lock.yaml lives there). Set explicitly so builds that run from apps/web
// (e.g. `vercel build`) still resolve hoisted packages like `next` from the root node_modules.
const root = path.join(import.meta.dirname, '..', '..');
const { version } = JSON.parse(readFileSync(path.join(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };

const nextConfig: NextConfig = {
  // shown in Settings > 앱 정보
  env: { NEXT_PUBLIC_APP_VERSION: version },
  cacheComponents: true,
  partialPrefetching: true,
  // workspace packages ship TypeScript source
  transpilePackages: ['@diet/core', '@diet/data'],
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default nextConfig;
