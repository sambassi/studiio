# Studiio Cinema IA — module, etat reel, suite

> Branche `feat/cinema-ia`, worktree `/Users/afroboost/studiio-cinema-ia`, base
> `origin/main` (`02fedad`). Rien n'est pousse, rien n'est deploye, aucune
> table n'est creee EN PRODUCTION (la migration du lot 4 est ecrite et testee
> sur un PostgreSQL local, pas appliquee), aucun fournisseur payant n'est actif.

## 1. Ce que c'est

Un module **a part** de Creer et de l'Autopilote : une histoire ecrite devient
un film court (3 a 5 scenes), avec des personnages reutilisables, des
repliques, un apercu et un MP4.

Le couplage avec le reste du depot est volontairement limite a des briques
**pures et deja prouvees** :

| Reutilise | D'ou | Pourquoi celui-la |
|---|---|---|
| `debitParoleAvatar` | `lib/autopilot/duree-cible` | la seule regle de debit de parole du projet, pure |
| Remotion (`remotion/index.tsx`, `webpackOverride`) | `lib/render/webpackOverride` | le seul chemin de rendu video serveur qui marche ici (alias `@/` inclus) |
| ffmpeg / ffprobe | `lib/ffmpeg/binaires` | un seul endroit sait ou sont les binaires ; ne pas en creer un quatrieme |
| `msedge-tts` | `api/tts/edge` | moteur de voix gratuit deja en service |

Ce qui n'est **pas** reutilise, et pourquoi : `lib/render/worker.ts` et
`moteur-export-serveur.ts` (attaches a la base, au stockage, aux credits et
aux jetons de relais), `lib/rendus/*`, `lib/credits/*`. La composition
Remotion, elle, est partagee : c'est le morceau qu'un futur rendu serveur
reprendra tel quel.

## 2. Lot 2 — de la carte au media reel

Un plan peut desormais porter une IMAGE ou une VIDEO locale, et c'est elle
que le MP4 montre.

| Point | Ce qui est tenu |
|---|---|
| Import | `POST /api/cinema/films/<id>/medias` recoit des OCTETS (multipart), jamais une URL. Le serveur ecrit le fichier sous `public/cinema/<film>/medias/`, puis le MESURE a `ffprobe`. |
| Validation | extension dans la liste, taille <= 200 Mo, et surtout **le contenu doit correspondre** : un `.mp4` qui n'est pas une video est efface et refuse. Le nom du fichier ecrit ne vient jamais du client (identifiant du plan + tirage aleatoire). |
| Cadrage | `objectFit: cover` — UNE echelle pour les deux axes, donc **aucun etirement**. `montage.cadrage` chiffre le rognage (`rogneX`, `rogneY`), ce qui permet de le tester. |
| Duree | une video sans parole **commande** son plan (bornee a 12 s) ; avec parole, c'est la PAROLE qui commande : la video trop longue est coupee, la trop courte voit sa **derniere image figee**. La voix n'est jamais acceleree. |
| Son | le son d'un rush est **coupe par defaut** (`sonActif: false`) : il couvrirait la replique. Un bouton par plan le rend. |
| Media manquant | un media declare et introuvable **arrete le rendu** (`ErreurMediasManquants`, 400 avec la liste des plans). En aperçu, il est signale. Il n'est JAMAIS remplace en silence par une carte. |
| Regeneration | le media importe entre dans l'empreinte de sa scene : le changer ne refait que cette scene. Un media `genere` par le rendu, lui, n'y entre pas. |

⚠️ `montage.ts` et `types.ts` sont compiles dans le bundle NAVIGATEUR de
Remotion : les fonctions pures partagees (`cadrage`, `dureePlanAvecMedia`)
vivent dans `types.ts`, jamais dans `medias.ts` qui ouvre des fichiers. Les y
importer embarquait `fs` dans webpack, qui echouait sur « Can't resolve
'url' ».

## 3. Architecture

