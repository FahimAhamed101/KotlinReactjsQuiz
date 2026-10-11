/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Android client talks to this API directly; no rewrites needed.
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,OPTIONS' },
          {
            key: 'Access-Control-Allow-Headers',
            value:
              'Content-Type, Authorization, hash, X-Signature, X-Timestamp, X-Nonce, X-Firebase-AppCheck, X-App-Version-Code, X-Username',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
