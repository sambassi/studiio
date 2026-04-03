/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActionsBodySizeLimit: '50mb',
    // Include ffmpeg-static binary in the cron/publish serverless function bundle
    outputFileTracingIncludes: {
      '/api/cron/publish': ['./node_modules/ffmpeg-static/**/*'],
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
