import type { NextConfig } from 'next';

/**
 * Browser-side defences (PRD §10.1). The app never needs to be framed, to open the camera or microphone, or to post forms
 * to another origin (except Cashfree's checkout, which clients are handed to when they pay an invoice), so all of that is
 * switched off. A script-src CSP would need per-request nonces for Next's inline
 * runtime; that is listed as a follow-up in docs/security.md rather than shipped half-done.
 */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://*.cashfree.com; object-src 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
];

const config: NextConfig = {
  transpilePackages: ['@freelanceos/shared'],
  poweredByHeader: false,
  async headers() { return [{ source: '/:path*', headers: securityHeaders }]; },
};

export default config;
