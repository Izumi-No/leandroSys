import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

if (process.env.NODE_ENV === 'development') {
  const projectEnvFile = resolve(process.cwd(), '../../.env.development.local');
  if (existsSync(projectEnvFile)) process.loadEnvFile(projectEnvFile);
}

const nextConfig: NextConfig = {
  transpilePackages: ['@leandrosys/api', '@leandrosys/shared'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
