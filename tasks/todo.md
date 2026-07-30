# Tasks — état actuel

_Fichier vivant. Claude y écrit les plans en cours et coche les étapes au fur et à mesure._

## En cours — Génération en batch, éditeur avancé `/dashboard/creer` — 2026-07-30

### 1. Exploration : la fonctionnalité existe déjà à ~90 %

Grep + lecture de `src/app/dashboard/creer/page.tsx` (12 400 lignes) :

| Besoin exprimé | État réel |
|---|---|
| Thème libre (mot-clé quelconque) | **existe** — thème `personnalise` + `customTopic`, avec validation (`:3237`, `:3391`) |
| Recherche Pexels | **existe** — `fetchPexelsPhotos` (`:3180`) |
| Recherche Unsplash | **existe** — bascule `imageSource`, persistée (`:1650-1658`) |
| Upload d'affiche depuis le bureau | **existe** — bouton « Ma photo » (`:6826`), **mais en data URL** → écart B |
| Pool multi-sélection | **existe** — `batchPhotoIndices`, UI « Sélectionnées : X / N » (`:6775-6821`) |
| Affiche différente par vidéo | **existe** — index explicite, sinon cycle `b % pexelsPhotos.length` (`:4659-4672`) |
| Texte + sous-sujet différents | **existe** — `generateBatchVariation(b)` (`:4456`) : un **angle** par index (`ANGLES`), `variationNonce`, titres déjà produits envoyés au modèle |
| Moteur réutilisé | **existe** — `/api/content/ai-generate` + repli local `smart-content` |
| 1 post par vidéo | **existe** — la boucle d'export crée un post par itération |
| Progression X/N | **existe** — `setExportProgress` + `[Batch b/total]` |
| Sélecteur 10 / 20 / 30 | **partiel** — préréglages `[1, 3, 5, 10, 20]`, **plafond 20** |

Écrire un second moteur de batch serait de la duplication. Restent deux écarts.

### 2. Les deux écarts réels

**A. Plafond 20 au lieu de 30** — `:7321` `Math.min(20, …)`, `:7322` `disabled >= 20`,
libellé « 1 à 20 », préréglages sans 30.

**B. L'upload d'affiche passe par une data URL** (`:6829-6838`, `FileReader.readAsDataURL`)
au lieu du stockage. Deux conséquences mesurables :
1. `pexelsPhotos` est dans le snapshot d'auto-sauvegarde (`:2874`) : une photo de 3 Mo
   devient ~4 Mo de base64 → `QuotaExceededError` attrapée en silence, **l'auto-sauvegarde
   du montage cesse de fonctionner** sans rien signaler ;
2. le data URL part dans `metadata.posterUrl` de **chaque** post du batch — 30 posts × 4 Mo.

### 3. Plan

- [ ] `src/lib/creer/posterUpload.ts` — `uploadPosterFile(file)` via `/api/upload/signed-url`
      puis `PUT`. Garde SSR, `try/catch`, repli documenté sur data URL si la signature
      échoue (ne pas régresser : aujourd'hui l'upload aboutit toujours).
- [ ] Bouton « Ma photo » → `uploadPosterFile`, état d'envoi, toast d'échec.
      **Grep-before-modify** : `setPexelsPhotos` × 8 (`:1994`, `:2284`, `:2685`, `:3195`,
      `:3206`, `:3210`, `:3383`, `:6836`) — seule `:6836` change ; les 7 autres alimentent
      le pool depuis les recherches ou la restauration.
- [ ] Plafond 20 → 30 + préréglage 30. **Grep** : `batchCount` × 18, seules les 4
      occurrences du sélecteur (`:7310-7330`) portent le plafond.
- [ ] Tests : upload → URL publique, échec de signature → repli, garde SSR, et le cycle
      d'affiches ne répète jamais deux fois la même image d'affilée quand le pool ≥ 2.

### 4. Écarté volontairement

Pas de second moteur de variation, pas de refonte du pool, pas de bascule vers
`/api/agent/generate` (l'éditeur utilise `/api/content/ai-generate`, plus riche ici :
nonce + titres déjà produits ; basculer serait une régression de qualité).

### 5. Vérification

`npm run build` complet, `tsc` à la baseline de `main` (84), `npm test`. Limite connue :
`/dashboard/creer` est derrière le middleware d'authentification, le cycle complet
n'est pas jouable en headless.

## Fait — F2 incrément 1 : page Média + « Temps forts » — 2026-07-29

Objectif : rendre la détection de temps forts d'un rush **découvrable**, en
couche **non destructive** (aucun fichier de `/dashboard/creer` ni de la
publication sociale touché).

- [x] Route `/dashboard/media` (`src/app/dashboard/media/page.tsx`) : grille des
      rushes via `GET /api/media/list?type=video`, upload multi-fichiers via le
      flux `signed-url` existant, suppression via `/api/media/delete`.
- [x] Entrée « Média » dans la Sidebar — **ajout pur**, aucune entrée retirée.
      Icône `Clapperboard` (et non `Film`, déjà surchargé — audit CLAUDE.md pt E).
      Clé i18n `sidebar.media` ajoutée dans fr / en / de.
- [x] `src/components/media/ClipDetectorModal.tsx` — composant **propre** à cette
      page (celui de `/creer` n'a été ni extrait ni partagé, pour qu'une
      évolution ici ne puisse pas régresser l'éditeur). Réutilise tel quel
      `detectClips` / `extractClip` de `src/lib/clip-detector.ts`, inchangé.
      Progression, vignette + score d'intensité + durée, sélection, aperçu,
      extraction → upload → retour dans la médiathèque.
- [x] Build vert, `npx tsc --noEmit` sans erreur sur les fichiers ajoutés.

Hors périmètre (incrément 2) : enchaînement « montage auto » des clips extraits.

## En cours — Rush "vidéo absente" (montage MinIO) — 2026-06-03

État du diagnostic (ordre des pistes éliminées) :
1. ✅ **Revert `4ff6401`** (son temps-réel qui régressait la vidéo) → main = `7a853f6`, état bon. **→ Redéployer Coolify.**
2. ❌ **cleanup-media** : fausse piste (aucune Scheduled Task Coolify, vercel crons n'atteignent pas MinIO). Confirmé par l'utilisateur.
3. ✅ **Cause racine = upload→serve** : en prod le PUT proxy renvoie 200 ("Upload OK") mais le GET 404 immédiat sur la même clé. Repro local (vrai MinIO, mêmes appels SDK) → le code persiste+sert correctement ⇒ **bug INFRA, pas code** : write non durable / instances MinIO PUT≠GET.
4. ✅ **Shipped** :
   - `#184` — `/api/storage/upload` vérifie l'objet (`statObject`) après `putObject` → 500 explicite au lieu d'un faux "OK" + logs ; `/api/proxy-media` autorise notre propre `/storage` (fix 403).
   - `#185` — durcissement SSRF de `/api/proxy-media` (allowlist de `hostname` exacts, suite revue sécu).

⏳ **Bloqué sur retour utilisateur** : après redeploy Coolify, faire 1 upload rush et reporter :
   - **500 "Write not durable"** → MinIO n'écrit pas durablement (volume non monté / bucket non servi) — fix infra MinIO.
   - **toujours "OK" + URL 404** → PUT proxy et GET proxy tapent des endpoints MinIO différents (env/instance) — fix env Coolify.

## Archivé

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
