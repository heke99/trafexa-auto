import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  outputFileTracingIncludes: { '/api/offers/*/pdf': ['./assets/fonts/**/*'], '/api/contracts/*/pdf': ['./assets/fonts/**/*'], '/api/contract-signings/*/pdf': ['./assets/fonts/**/*'], '/api/contract-signings/*/evidence': ['./assets/fonts/**/*'], '/api/purchase-condition/*/*/pdf': ['./assets/fonts/**/*'] },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
    ] }];
  }
};
export default nextConfig;
