import path from 'node:path';
import type { NextConfig } from 'next';

// Monorepo root (pnpm-lock.yaml lives there). Set explicitly so builds that run from apps/web
// (e.g. `vercel build`) still resolve hoisted packages like `next` from the root node_modules.
const root = path.join(import.meta.dirname, '..', '..');

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // workspace packages ship TypeScript source
  transpilePackages: ['@diet/core', '@diet/data'],
  turbopack: { root },
  outputFileTracingRoot: root,
};

export default nextConfig;
