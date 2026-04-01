/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  // COOP/COEP for FFmpeg.wasm SharedArrayBuffer
  // credentialless is less restrictive than require-corp — doesn't block external resources
  async headers() {
    return [
      {
        source: '/dashboard/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
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
  webpack: (config, { isServer }) => {
    // Externalize Remotion packages that are incompatible with webpack
    // They will be loaded at runtime only when the render API is called
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        '@remotion/bundler': 'commonjs @remotion/bundler',
        '@remotion/renderer': 'commonjs @remotion/renderer',
        '@remotion/cli': 'commonjs @remotion/cli',
        'esbuild': 'commonjs esbuild',
      });
    }
    return config;
  },
};

module.exports = nextConfig;