```
src/lib/cinema/
  types.ts        Film -- Scene[] -- PlanCinema[]  (+ dureeFilm, TAILLES)
  scenario.ts     histoire -> scenes (LOCAL, deterministe, sans reseau)
  medias.ts       import, sonde ffprobe, medias manquants (SERVEUR)
  personnages.ts  references VERSIONNEES, apparence pour prompt
  empreinte.ts    hash de ce qui change l'image -> quoi reproduire
  couts.ts        devis AVANT production, tarif inconnu != zero
  montage.ts      LA chronologie (segments absolus) + sous-montage par scene
  voix.ts         repliques synthetisees (edge, repli hors ligne annonce)
  rendu-local.ts  bundle unique + renderMedia par scene, ffprobe, recollage
  atelier.ts      le parcours complet, appele par l'UI, l'API et le banc
  store.ts        films en JSON (hors base, volontairement)
remotion/CinemaFilm.tsx        composition `cinema-film`
src/app/api/cinema/films/...   REST (session verifiee dans chaque route)
src/app/dashboard/cinema/      le parcours en une page
tests-cinema/                  banc de production reelle (config a part)
```

### L'ordre qui compte

1. decoupage de l'histoire ;
2. casting et references ;
3. scenes a produire = **empreinte differente**, **MP4 absent**, ou demande
   explicite ;
4. **devis avant** production ;
5. voix, puis **durees alignees sur la parole mesuree** ;
6. rendu **scene par scene** (cache par scene) ;
7. recollage `-c copy` + `+faststart`, puis **controle ffprobe**.

### Quatre decisions a ne pas defaire

- **La duree d'un plan parle ne compte pas dans son empreinte.** Elle est
  derivee de la voix, mesuree apres la synthese : la compter rendrait chaque
  production salissante pour sa propre empreinte, donc « a reproduire » pour
  toujours. La duree d'un plan **muet**, elle, compte.
- **Une scene est scellee APRES le rendu, jamais avant.** Sceller d'abord,
  c'est declarer valide un media qui n'existe peut-etre pas.
- **La voix n'est jamais acceleree.** C'est la duree du plan qui cede.
- **Un personnage ne parle que s'il y a des guillemets.** Le scenariste local
  n'invente pas de dialogue : attribuer une phrase de recit a un personnage
  ferait lire a l'image « Nina : Marco la regarde sans bouger ». Sans
  guillemets, la ligne est une **narration**, dite par le narrateur, sans nom
  affiche.

## 4. Couts

`FOURNISSEURS_VISUELS` declare les emplacements ; un seul est **actif** :
`cartes-remotion`, local, `0 USD/s`. Les autres ont `usdParSeconde: null` et
`actif: false` — et `devisFilm` rend alors un total **`null`**, affiche comme
« tarif non declare », jamais comme gratuit.

## 5. Gardes d'acces (revue de securite du 2026-10-26)

`/api/cinema/*` n'est PAS dans le `matcher` du middleware : chaque route
verifie donc elle-meme. `src/lib/cinema/acces.ts` tient les trois regles,
testees dans `src/__tests__/cinema-acces.test.ts` :

| Regle | Defaut evite | Verifie |
|---|---|---|
| Un film a un **proprietaire**, compare a la session sur GET, PATCH et `produire` ; la liste est filtree | IDOR : l'identifiant suffisait a lire, modifier et faire rendre le film d'autrui | 404 sur les trois routes, liste vide |
| Un identifiant suit `^film-[a-z0-9][a-z0-9-]{0,62}$`, a la lecture **comme a l'ecriture** | traversee de chemin (`../`) dans le magasin | 404, et `enregistrerFilm` leve |
| Un media de plan est un chemin **local** sous `cinema/` | SSRF : l'URL d'un plan est chargee par Chromium au rendu | 400 sur `http://169.254.169.254/...` |
| Les **octets** sont reconnus avant toute ecriture (`signatureConnue`), ffprobe tourne avec `-protocol_whitelist file`, et le conteneur doit etre dans la liste | une « video » qui est une liste de lecture (HLS, `concat`) fait sortir une requete du serveur depuis ffprobe | 400 sur un `.mp4` contenant `#EXTM3U` + une URL |
| La taille est refusee **sur `Content-Length`**, avant `formData()` | saturation memoire : `formData()` avale tout le corps avant qu'on puisse le mesurer | 413 au-dela de 200 Mo, 411 sans `Content-Length` |

Un film d'avant cette regle (sans proprietaire) n'appartient a personne : il
devient inaccessible plutot que public — l'un se repare, l'autre fuite.
L'echec de `produire` rend une reference courte ; le detail (stderr, chemins)
reste dans le journal du serveur.

## 6. Etat reel

**Fonctionnel et verifie** : decoupage, casting versionne, empreintes,
devis, chronologie, voix (moteur hors ligne sur ce poste), rendu scene par
scene, cache de scene, recollage, controle ffprobe, API REST, page du parcours.

