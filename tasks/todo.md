# Tasks — état actuel

_Fichier vivant. Claude y écrit les plans en cours et coche les étapes au fur et à mesure._

## En cours — Import et application de LUTs, Mode simple `/dashboard/creer-simple` — 2026-07-30

> **Arbitrages validés par l'utilisateur le 2026-07-30 :**
> - D1 = **le rush et lui seul**. Jamais les textes, le dégradé, l'habillage.
> - La LUT va dans **`design`** (persisté + régénéré par le Calendrier), jamais
>   dans `sequenceBackgrounds` (qui ne fait pas l'aller-retour).
> - Preuve exigée avant tout « fait » : un export **avec** LUT ouvert et comparé
>   à un export **sans**, avec vérification de zéro frame perdue et de la
>   synchronisation audio.
> - Une PR par phase, **diff montré avant chaque merge**.

### 1. Ce qui existe aujourd'hui (exploration, pas hypothèse)

**Aucune trace de LUT dans le dépôt** : `grep -in "lut\|\.cube"` sur `src/`
ne renvoie que des faux positifs (`plutôt`, `inclut`, `absolu`). Tout est à écrire.

**Le seul étalonnage existant** est le jeu de filtres de `ImageEditorPanel.tsx`,
et il est réservé à l'éditeur **avancé** (`/dashboard/creer`) :

| Élément | Emplacement |
|---|---|
| Type `ImageFilters` (brightness, contrast, saturation, temperature, blur, vignette) | `src/components/creer/ImageEditorPanel.tsx:13-29` — **dupliqué** en `video-composer.ts:334` et re-déclaré en `creer/page.tsx:2799` |
| Curseurs UI | `ImageEditorPanel.tsx:64-125` |
| Aperçu → chaîne CSS `filter` | `buildCssFilter` `:174`, consommé par `creer/page.tsx:8901` |
| Export → chaîne `ctx.filter` | `buildCanvasFilter` `:189`, redéclaré à l'identique dans le compositeur (`video-composer.ts:3156`) |
| Vignette | pas un filtre : calque radial peint par frame (`video-composer.ts:3523`) |

**Portée réelle de ces filtres : l'IMAGE DE FOND d'une séquence, et rien d'autre.**
`pickSeqBg` (`video-composer.ts:3166`) ne les lit que depuis
`sequenceBackgrounds[seq]`, et `getFilteredBg` (`:3435`) pré-dessine l'image
filtrée **une seule fois** dans un canvas hors-écran mis en cache — coût par
frame nul. Ni le rush vidéo, ni les textes, ni le dégradé ne sont étalonnés.

**Le Mode simple n'a pas d'image de fond du tout.** `AssistantWizard.tsx` :
fond = dégradé CSS (`backdropCSS:381`), et la seule vraie image du montage est
**le rush** (`rushUrl:1377`, importé via `MediaLibrary:3135`). Les cartes sont
photographiées en HTML (`modern-screenshot`, `:1944-2020`) puis blittées par le
compositeur (`design.cardsSnapshot`). L'aperçu (`Preview:683`) est du **HTML/CSS**,
pas un canvas.

**Deux points de sortie à alimenter, pas un :**
- `composeAndUpload({ … design })` — `AssistantWizard.tsx:2037`, bloc `design:2086`
- `metadata.design` du post — `:2209`, **relu par le Calendrier** pour l'aperçu
  HTML et pour toute régénération (`calendar/page.tsx:693`, `:1118`, `:2279`).

⚠️ **`sequenceBackgrounds` n'est écrit dans AUCUN `metadata`** (grep : la clé
n'apparaît jamais dans `calendar/page.tsx`). Les filtres de fond de l'éditeur
avancé **disparaissent déjà** à la régénération depuis le Calendrier. Une LUT
rangée au même endroit hériterait du même bug. → **la LUT va dans `design`.**

**Le Mode simple rend en TEMPS RÉEL dès qu'un rush est présent** :
`hasRushAudio = !!videoEl` (`video-composer.ts:3241`) → `useFastMode = !hasAudio`
(`:3798`). Autrement dit, le cas où la LUT sert le plus est **exactement** celui
où il ne reste que ~33 ms de budget par frame. Ce n'est pas un risque théorique,
c'est le cas nominal.

### 2. Où appliquer la LUT — une seule couture

Recommandation : **la LUT étalonne l'IMAGERIE, pas l'habillage.** Elle grade le
rush (et les images de fond quand il y en aura), jamais les textes, le dégradé,
la barre de progression ni le filigrane — étalonner l'UI est un bug, pas un look.

Cela donne **deux points d'injection, et deux seulement** :

1. `getFilteredBg` (`video-composer.ts:3435`) → passe LUT sur le canvas
   hors-écran déjà mis en cache. **Coût par frame : zéro.** Images fixes.
2. `drawVideoSeq` (`video-composer.ts:2294`, `drawImage` du rush `:2322`) →
   passe LUT par frame, **uniquement pendant la séquence Vidéo**, uniquement
   si une LUT est définie. C'est le seul coût réel.

Ce découpage a une conséquence heureuse : l'aperçu HTML devient **exactement
implémentable** (voir §5, phase 2) — il n'y a que le rush à grader, sur un
canvas de la taille de l'aperçu (~272 px de large), coût négligeable.

### 3. Formats à supporter

| Format | Décision | Détail |
|---|---|---|
| `.cube` (Adobe/IRIDAS) | **oui, v1** | texte : `TITLE`, `LUT_3D_SIZE n`, `DOMAIN_MIN/MAX`, commentaires `#`, puis n³ triplets flottants. Tailles courantes 17/25/32/33/64. Plafonner `n ≤ 64` et le fichier à 8 Mo (un 64³ pèse ~6 Mo en texte). |
| `.cube` 1D (`LUT_1D_SIZE`) | **oui, v1** | trivial une fois le parseur 3D écrit, et fréquent dans les packs gratuits. |
| PNG **HALD CLUT** | **oui, v1, avec détection stricte** | carré, côté = `n²` pour un niveau n (512×512 = niveau 8 = 64³). |
| PNG **grille de tuiles** (« square LUT » GPUImage : 512×512 = 8×8 tuiles de 64×64) | **oui, v1** | même dimension que le HALD 512×512 → **indissociables par la taille seule**. Voir risque R2. |
| PNG **bande** 1024×32, 256×16 | v2 | |
| `.3dl`, `.look`, `.icc`, `.xmp` | **non** — refus explicite avec message nommant les formats acceptés. Jamais de dégradé silencieux. |

### 4. Décisions à trancher AVANT d'écrire

**D1 — portée de l'étalonnage.** Recommandation : **imagerie seule** (§2).
L'alternative « toute la frame sauf l'habillage » donne un rendu plus
cinématographique sur les séquences Titre/CTA (qui ne sont que dégradé + texte),
mais : (a) elle rend l'aperçu HTML **impossible** à tenir fidèle (CSS ne sait pas
faire de LUT), (b) elle fait payer le coût par frame sur **tout** le montage et
non sur les ≤10 s de rush, (c) elle risque la **double application** sur la photo
des cartes (§6, R5). → je recommande l'imagerie seule. **C'est la question à
valider.**

