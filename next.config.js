/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActionsBodySizeLimit: '50mb',
    // Include ffmpeg-static binary in the cron/publish serverless function bundle
    outputFileTracingIncludes: {
      '/api/cron/publish': ['./node_modules/ffmpeg-static/**/*'],
      '/api/convert/to-mp4': ['./node_modules/ffmpeg-static/**/*'],
    },
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
    // COOP/COEP enable SharedArrayBuffer, required by FFmpeg WASM in
    // composeAndUpload's client-side MP4 transcode. Apply to every page
    // that imports composeAndUpload (creer + calendar + infographic) so
    // the WASM transcode runs in multi-threaded mode instead of falling
    // back to single-threaded or failing entirely on cross-origin assets.
    const coopHeaders = [
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
    ];
    return [
      { source: '/dashboard/creer', headers: coopHeaders },
      { source: '/dashboard/calendar', headers: coopHeaders },
      { source: '/dashboard/infographic', headers: coopHeaders },
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