**Simule / en place mais non prouve** : aucune generation IA n'est branchee —
les plans sans media importe restent des **cartes de plan** dessinees par
Remotion ; la coherence visuelle d'un personnage en generation IA **n'a pas
ete testee** et n'est pas promise ; la persistance est un fichier JSON local,
pas une table ; les transitions sont des fondus courts par plan, sans fondu
enchaine entre scenes (le recollage se fait en copie de flux).

**A faire pour un vrai Studio Cinema IA** : voir le rapport de session.

## 7. Commandes

```bash
npm test                                  # suite du depot (cinema inclus, sans reseau)
npx vitest run src/__tests__/cinema-scenario.test.ts
npx remotion browser ensure               # une fois : Chrome Headless Shell
npm run test:cinema                       # banc de production REELLE (voix + MP4)
npx remotion studio                       # composition `cinema-film` a la main
```

Le banc a sa propre config (`vitest.cinema.config.ts`) parce que le `setup.ts`
du depot interdit toute socket — y compris la socket **locale** de Remotion —
et parce que `jsdom` casse esbuild. Le garde-fou n'est pas affaibli : il est
contourne dans un fichier qu'on lance a la main.

## 8. Mesures du 2026-10-26 (poste local, Apple Silicon)

Banc `npm run test:cinema`, histoire de 8 phrases, 2 personnages, 4 scenes,
format 16:9, qualite standard :

| Mesure | Valeur |
|---|---|
| Duree du banc complet (3 productions enchainees) | 73 s |
| MP4 final | 38,1 s · 6,49 Mo · 1920x1080 · h264 + aac |
| Ecart duree fichier / duree montage | < 1,5 s (assertion du banc) |
| Voix synthetisees | 8 fichiers, 252 Ko |
| Niveau sonore du film | moyenne -23,6 dB, crete -4,6 dB (non muet) |
| Devis | 0 USD (fournisseur local) |
| 2e production sans changement | 0 scene rendue, 4 reprises du cache |
| Regeneration d'une scene | 1 scene rendue, 3 reprises |

Moteur de voix reellement utilise : **`systeme`** (macOS `say` + ffmpeg).
`msedge-tts` a echoue a ouvrir son WebSocket sur ce poste
(« Connect Error ») ; le repli est annonce dans `avertissements`, jamais
silencieux.

## 9. Mesures du lot 2 (2026-10-26)

Banc `tests-cinema/medias.cinema.test.ts`, 4 scenes, 4 medias locaux (une
video 1920x1080 de 8 s, une video 1280x720 de 2,5 s, une image 1920x1080, une
image verticale 270x480), format 16:9 :

| Mesure | Valeur |
|---|---|
| MP4 | 43,6 s · 5,99 Mo · 1920x1080 · h264 + aac |
| Medias a l'image | dominante de couleur du MP4 = celle du fichier source, pour les 4 plans |
| Cadrage vertical (270x480 dans 16:9) | `rogneX = 0`, `rogneY ≈ 0,68`, une seule echelle |
| Image au format du film | `echelle = 1`, aucun rognage |
| Changement d'un media | 1 scene rendue, 3 reprises du cache |
| Media efface du disque | rendu refuse (`ErreurMediasManquants`), aperçu avertit |

## 10. Lot 4 — stockage durable et production asynchrone (2026-10-26)

### 10.1 Ce qui change, en une phrase

Les films, leurs medias et leurs MP4 ne vivent plus dans `var/` et `public/`
d'un serveur : ils vivent dans PostgreSQL et MinIO, **prives par compte**, et
la production tourne **en arriere-plan**, reprenable.

### 10.2 Deux modes, un interrupteur

| `CINEMA_STOCKAGE` | Films | Travaux | Objets (medias, MP4) |
|---|---|---|---|
| absent / autre (**defaut**) | `var/cinema/films/*.json` | memoire du processus | `var/cinema/objets/` |
| `durable` | table `cinema_films` | table `cinema_travaux` | MinIO, compartiment `media` |

Le defaut ne parle ni a la base ni a MinIO : tant que la migration n'est pas
appliquee et la variable posee, **rien de Studiio ne change**. Dans les deux
modes, **aucun media n'est ecrit dans `public/`** (les anciens benchs du
lot 1-3 l'utilisent encore, via `produireFilm`, comme outil local).
`CINEMA_PLAFOND_USD` fixe le plafond de depense par film (defaut 2 $, borne 10 $,
valeur invalide = defaut). Le client ne peut que le RABAISSER.

