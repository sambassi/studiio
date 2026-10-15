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
    //
    // msedge-tts (TTS Edge) : même traitement, pour une autre raison. Il
    // embarque `ws` ; bundlé par webpack, `ws` perd son masquage de trames
    // (`TypeError: t.mask is not a function`, levée hors promesse) : aucune
    // trame ne part, Microsoft ne répond rien, la route attend son délai et
    // rend 504. Chargé depuis node_modules, il fonctionne.
    serverComponentsExternalPackages: ['minio', 'msedge-tts'],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    // OPTIMISEUR COUPÉ (`/_next/image` → 404). Aucun composant n'utilise
    // `next/image`, et l'optimiseur servait SANS SESSION toute image locale
    // demandée par `?url=/storage/v1/object/public/<bucket>/<clé>` — y
    // compris sous un autre hôte que celui de l'application. Une URL de média
    // `https://<app>/_next/image?url=…` n'était pas reconnue comme objet de
    // stockage : le serveur publiait alors l'image d'un autre compte sans
    // aucun contrôle de propriété.
    unoptimized: true,
    // Plus de `*.supabase.co` : aucun composant n'utilise `next/image`, et le
    // stockage est MinIO, servi par l'application elle-meme. Ce joker ouvrait
    // l'optimiseur d'images (`/_next/image`) a N'IMPORTE QUEL projet Supabase
    // — pas seulement le notre — sans aucun usage en contrepartie.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
      },
    ],
  },
  async redirects() {
    return [
      {
        // L'ancien editeur avance a ete retire : son URL redirige en HTTP 308,
        // avec les memes regles que `lib/routing/legacy-redirect` (que sa page,
        // conservee en filet, applique aussi) :
        // - `?id=` (un `videos.id`) sans `postId` → la Bibliotheque ;
        // - tout le reste (`?postId=`, `?tab=`…) → Creer, query transportee
        //   (Next la recopie d'office sur la destination).
        source: '/dashboard/creer-avance',
        has: [{ type: 'query', key: 'id' }],
        missing: [{ type: 'query', key: 'postId' }],
        destination: '/dashboard/library',
        permanent: true,
      },
      {
        source: '/dashboard/creer-avance',
        destination: '/dashboard/creer',
        permanent: true,
      },
      {
        // Ses eventuels SOUS-CHEMINS n'ont jamais eu de contenu propre.
        source: '/dashboard/creer-avance/:path+',
        destination: '/dashboard/creer',
        permanent: true,
      },
    ];
  },
  async headers() {
    // Les en-tetes COOP/COEP de `/dashboard/creer-avance` (FFmpeg WASM de
    // l'ancien editeur) ont ete retires avec lui : la route ne fait plus que
    // rediriger. Le parcours guide `/dashboard/creer` n'en a jamais eu.
    return [
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
        // minio utilise des imports node:* non bundlables
        'minio': 'commonjs minio',
        // ws embarqué par webpack casse le masquage des trames (voir plus haut)
        'msedge-tts': 'commonjs msedge-tts',
      });
    }
    return config;
  },
};

module.exports = nextConfig;
