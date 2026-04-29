# Tasks — état actuel

_Fichier vivant. Claude y écrit les plans en cours et coche les étapes au fur et à mesure._

## En cours

(aucune tâche active)

## Backlog — Conversion WebM → MP4 client-side (PR #105 reverted 2026-04-29)

PR #105 a tenté de remplacer la conversion serveur Vercel par un transcode
FFmpeg WASM côté navigateur dans `composeAndUpload`. Résultat : export bloqué
à 75% sans erreur explicite + publication IG cassée. Reverted dans la PR
suivante.

À investiguer **AVANT** toute nouvelle tentative :
- Pourquoi le transcode bloquait à 75% sans erreur explicite :
  - CDN jsdelivr/unpkg inaccessible (CSP, ad blocker, slow network) ?
  - Tab arrière-plan throttle le worker WASM ?
  - Memory limit du browser hit sur les vidéos > 15 MB ?
  - Progress callback de FFmpeg WASM pas wired correctement → barre figée ?
- Tester FFmpeg WASM en isolation : WebM 5 / 10 / 20 / 30 MB → trouver la
  limite pratique avant timeout/crash.
- Ajouter timeout client-side (90s max) avec fallback automatique upload WebM
  si dépassé. Sans ce filet, l'utilisateur reste bloqué indéfiniment.
- Logger chaque étape : load WASM, write input, exec, read output, upload.
  Sans ces logs, impossible de diagnostiquer le freeze.
- Vérifier que COOP/COEP `credentialless` ne casse pas d'autres ressources
  cross-origin sur les pages où ils sont activés.

Quand reprendre : seulement quand les 4 investigations ci-dessus sont faites
+ harness de test reproductible pour les 4 tailles. Pas de merge sur main
sans timeout client-side ni fallback automatique.

## Dernières tâches terminées

- 2026-04-15 — Commit B1 : icône optionnelle + génération IA + 15 nouveaux thèmes (refonte /creer)
- 2026-04-13 — Creator page : fix text size + gradient + white title on export (commit `6ab8e8f`)
- 2026-04-13 — Studio Son : forward tous les design fields au composer (`9dc884e`)
- 2026-04-13 — Composer v19 : emoji cartes à taille fixe (pas scalé par textScale)
- 2026-04-13 — Calendar : miniature se met à jour quand on change de date (`ee3328b`)
- 2026-04-13 — Batch x10 : 9 angles différents pour générer du contenu unique (`60346d6`)
