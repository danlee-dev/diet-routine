import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // workspace packages ship TypeScript source
  transpilePackages: ['@diet/core', '@diet/data'],
};

export default nextConfig;
