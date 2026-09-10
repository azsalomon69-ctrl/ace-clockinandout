const apiUrl = String(process.env.ACE_API_URL || process.env.ACE_API_URL_FALLBACK || '').replace(/\/$/, '');
if (!apiUrl) throw new Error('Missing ACE_API_URL and ACE_API_URL_FALLBACK. Set one in Vercel Project Settings before deploying.');

let apiOrigin: string;
try {
  const parsed = new URL(apiUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
  apiOrigin = parsed.origin;
} catch {
  throw new Error('ACE_API_URL or ACE_API_URL_FALLBACK must be a valid HTTP(S) URL.');
}

export const config = {
  outputDirectory: 'dist',
  cleanUrls: true,
  headers: [
    {
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
        { key: 'Content-Security-Policy', value: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; connect-src 'self' ${apiOrigin} https://*.supabase.co https://api.cloudinary.com; font-src 'self' data: https://fonts.gstatic.com; manifest-src 'self'; worker-src 'none'; upgrade-insecure-requests` },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        { key: 'Cache-Control', value: 'no-cache, must-revalidate' }
      ]
    }
  ]
};