**D2 — LUTs fournies d'origine.** Écarté en v1 : la demande est *l'import*.
Zéro preset embarqué, zéro Mo de PNG dans `public/`.

**D3 — coût en crédits.** Aucun. L'étalonnage est 100 % client, il ne consomme
ni rendu serveur ni API. `COST` (`AssistantWizard.tsx:555`) reste inchangé.

### 5. Plan par étapes — une PR par phase

**Phase 0 — socle pur, zéro UI** (`src/lib/luts/`) — **FAIT, en attente de revue**
- [x] `types.ts` : `Lut` et `LutRef` définis **une seule fois** (R6), plafonds
      `MAX_LUT_SIZE = 64` et `MAX_LUT_BYTES = 8 Mo`.
- [x] `parse.ts` : `parseCube(text)` (3D **et** 1D, `TITLE`, `DOMAIN_MIN/MAX`,
      commentaires) et `parseLutPng(data, w, h)`.
- [x] `apply.ts` : `applyLutToPixels(pixels, lut, intensity)` — interpolation
      **trilinéaire**, tables d'axe pré-calculées sur 256 entrées (trois
      divisions et trois `Math.floor` retirés de la boucle par pixel).
- [x] **R2 tranché sans deviner** : HALD et grille de tuiles ayant exactement
      la même taille, `parseLutPng` lit l'image **dans les deux sens** et
      compare la rugosité des deux cubes (somme des écarts au carré entre
      nœuds voisins). Une vraie LUT est lisse, la mauvaise lecture mélange les
      axes. Aucune ne se détache d'un facteur 2 → **on lève**.
