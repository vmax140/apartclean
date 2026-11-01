import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // packages/shared je TypeScript izvor, ne build artefakt — Next ga mora sam prevesti.
  transpilePackages: ['@apartclean/shared'],
};

export default nextConfig;
