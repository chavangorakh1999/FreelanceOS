import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@freelanceos/shared'],
  poweredByHeader: false,
};

export default config;
