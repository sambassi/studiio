import path from 'path';

/**
 * Réglage webpack du bundler Remotion — la SEULE définition.
 *
 * ⚠️ REMOTION A SON PROPRE WEBPACK : il ne lit ni les `paths` de `tsconfig`,
 * ni la configuration de Next. Sans cet alias, tout composant partagé entre
 * l'aperçu et une composition échoue au bundling dès qu'il importe en `@/` —
 * et c'est précisément ce que font `SequenceCards`, `SequenceTitle`,
 * `SequenceCta` et `FreeElementsLayer`, les pièces qui garantissent la parité.
 *
 * ⚠️ ET IL FAUT LE PASSER DEUX FOIS, PARCE QU'IL Y A DEUX CHEMINS.
 *
 * `remotion.config.ts` n'est lu que par le **CLI** (`@remotion/cli`, voir son
 * `load-config.js`) — jamais par `@remotion/bundler`. Un rendu déclenché par
 * `npx remotion render` prend donc l'alias, alors qu'un rendu SERVEUR, qui
 * passe par `bundle()` en API Node, ne le prend pas. Le premier marche, le
 * second échoue sur `Can't resolve '@/components/ui/CardIcon'` — et l'écart
 * ne se voit jamais en développement, où l'on teste au CLI.
 *
 * D'où ce module : `remotion.config.ts` et `src/lib/render/worker.ts` en
 * dépendent tous les deux. Ajouter un réglage ici le donne aux deux chemins.
 */
export const remotionWebpackOverride = (config: Record<string, any>): Record<string, any> => ({
  ...config,
  resolve: {
    ...config.resolve,
    alias: {
      ...(config.resolve?.alias ?? {}),
      // `process.cwd()` : la racine du projet en développement, `/app` dans
      // l'image Docker — le même repère que le point d'entrée
      // (`path.resolve(process.cwd(), 'remotion/index.tsx')`).
      '@': path.resolve(process.cwd(), 'src'),
    },
  },
});
