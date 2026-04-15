# Lessons — leçons tirées des corrections

_Format : `[date] | ce qui a mal tourné | règle pour l'éviter`_

_Fichier à relire à chaque démarrage de session. Appliquer toutes les leçons avant de toucher au code._

---

## 2026-04-13

- **2026-04-13** | `fontPx` appliquait `textScale` aux emojis de cartes, alors que l'éditeur utilise des tailles Tailwind fixes (`text-sm`/`text-lg`). Résultat : emojis 2.2× trop gros, cartes 2× trop hautes, débordements visuels. | **Règle** : avant de faire passer une valeur CSS par `textScale`, vérifier dans l'éditeur si la classe CSS source (Tailwind) est scale-aware. Les tailles Tailwind (`text-xs/sm/base/lg/xl`) sont FIXES. Seules les valeurs `style={{ fontSize: N * textScale }}` sont scale-aware.

- **2026-04-13** | Studio Son re-exportait en oubliant `watermarkPosition`, `seqGradients`, `titleSize`, `ctaTypography`, etc. → composer tombait sur ses defaults → mise en page différente du préview éditeur. | **Règle** : quand un callsite de `composeAndUpload` existe en plusieurs endroits (éditeur, Studio Son, Creator, Régénérer calendrier), tous doivent transmettre **exactement les mêmes champs design**. Ne jamais passer un sous-ensemble en pensant « les defaults du composer sont bons » — les defaults ne reflètent pas le choix de l'utilisateur.

- **2026-04-13** | `paintSeqGradient` avait une branche « noColor → paint dark » qui se déclenchait même après qu'un poster soit peint → le poster était effacé. | **Règle** : séparer les responsabilités : `paintSeqBackdrop` gère le choix « fond sombre vs couleur » UNE FOIS, `paintSeqGradient` ajoute l'overlay PAR-DESSUS. Ne jamais mélanger les deux dans un seul helper qui « peut ou non dessiner ».

- **2026-04-13** | `noColorBg: true` dans l'éditeur est une PORTE (gate), pas un « applique partout ». Le vrai prédicat éditeur est `noColorBg === true && noColorSequences.includes(seq)`. | **Règle** : avant de répliquer une règle CSS de l'éditeur en Canvas, lire le code JSX exact (infographie/page.tsx:2928-2946 style). Ne jamais inférer la sémantique d'un flag à partir de son nom.

- **2026-04-13** | Le padding/gap des cartes utilisait le ratio `/320` (viewport 9:16) pour tous les formats → en 16:9 (viewport 512), les ratios étaient 60 % trop grands ; label/value/desc utilisaient `fontPx(N * textScale)` correct mais `cssPx(N)` ne respectait pas le viewport. | **Règle** : introduire des helpers `fontPx(cssPx)` (scale-aware) et `cssPx(pxAt320)` (padding/gap) qui divisent par `editorViewportPx = isReel ? 320 : 512`. Ne jamais hardcoder `/320`.

- **2026-04-13** | L'utilisateur rapportait « rien a changé » alors que le composer était à jour. Cause : le post stocké en DB avait été rendu par v_N-1 et nécessitait un click Régénérer pour picker le nouveau code. | **Règle** : bumper `COMPOSER_VERSION` à chaque fix visuel du composer + afficher le bouton Régénérer dans le calendrier quand `meta.composerVersion !== CURRENT_COMPOSER_VERSION`. Les vidéos en DB ne se mettent pas à jour toutes seules.

- **2026-04-13** | Le clic Play dans Studio Son déclenchait `play() → pause()` immédiatement. Cause : un useEffect hérité pausait la vidéo quand la séquence active ≠ 'video' (conçu pour l'ancien mode HTML). | **Règle** : quand on change un flux (HTML rebuild → vidéo full montage), auditer tous les `useEffect` qui pausent/jouent `videoRef` et les garder spécifiques au mode où ils sont pertinents. Ne jamais supposer qu'un effet inactif n'aura pas d'effet secondaire.

- **2026-04-13** | Le batch x10 génèrait 10 posts avec les mêmes cartes parce qu'on envoyait le même topic à Claude chaque fois (convergence vers la réponse canonique). | **Règle** : pour forcer de la variation LLM, ajouter un « angle » différent + un nonce aléatoire au prompt par itération. Le nonce aléatoire évite aussi les réponses mises en cache.

- **2026-04-13** | `Math.round(w * (X / 320) * textScale)` inline était dispersé dans 20+ endroits de `video-composer.ts`. Impossible de changer le viewport ou le scale sans réécrire partout. | **Règle** : introduire des helpers (`fontPx`, `cssPx`, `fixedFontPx`, `paintSeqBackdrop`, `paintSeqGradient`) dès qu'on répète un pattern 3+ fois. Les helpers auto-centralisent les bugs.