### 10.3 Stockage — ce qui est reutilise

| Besoin | Reutilise | Ajoute |
|---|---|---|
| Fichiers | MinIO et son client (`lib/storage/minio-client`), compartiment `media` | `stockage/objets.ts` : une interface (memoire / dossier / MinIO) |
| Propriete | `cleDuCompteStrict`, la regle du relais de stockage | `stockage/cles.ts` : toute cle est `<compte>/cinema/<film>/…`, fabriquee par le serveur |
| Lecture privee | la doctrine des vignettes d'analyse (cle relue en base, 404 partout) | routes `…/medias/<plan>`, `…/voix/<plan>`, `…/references/<perso>`, `…/travaux/<id>/export` ; `Range` 206/416, `nosniff`, CSP, cache prive |
| Base | PostgREST, `supabaseAdmin`, modele de moindre privilege (#533) | `migrations/2026-10-27-cinema-ia.sql` (2 tables, 2 fonctions) |

Cles : `medias/`, `references/`, `voix/<plan>-<empreinte>.mp3`,
`scenes/<scene>-<empreinte>.mp4`, `exports/film-<empreinte>.mp4`. La cle d'une
scene porte l'empreinte de ce qui la produit : **modifier une scene change sa
cle**, l'ancienne n'est jamais servie pour la nouvelle.

### 10.4 Production asynchrone

```
POST …/produire {rendre:true}  → 202 { travail }          (quelques ms)
GET  …/travaux/<id>            → etat reel, progression    (sondage de l'ecran)
POST …/travaux/<id>/annuler    → arret a la prochaine note
GET  …/travaux/<id>/export     → le MP4 (proprietaire seulement)
```

| Besoin | Mecanisme |
|---|---|
| Ne pas bloquer le navigateur | l'executeur tourne dans le processus Node (long-vivant), file locale d'UN rendu a la fois |
| Progression reelle | `pourcent` derive des scenes `faite`/`reutilisee`, ecrit dans la ligne du travail |
| Conserver les scenes terminees | une scene est deposee (objet durable) AVANT d'etre annoncee `faite` |
| Reprendre apres interruption | **bail** renouvele par battement de coeur ; bail expire = reprenable ; relu a chaque lecture d'un travail (30 s) ; 5 prises max |
| Ne regenerer que le modifie | cache par empreinte de scene ; scene demandee = refaite, les autres reprises |
| Pas de double generation | **un seul travail actif par film** (index unique partiel), jeton de prise (`tentatives`) : un executeur perime ne peut rien ecrire |
| Pas d'ecrasement film/rendu | film versionne, `modifierFilm` rejoue sur la version recente |

Pas de cron : la table EST la file, et un cron pourrait la rappeler sans
risque (`reprendreOrphelins`).

### 10.5 Couts et securite

- Aucun fournisseur payant actif ; `lib/credits`, Stripe, `lib/rendus` ne sont
  importes nulle part (un test lit le code source).
- Plafond cote serveur, verifie a la route (402) ET re-verifie par l'executeur ;
  tarif inconnu = refus.
- Images de reference : octets seulement, plus d'URL libre (`referenceCinemaValide`).
- Medias : octets verifies avant ecriture, ffprobe verrouille (lot 2), taille
  refusee avant lecture du corps.
- Dossiers de travail `var/cinema/travail/<travail>-<prise>/`, effaces a la fin ;
  les medias y sont copies pour Remotion (`publicDir`), jamais exposes.
- Erreurs : une phrase + une reference ; le detail reste dans le journal.

### 10.6 Ordre de mise en service (regle du projet : base d'abord)

1. appliquer `migrations/2026-10-27-cinema-ia.sql` ;
2. `docker kill -s SIGUSR1 studiio-postgrest` ;
3. verifier (requetes de controle en pied de migration) ;
4. SEULEMENT ENSUITE deployer l'application avec `CINEMA_STOCKAGE=durable`.

Retour arriere : retirer la variable (l'application retombe sur le mode local),
puis `migrations/rollback/2026-10-27-cinema-ia.rollback.sql` si besoin.

### 10.7 Tests

| Suite | Fichier | Ce qu'elle prouve |
|---|---|---|
| unitaire | `cinema-stockage.test.ts` | cles, objets (3 implementations), films (isolement, versions), service `Range` |
| unitaire | `cinema-travaux.test.ts` | file, reprise, jeton, annulation, cache par scene, plafond |
| unitaire | `cinema-routes.test.ts` | HTTP de bout en bout, isolation entre comptes, import/generation reels (ffprobe, ffmpeg) |
| unitaire | `cinema-page.test.tsx` | progression, erreurs visibles, icones accessibles, simulation annoncee |
| PostgreSQL reel + PostgREST reel | `tests-pg/cinema-ia.pg.test.ts` | migration, droits, concurrence (8 creations → 1 travail ; 8 prises → 1 gagnant), depots TypeScript sur la vraie base |
| banc (Remotion reel) | `tests-cinema/durable.cinema.test.ts` | MP4 reel depuis medias prives, couleur mesuree, relance sans rien refaire, une scene, reprise apres « mort » |


## 11. Lot 5 — securite d'acces, compatibilite serveur, suppression

### 11.1 L'interrupteur general (`lib/cinema/garde.ts`) — remplace le verrou a un compte

Cinema IA est destine a TOUS les utilisateurs authentifies, derriere un interrupteur
serveur **eteint par defaut** : `CINEMA_ACTIVE=true` (ou `1`) l'allume ; toute autre
valeur, ou l'absence, ferme le module (404 sur la page et sur les 13 routes, meme pour
une session valide). La restriction a un compte administrateur (`CINEMA_COMPTE_AUTORISE`)
est supprimee.

Allume, ce qui protege ne depend d'aucun role : session obligatoire (401), isolation
par compte (film d'autrui = inconnu, fichiers sous `<compte>/cinema/…`), bornes par
compte (50 films, 2 travaux actifs, plafond de depense serveur, 10 Mo de reference).
La page est gardee par `dashboard/cinema/layout.tsx` (composant serveur), les routes par
`sessionCinema()`.

### 11.2 MinIO

- `adapterClientMinio` assemble `clientMinio()` + `lecteurMinio()` (clients
  existants, memes variables `MINIO_*`). Le banc `tests-cinema/minio.cinema.test.ts`
  l'execute avec le **vrai SDK `minio@8.0.7`** contre un **vrai serveur MinIO jetable**
  (127.0.0.1, dossier temporaire, identifiants fictifs) : depot en flux, plage,
  telechargement atomique (`.part`), liste, suppression, objets prives (403 anonyme,
  aucune politique de compartiment), panne reseau = erreur (jamais « absent »).
- **Le MinIO de production n'a pas ete interroge** (aucun identifiant ici).
  Verification en lecture seule a faire sur le serveur, sans rien ecrire :

  ```bash
  # dans le conteneur studiio-app (variables MINIO_* deja presentes)
  node -e "const {clientMinio}=require('./src/lib/storage/minio-client');
    const c=clientMinio(); (async()=>{
    console.log('bucket media existe :', await c.bucketExists('media'));
    try{console.log('politique :', await c.getBucketPolicy('media'));}catch(e){console.log('politique :', e.code)}
    let n=0; for await (const o of c.listObjectsV2('media','',false)){ if(++n>5)break; console.log(o.name||o.prefix);} })()"
  ```
  Attendu : `existe true`, politique absente ou connue, aucune ecriture.
  Un test d'ecriture reel (objet fictif sous `__cinema-verif__/`, puis suppression)
  n'est a faire que sur GO explicite.

### 11.3 Serveur Linux (image Docker existante)

- Verifie sur le `Dockerfile` : ffmpeg **et ffprobe** (paquet Debian), bibliotheques de
  Chromium, `fonts-liberation`, `remotion/`, `src/`, `tsconfig.json` et tout le scope
  `@remotion` sont dans l'image ; la composition `cinema-film` vit dans `remotion/`.
  L'image n'a pas pu etre construite ici (pas de Docker).
- **Defaut corrige** : le conteneur tourne en `nextjs` et `/app` appartient a root, donc
  `var/cinema/travail` n'etait pas creable. En mode durable, le dossier de travail est
  `<tmp>/studiio-cinema` (ou `CINEMA_DOSSIER_TRAVAIL`, chemin absolu).
- Rendu : memes `chromiumOptions: { gl: 'angle' }` que `lib/render/worker.ts`.
- Concurrence : Cinema **attend** qu'aucun rendu `renderVideo` ne soit actif
  (`rendusRemotionActifs`) et que la memoire libre soit >= 1536 Mo, jusqu'a 10 min
  (puis echec « serveur occupe », rien de facture). Il s'annonce pendant son rendu
  (`entrerRenduRemotion`). Concurrence Chromium : 2 (1 sur <= 2 coeurs ;
  `CINEMA_CONCURRENCE_RENDU`, borne 4). L'Autopilote n'est pas modifie ; son rendu
  hybride (ffmpeg + son propre Chromium) n'est pas compte par ce compteur.
- Voix : Edge TTS (gratuit). Le repli `say` n'existe que sous macOS : sur Linux il est
  desactive. Si des repliques n'ont pas de voix, le travail s'arrete **avant** le rendu
  avec « synthese vocale indisponible pour N replique(s) … rien n'a ete rendu ni
  facture ». Joignabilite d'Edge depuis le serveur : non verifiee ici (`/api/tts/edge`
  l'utilise deja en production).

### 11.4 Suppression d'un film (`stockage/suppression.ts`, `DELETE /api/cinema/films/<id>`)

Film inconnu ou d'autrui → 404 · rendu actif → 409 · stockage en echec → 502 (le film
est conserve, l'operation se rejoue). Le dossier `<compte>/cinema/<film>/` est liste
(prefixe fabrique par le serveur, refuse par le port s'il n'est pas « un dossier de
film »), chaque cle est revérifiee (`cleDuCompteStrict`), les objets sont supprimes,
la ligne du film en dernier. Les medias ne sont jamais partages entre films (l'import
copie) ; aucune cle hors du dossier du film n'est jamais supprimee. Interface : icone
corbeille, puis coche de confirmation.

### 11.5 Tests du lot 5

| Suite | Fichier |
|---|---|
| interrupteur (regle, page, balayage des 13 routes / 16 handlers) | `cinema-verrou.test.ts` |
| suppression (memoire, routes, page) | `cinema-suppression.test.ts`, `cinema-routes.test.ts`, `cinema-page.test.tsx` |
| ressources, voix, dossier de travail | `cinema-travaux.test.ts` |
| objets : `lister` sur les 3 implementations | `cinema-stockage.test.ts` |
| MinIO reel jetable | `tests-cinema/minio.cinema.test.ts` |

## 12. Economie de ressources (serveur Hetzner partage)

- **Fuite corrigee** : `bundle()` de Remotion ecrit dans `<tmp>/remotion-webpack-bundle-*` et ne l'efface jamais
  (~50 Mo par rendu + une COPIE des medias prives). Le bundle est desormais ecrit dans
  `<dossier du travail>/bundle` (`dossierBundle`) : il disparait avec le dossier, succes ou echec, et n'est
  jamais partage entre travaux. Le banc reel verifie qu'aucun bundle ne reste dans le temporaire. Le bundle
  du rendu serveur existant (`lib/render/worker.ts`, en cache) n'est pas touche.
- **Memoire du rendu** (sans effet sur l'image ni le son, un peu plus lent) : 1 onglet Chromium
  (`CINEMA_CONCURRENCE_RENDU`, 1 par defaut, 4 au plus), `disallowParallelEncoding`, caches de decodage bornes
  (`CINEMA_CACHE_VIDEO_MO` 256, `CINEMA_CACHE_MEDIA_MO` 128), 1 fil de decodage de rush. La resolution n'est
  jamais reduite automatiquement. Cout mesure sur le banc : 82 s -> 129 s pour le meme film.
- **Verification AVANT CHAQUE scene** (et non plus une fois) : memoire libre >= 1536 Mo, aucun rendu `renderVideo`
  actif, aucun Chromium/ffmpeg etranger dans le conteneur (lecture de `/proc`). Attente bornee a 10 min.
- **Autopilote : pas de garantie.** Cinema le detecte par ses processus, mais un rendu qui demarre apres la
  verification n'est pas vu, `/proc` ne montre que le meme conteneur, et hors Linux la detection est
  impossible (`null`, jamais « libre »). Autopilote n'est pas modifie et ne se coordonne pas avec Cinema.
- **Dossiers abandonnes** : `balayerDossiersAbandonnes` (au plus toutes les 10 min) n'efface que les enfants
  directs de `<tmp>/studiio-cinema` nommes `<uuid>-<prise>` ou `tmp-<hex>`, vrais dossiers (pas de lien),
  hors de ce processus, de plus de 3 h. Au moindre doute : conserve. Le temporaire du systeme n'est jamais balaye.
