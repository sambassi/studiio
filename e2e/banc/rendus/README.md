# Rendus de validation — deux démos complètes par les VRAIS moteurs

Rejouable à chaque nouvelle branche (ex. « textes ») : mêmes entrées, mêmes commandes, mesures comparables.
Aucun appel fournisseur, aucune écriture DB / stockage : `.env.local` du banc (127.0.0.1, clés factices).

## 0. Préparer (une fois par worktree)

```sh
cp /Users/afroboost/studiio-qualite/.env.local .env.local   # env du banc, isolé
npm ci --no-audit --no-fund
sh e2e/banc/preparer-medias.sh                # médias du banc (voix.mp3…)
sh e2e/banc/rendus/preparer-demos.sh          # avatar 24,68 s, 3 stocks, 3 rushes SPORT, affiche, musique
export DEMOS=/chemin/de/sortie/demos          # ex. le scratchpad de la session
```

Les deux MP4 sources (`~/Downloads/MOTIVATION.mp4`, `~/Downloads/LE_SPORT_LE_PLUS_COMPLET (2).mp4`) sont
des RENDUS : leurs anciens textes incrustés sont floutés par bandes dans les médias extraits
(`flou` dans `preparer-demos.sh`) pour ne pas être confondus avec les textes du nouveau rendu.

## A. Autopilote « Motivation » (moteur serveur Remotion / hybride)

```sh
npx --no-install tsx --env-file=.env.local e2e/banc/rendus/autopilote-motivation.ts "$DEMOS"
```

Sorties : `autopilote-motivation.mp4`, `props.json` (entrée exacte de la composition), `autopilote-motivation-plan.json`
(plan, fenêtres des textes, quality gate), `autopilote-motivation-bilan.json` (moteur, durée plan vs fichier).

Props construites par les fonctions réelles de `produireUnMontage` (branche jumeau + multi-sources) :
`preparePosts` (smart-content, graine 2 = les cartes du MP4 de l'utilisateur), `sanitizeConfig`,
`mediasDesSources`, `buildAutopilotDesign`, `gabaritSuggere`, `pertinencesPourPlan`, `planOverlays`,
`planMultiSources`, `sansLisibiliteCtaAction`, `appliquerMiseEnPageSurimpression`, `controleQualite`, puis
`raisonNonEligibleHybride` → `rendreHybride` ou `renderCreerSimple` (bundle Remotion + Chromium réels).
Simulé : HeyGen (avatar = passages réels mis bout à bout), sondes réseau (ffprobe local), stock Pexels
(adresses « studiio.pro/storage/…/media/ » qui passent la garde SSRF, remplacées par un serveur
http://127.0.0.1 juste avant le rendu), aucun dépôt / post / débit.

Rejouer seulement le rendu Remotion depuis `props.json` : le serveur de médias du script doit tourner
(les URL de `props.json` portent son port) — relancer plutôt le script complet.

## B. Créer « LE SPORT LE PLUS COMPLET » (compositeur navigateur, Chromium réel)

```sh
DEMO_SORTIE="$DEMOS" BANC_PORT=3200 npx playwright test -c e2e/banc/playwright.banc.config.ts \
  e2e/banc/demo-creer.spec.ts --project ordinateur
ffmpeg -y -i "$DEMOS/creer-sport.webm" -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p \
  -r 30 -c:a aac -b:a 160k -ar 48000 -movflags +faststart "$DEMOS/creer-sport.mp4"
```

Le scénario fait produire un brouillon par l'interface, le remplace par celui de l'utilisateur
(titre, sous-titre, 5 cartes, 3 rushes, voix par séquence, musique, CTA) **sans `versionLisibilite`**,
recharge (« Brouillon restauré »), passe à Envoi, garde en brouillon et compose. Le PUT du blob est
intercepté (`fixtures.ts`) → `creer-sport.webm`. `BANC_PORT` évite de réutiliser le `next dev` d'un autre
worktree (défaut 3100 ; 3200 réservé à ces démos). Si l’app propose « Continuer avec N s » (matière insuffisante), le scénario continue, comme l’utilisateur.

## C. Mesures

```sh
sh e2e/banc/rendus/analyser.sh "$DEMOS/autopilote-motivation.mp4" 3.5 3.95 5.5 22.3 24.4 24.65
sh e2e/banc/rendus/analyser.sh "$DEMOS/creer-sport.mp4" 0.5 3 6 …   # timecodes à inspecter
```

→ `*.mesures.txt` (ffprobe, coupes `scene>0.2`, `freezedetect`, `silencedetect`, `ebur128`),
`*.planche.png` (fps 2/3, sans drawtext), `*.instants.png` (une image par timecode).