- [x] 28 tests de **comportement** : identité = no-op strict au pixel (tailles
      2 et 33), 128 reste 128 sur un cube de 2 (ce test seul distingue la
      trilinéaire du plus-proche-voisin), alpha préservé, intensité 0 / 0,5 / 1,
      et huit refus (`.cube` tronqué, taille absurde, > 64, ligne non numérique,
      fichier vide, image non carrée, côté invalide, bruit indécidable).
- [x] `npx vitest run` : 426/426. `npx tsc --noEmit` : 86 erreurs, **exactement
      la baseline de `main`** (vérifiée par `git stash`), zéro dans `src/lib/luts/`.

**Phase 1 — import dans le Mode simple**
- [ ] Nouvelle section `StyleSection id="ambiance"` dans l'étape Style
      (`AssistantWizard.tsx:2500`, à la suite de `couleurs`) : bouton d'import,
      nom du fichier, curseur d'intensité (0-100 %, défaut 100), bouton retirer.
      `SectionId` (`:1186`) à étendre.
- [ ] **Upload obligatoire via `/api/upload/signed-url`** — jamais de data URL.
      Un `.cube` de 6 Mo en base64 dans le brouillon ferait exploser le
      `localStorage` (`QuotaExceededError` avalée en silence → l'auto-sauvegarde
      cesse) et partirait dans le `metadata` de chaque post. C'est l'écart B déjà
      documenté plus bas dans ce fichier ; ne pas le refaire.
- [ ] Brouillon (`src/lib/creer/draft.ts`) : persister **la référence seule**
      (`{ url, name, format, size, intensity }`), jamais la table parsée.
- [ ] Erreurs nommées : format refusé, fichier trop gros, PNG de dimension
      inconnue → toast explicite, état inchangé.

**Phase 2 — aperçu**
- [ ] `Preview` (`:683`) : quand une LUT est active **et** que le rush est
      visible (`showRush`), superposer un `<canvas>` à la taille de l'aperçu qui
      rejoue les frames du `<video>` graduées (rAF, ~15 fps suffisent). Le
      `<video>` reste la source, il passe en `opacity: 0` — **pas** de retrait du
      DOM : c'est lui qui porte la lecture et la synchro.
- [ ] Sans rush : pas d'aperçu graduable → vignette « avant / après » sur la
      carte d'import (une image de référence embarquée, quelques Ko), et libellé
      qui dit explicitement que le filtre s'applique au rush.
- [ ] `try/finally` sur la boucle rAF (règle 6 de la checklist pré-merge).

**Phase 3 — export**
- [ ] `video-composer.ts` : `DesignOptions.lut?: { url, intensity }`. **Défaut
      absent = comportement strictement identique à aujourd'hui** (règle 5).
- [ ] Chargement + parsing **une fois** avant la boucle de rendu, à côté du
      chargement des images de fond (`:3134`). Passer par `/api/proxy-media`
      comme les autres médias : un `fetch` direct sur MinIO se prendra le CORS.
      Échec de chargement → `console.warn` + rendu **sans** LUT, jamais d'échec
      de montage (même politique que `seq bg load failed:3140`).
- [ ] Injection en 2 points seulement (§2). Sur le rush : grader **la région
      dessinée**, après `drawImage` du rush et **avant** tout texte.
