import { Config } from '@remotion/cli/config';
import { remotionWebpackOverride } from './src/lib/render/webpackOverride';

/**
 * Configuration du bundler Remotion — chemin CLI uniquement.
 *
 * ⚠️ CE FICHIER N'EST LU QUE PAR LE CLI. `@remotion/cli` le charge
 * (`load-config.js`) ; `@remotion/bundler` ne le regarde jamais. Le rendu
 * SERVEUR passe par `bundle()` en API Node et doit donc recevoir le même
 * réglage explicitement — c'est ce que fait `src/lib/render/worker.ts`.
 *
 * Le réglage lui-même vit dans `webpackOverride`, partagé par les deux :
 * l'écrire ici seulement le réservait au CLI, et faisait échouer tout rendu
 * serveur sur `Can't resolve '@/…'`.
 */
Config.overrideWebpackConfig(remotionWebpackOverride);
