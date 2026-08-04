import { Config } from '@remotion/cli/config';
import path from 'path';

/**
 * Configuration du bundler Remotion.
 *
 * ⚠️ Remotion a SON PROPRE webpack : il ne lit ni `tsconfig.paths` ni la
 * configuration de Next. Sans cet alias, tout composant partage entre
 * l'apercu et une composition echoue au bundling des qu'il importe en `@/` —
 * et c'est precisement ce que fait `SequenceCards`, la piece qui garantit la
 * parite des cartes.
 *
 * L'alias est donc la condition pour qu'un composant puisse etre PARTAGE.
 */
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...(config.resolve?.alias ?? {}),
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
}));
