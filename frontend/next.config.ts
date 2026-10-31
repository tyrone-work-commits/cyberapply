import type { NextConfig } from 'next';
const backend = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
const config: NextConfig = {
  devIndicators: false,
  async rewrites() { return [{ source: '/api/v1/:path*', destination: `${backend}/api/v1/:path*` }]; },
  async headers() { return [{source:'/sw.js',headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'}]},{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'same-origin'}]}]; },
};
export default config;
