/** @type {import('next').NextConfig} */
const nextConfig = {
  // standalone : nécessaire pour Docker (Coolify) — produit un build minimal
  // dans .next/standalone qui contient tout ce qu'il faut pour `node server.js`.
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    serverActionsBodySizeLimit: '50mb',
    // Include ffmpeg-static binary in the cron/publish serverless function bundle
    outputFileTracingIncludes: {
      '/api/cron/publish': ['./node_modules/ffmpeg-static/**/*'],
      '/api/convert/to-mp4': ['./node_modules/ffmpeg-static/**/*'],
    },
    // minio SDK utilise des imports `node:fs`, `node:stream` etc. que
    // webpack ne sait pas bundler. On le marque comme external pour qu'il
    // soit require() au runtime depuis node_modules.
    serverComponentsExternalPackages: ['minio'],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/dashboard/creer',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
      {
        source: '/ffmpeg/:path*',
        headers: [
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
  webpack: (config, { isServer }) => {
    // Externalize Remotion packages that are incompatible with webpack
    // They will be loaded at runtime only when the render API is called
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        '@remotion/bundler': 'commonjs @remotion/bundler',
        '@remotion/renderer': 'commonjs @remotion/renderer',
        '@remotion/cli': 'commonjs @remotion/cli',
        '@remotion/transitions': 'commonjs @remotion/transitions',
        '@sparticuz/chromium': 'commonjs @sparticuz/chromium',
        'esbuild': 'commonjs esbuild',
      });
    }
    return config;
  },
};

module.exports = nextConfig;
