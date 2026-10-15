import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  outputFileTracingIncludes: { '/api/offers/*/pdf': ['./assets/fonts/**/*'], '/api/contracts/*/pdf': ['./assets/fonts/**/*'], '/api/contract-signings/*/pdf': ['./assets/fonts/**/*'], '/api/contract-signings/*/evidence': ['./assets/fonts/**/*'], '/api/purchase-condition/*/*/pdf': ['./assets/fonts/**/*'], '/api/advertising/invoices/*/pdf': ['./assets/fonts/**/*'], '/api/advertising/financial/*/pdf': ['./assets/fonts/**/*'] },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
    ] },
    { source: '/api/company-store-profile/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    { source: '/api/dealer-companies', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] }];
  }
};
export default nextConfig;