- [ ] **Garde de performance** (le point dur) : mesurer le temps du passage LUT
      sur la première frame ; au-delà d'un seuil, grader à **demi-résolution**
      puis ré-échantillonner — invisible sur un étalonnage couleur, 4× moins
      cher. Consigner le mode retenu dans la console comme le fait déjà
      `[Composer] Mode:` (`:3830`). Si même la demi-résolution ne tient pas le
      temps réel → passe WebGL (shader d'échantillonnage de LUT), à isoler
      derrière la **même** fonction `applyLut` pour ne pas re-toucher au
      compositeur.

**Phase 4 — aller-retour Calendrier**
- [ ] Écrire `design.lut` dans **les deux** sorties (`:2086` compositeur et
      `:2209` metadata) — une seule des deux = grade perdu à la régénération.
- [ ] Vérifier une régénération depuis le Calendrier (`calendar/page.tsx:693`) :
      même rendu qu'à l'export d'origine.
- [ ] **Limite assumée à documenter** : l'aperçu HTML du Calendrier ne peut pas
      appliquer la LUT (CSS ne sait pas le faire). La vidéo, elle, est correcte.

### 6. Risques

| # | Risque | Gravité | Parade |
|---|---|---|---|
| R1 | **Temps réel.** Un rush force `useFastMode = false` (`:3798`) : la LUT s'ajoute à un budget de 33 ms/frame déjà tenu. Trop lent = frames perdues et **désynchro audio**, pas juste « c'est long ». | **haute** | demi-résolution puis WebGL (phase 3) ; mesurer avant de merger, sur un rush réel de 10 s |
| R2 | **PNG 512×512 ambigu** : HALD niveau 8 et grille 8×8 de tuiles 64×64 ont la MÊME taille et un ordre de pixels différent. Se tromper produit une image aux couleurs plausibles mais fausses — donc invisible en revue. | **haute** | ne pas deviner : détecter par sonde (une LUT identité a une signature reconnaissable), sinon **demander** à l'utilisateur laquelle des deux, ou refuser |
| R3 | **Data URL** pour la LUT → auto-sauvegarde du brouillon cassée en silence + `metadata` obèse sur chaque post | haute | upload obligatoire (phase 1), déjà la leçon de l'écart B |
| R4 | **Écrire la LUT dans `sequenceBackgrounds`** au lieu de `design` → disparaît à la régénération, comme les filtres de fond aujourd'hui | moyenne | `design.lut`, vérifié en phase 4 |
| R5 | **Double application sur les cartes** : la photo `cardsSnapshot` est du HTML déjà composité. Si l'aperçu la gradue en CSS *et* que le compositeur la gradue à nouveau, le rendu est deux fois plus contrasté que l'écran. | moyenne | conséquence directe de D1 : l'imagerie seule ne touche jamais la photo des cartes. Si D1 bascule sur « toute la frame », ce point devient bloquant. |
| R6 | `ImageFilters` est **déjà dupliqué en 3 endroits** (`ImageEditorPanel:13`, `video-composer:334`, `creer/page:2799`). Ajouter le type LUT au même endroit = 3 copies de plus. | moyenne | type LUT défini **une fois** dans `src/lib/luts/types.ts`, importé partout |
| R7 | Fichier `.cube` hostile (10⁶ lignes, `LUT_3D_SIZE 512`) → onglet figé | moyenne | plafonds durs `n ≤ 64` et 8 Mo, contrôlés **avant** l'upload |
| R8 | `next.config.js` a `ignoreBuildErrors: true` : une erreur TS ne casse pas le build | faible | `npx tsc --noEmit` explicite, comparé à la baseline de `main` (84) |
| R9 | Classes Tailwind arbitraires purgées en prod (piège n°4 du CLAUDE.md) pour le canvas d'aperçu | faible | styles inline pour toute dimension calculée |

### 7. Écarté volontairement

Pas de LUT sur l'éditeur **avancé** (`/dashboard/creer`) en v1 — la demande porte
sur le Mode simple, et l'avancé a déjà six curseurs de filtre. Pas de presets
embarqués (D2). Pas de `.3dl` / `.icc`. Pas de LUT par séquence : une LUT est un
*look*, elle vaut pour le montage entier.

### 8. Vérification

`npm test` (dont les tests de parseur de la phase 0), `npx tsc --noEmit` à la
baseline, `npm run build`, puis les 7 flux de `tasks/pre-pr-checklist.md` sur la
preview. Preuve attendue avant de dire « fait » : **une vidéo exportée avec une
LUT, ouverte, comparée côte à côte avec la même sans LUT** — et le temps de rendu
des deux.

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

## Plan — porter déplacer / dupliquer / regrouper vers le Mode simple — 2026-07-30

_Plan seulement, aucun code écrit. `/dashboard/creer` (avancé) sert de RÉFÉRENCE
et n'est pas modifié : d'autres sessions y travaillent._

### 1. Ce qui existe dans l'AVANCÉ (`src/app/dashboard/creer/page.tsx`, 12 530 lignes)

**Déplacer** — un seul état, un seul gestionnaire géant.

| Élément | Ligne |
|---|---|
| `const [dragging, setDragging] = useState<string \| null>(null)` | `:2465` |
| Positions par élément : `titlePos`, `cardsPos`, `watermarkPos`, `overlayPos`, `logoPositions`, `siteTextPositions` | `:2463-2464` et alentours |
| `onMouseMove` du plateau — pixels → %, bornage, aiguillage par `dragging` | `:8615-8733` |
| `onMouseUp` / `onMouseLeave` — remise à zéro de tous les états de glisse | `:8734-8775` |
| Déclencheurs `onMouseDown={() => setDragging("title")}` etc. | `:9103`, `:9217`, `:9255`, `:9319`, `:9830`, `:9957`, `:10069` |
| Aimantation + guides (`snapPosition`, `computeDistanceBadges`) | `:8668-8689` |
| Glisse tactile (`onTouchMove`) — **cartes uniquement** | `:8776+` |

Les cartes ont leur propre chemin : `dragCardIdx`, mode `cardPositionMode: 'grid' | 'free'`
(`:2358`), chaque carte portant `position?: {x, y}`. En mode libre, la glisse d'une
carte déplace aussi ses compagnons — membres de son groupe **et** sélection courante —
par application du delta (`:8576-8628`).

**Dupliquer** — deux fonctions, même idée : copier avec un décalage pour que la
copie soit visible.

- `duplicate(id)` `:749` — décalage +5 %, `id: card-${Date.now()}`
- `duplicateSelectedCards()` `:3597` — décalage +4 %, **laisse les copies
  sélectionnées** pour enchaîner déplacement ou regroupement

**Regrouper** — `cardGroups: CardGroup[]` (`:2377`), persisté dans les préférences
de design (`:2859`), restauré (`:2725`).

- `groupSelectedCards()` `:3573` — exige ≥ 2 cartes ; une carte n'appartient qu'à
  UN groupe (les appartenances antérieures sont retirées d'abord)
- `ungroupSelectedCards()` `:3588` — un groupe tombant sous 2 membres disparaît
- `getCardGroupFor(cardId)` `:3570` — lecture
- Sélection : `selectedCardIds: Set<string>` (`:2375`) + rectangle de sélection au
  glisser sur le fond (`:8507-8521`, finalisé `:8734-8760`)

### 2. Ce qu'est le SIMPLE aujourd'hui (`creer-simple/AssistantWizard.tsx`, 3 504 lignes)

**L'aperçu n'est PAS éditable.** C'est une preview en lecture seule :

- aucun `onMouseDown` / `onMouseMove` sur le plateau — le seul `draggable` du
  fichier (`:2993`) sert à réordonner les **séquences** dans l'étape Style ;
- les positions sont des **constantes de module figées** — `DESIGN.titlePos`
  `{x: 8, y: 8}` et `DESIGN.ctaPos` `{x: 50, y: 92}` (`:273-283`) — partagées
  telles quelles par l'aperçu et par la charge envoyée au compositeur ;
- `previewRef` (`:1429`) ne sert qu'à mesurer la géométrie pour la photo des
  cartes, pas à capter des événements ;
- les cartes viennent de `generated.cards` : **ni `id`, ni `position`**, rendues
  dans un conteneur `flex flex-col` aux bornes fixes `left 8% / right 8% /
  top 30% / bottom 22%` (`:975-980`), avec `key={i}`.

**Le fait le plus structurant : les cartes du simple sont PHOTOGRAPHIÉES.**
`cardsRef` + `domToCanvas` (`:1944-2010`) produisent une image que le compositeur
blitte telle quelle via `cardsSnapshotRect`. Conséquence dans les deux sens :

- *à notre avantage* — toute modification DOM **à l'intérieur** du conteneur
  (donc un positionnement libre des cartes) part dans l'export sans toucher au
  compositeur ;
- *le piège* — tout ce qui sort de la boîte de `cardsRef` est **rogné** de la
  photo. Une carte déplacée hors des bornes disparaît de la vidéo alors qu'elle
  reste visible à l'écran.

**Ce qui manque pour rendre les éléments manipulables :** une couche
d'interaction (capter, suivre, relâcher), des positions en **état** au lieu de
constantes, une **identité stable** par carte, et la propagation de ces positions
au compositeur **et** aux métadonnées.

### 3. Plan par étapes — une PR par étape, chacune default-safe

**Étape 0 — Identité des cartes (préalable, sans effet visible)**
Donner un `id` stable à chaque carte générée et le faire vivre jusqu'au brouillon.
Sans identité, ni dupliquer ni regrouper n'ont de sens : `key={i}` casse dès qu'on
insère. Étendre `sanitizeDraft` (`src/lib/creer/draft.ts`) pour valider et
regénérer les `id` manquants des brouillons existants. Aucun changement de rendu.

**Étape 1 — Déplacer le TITRE et le CTA** *(le plus petit incrément qui marche)*
`DESIGN.titlePos` / `DESIGN.ctaPos` deviennent des états initialisés à ces mêmes
constantes. Un petit hook `useDragOnCanvas(previewRef)` — extrait, pas copié du
géant `:8615` — traduit pointeur → %, borne, et rend `{dragging, onPointerDown}`.
Deux poignées : le bloc titre, le bloc CTA. Les positions partent déjà au
compositeur (`titlePosition`, `watermarkPosition`) et dans
`metadata.design.positions` : le câblage existe, seule la source change.
*Default-safe* : sans déplacement, les valeurs sont identiques aux constantes,
donc l'export est bit à bit celui d'avant. **Rien à changer dans le compositeur.**

**Étape 2 — Déplacer les CARTES**
Mode `libre` optionnel (défaut `grille` = rendu actuel). Chaque carte reçoit une
`position?: {x, y}` ; en mode libre elles passent en `position: absolute` **dans
le conteneur `cardsRef`**. Le bornage se fait aux bords du conteneur, pas du
plateau — c'est ce qui empêche le rognage à la photo. Vérification : exporter avec
une carte déplacée dans un coin et confirmer sa présence dans la vidéo.

**Étape 3 — Sélection**
`selectedCardIds: Set<string>`, clic pour sélectionner, `shift`/`cmd` pour
étendre. Le rectangle de sélection au glisser sur le fond attend l'étape 5 :
il est plaisant mais ce n'est pas lui qui débloque dupliquer et regrouper.

**Étape 4 — Dupliquer**
Reprendre `duplicateSelectedCards()` (+4 %, copies laissées sélectionnées). En
mode grille, la copie s'ajoute simplement à la suite.

**Étape 5 — Regrouper**
`cardGroups` + `groupSelectedCards` / `ungroupSelectedCards`, portés tels quels.
Le déplacement d'une carte groupée applique le delta à ses compagnons — c'est la
seule ligne à ajouter à l'étape 2. Persister dans le brouillon **et** dans
`metadata.design`. Rectangle de sélection au glisser en option ici.

### 4. Risques

1. **Le simple n'a aucun canvas éditable.** L'étape 1 n'est pas un portage de
   fonction, c'est l'introduction d'une couche d'interaction. C'est pour cela
   qu'elle se limite à deux éléments dont les positions partent déjà au
   compositeur.
2. **Le rognage à la photo** (§2). Le risque le plus spécifique au simple, et
   invisible à l'écran : ça se voit seulement dans la vidéo exportée.
3. **Les cartes n'ont pas d'identité** — d'où l'étape 0. Toucher au schéma du
   brouillon impose de valider les anciens brouillons.
4. **Parité aperçu ↔ export**, règle absolue du projet : toute position doit
   partir au compositeur ET dans `metadata.design.positions`, sans quoi le
   Calendrier régénère un montage différent.
5. **Ne pas recopier le gestionnaire de l'avancé.** 200 lignes au milieu d'un JSX
   de 12 500 : le copier importerait sa complexité (guides, redimensionnement,
   rectangle, logo par séquence). Extraire un hook minimal, ajouter au besoin.
6. **`creer/page.tsx` est édité en parallèle** — le plan ne le touche jamais.
7. **Tactile** : l'avancé ne gère le toucher que pour les cartes. Utiliser
   `onPointerDown/Move/Up` dans le simple couvre souris et tactile d'un coup.
8. **L'autosave doit suivre** chaque nouvel état, sous peine de perdre au
   rafraîchissement ce que l'utilisateur vient de placer.

## Dernières tâches terminées

- 2026-04-15 — Commit B1 : icône optionnelle + génération IA + 15 nouveaux thèmes (refonte /creer)
- 2026-04-13 — Creator page : fix text size + gradient + white title on export (commit `6ab8e8f`)
- 2026-04-13 — Studio Son : forward tous les design fields au composer (`9dc884e`)
- 2026-04-13 — Composer v19 : emoji cartes à taille fixe (pas scalé par textScale)
- 2026-04-13 — Calendar : miniature se met à jour quand on change de date (`ee3328b`)
- 2026-04-13 — Batch x10 : 9 angles différents pour générer du contenu unique (`60346d6`)

## 2026-08-07 — Autopilote : identité constante + notification rushes manquants

Branche `feat/autopilote-branding-constant`.

- [ ] A. Migration `2026-08-07-autopilot-branding.sql` + types/`sanitizeConfig` + route config
- [ ] B. Moteur : couleurs, fond des cartes, musique, voix clonée, son du rush + mixeur, rotation des rushes
- [ ] C. Notification « rushes manquants » — in-app (la cloche) + email best-effort
- [ ] D. UI wizard : étape « Style & médias »
- [ ] E. Tests + tsc + build

### Écart constaté sur la demande (partie C)
Il n'existe AUCUN système de notifications in-app : la cloche de `Navbar.tsx`
est un bouton décoratif (pas de `onClick`, pastille rouge en dur), et
`/api/admin/notifications` ne règle que les alertes **email** de l'admin.
Il faut donc créer le socle (table + route + cloche), pas « réutiliser ».

### Défaut trouvé au passage
Le déclencheur passe TOUTES LES HEURES et `decideRun` refuse `sans-rush`
AVANT le test d'heure : un compte sans rush reçoit donc **24 emails par jour**.
La notification est écrite avec un anti-doublon de 24 h, et l'email n'est
envoyé que quand la notification a réellement été créée.

## 2026-08-07 — Autopilote : aperçu d'exemple dans le wizard

Branche `feat/autopilote-apercu`.

- [x] Contenu d'exemple pur et testable (`src/lib/autopilot/sample.ts`)
- [x] Pont `onConfigChange` du panneau vers le wizard (aperçu live)
- [x] `AutopilotPreview` réutilise `Preview` — aucun rendu parallèle
- [x] Portée de l'affiche alignée sur `backgroundFor` du montage
- [x] Libellé « exemple » + suppression de la note trompeuse de l'assistant
- [x] Constantes de marque déplacées dans un module feuille (build client)
- [x] 23 tests neufs, 7 mutations validées, tsc + build + suite complète

## 2026-08-07 — Créer simple : le rendu joue dans le cadre d'aperçu

Branche `feat/creer-simple-rendu-inline`.

- [x] Prop `overlay` sur `Preview` — calque posé DANS le cadre, hors du plateau
- [x] Lecteur déplacé dans le cadre ; second bloc `data-play-lecteur` supprimé
- [x] État de chargement dans le cadre, pour la seule destination « aperçu »
- [x] Retour à l'édition NON destructif (l'ancien « Fermer » jetait un rendu payé)
- [x] Bouton unique à trois états : voir / revoir (gratuit) / recomposer
- [x] Non-régression `AutopilotPreview` et fenêtre agrandie (défaut `null`)
- [x] 12 tests neufs, 6 mutations validées, tsc + build + suite complète
