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

## 13. Generation IA suivie, voix joignable (correctifs du 2026-10-27)

### 13.1 Generation : un suivi durable, hors de la requete HTTP

La route `POST …/generation` ne tient plus la requete pendant l'appel au
fournisseur. Elle valide, **reserve** la generation sur le film
(`generation/suivi.ts`), lance l'execution en arriere-plan
(`generation/executeur-generation.ts`) et repond **202** avec l'identifiant.

| Besoin | Mecanisme |
|---|---|
| Identifiant unique | `Film.generations[].id` (UUID), ecrit avant tout debit |
| Pas de double depense | UNE generation active par film, reservee par l'ecriture versionnee du film (`modifierFilm` rejoue sur conflit) ; un second clic recoit **409** `enCours` et la generation existante, sans rien lancer ni debiter |
| Suivi / reprise | l'etat vit sur le film : la page relit le film toutes les 2,5 s tant qu'une generation est `en_cours`, et retrouve cet etat apres un rechargement |
| En cours ≠ echouee | statuts `en_cours`, `reussie`, `echouee`, `interrompue` ; l'erreur et les credits pris/rendus sont ecrits sur la generation |
| Interruption du serveur | au-dela de 15 min (l'appel le plus long est borne a 10 min), une generation `en_cours` est lue `interrompue` ; les credits pris (reference ecrite AVANT l'appel payant) sont rendus, de facon idempotente |
| Finance | logique deplacee telle quelle depuis la route : plafond compte/global reserve avant les credits, credits debites au dernier moment, remboursement apres echec, journal de depense confirme / libere / incertain |

Aucune migration : le film est deja un document JSON versionne.

### 13.2 Confirmation dans la page

Plus de `window.confirm` : une boite native bloque tout le fil de la page tant
qu'elle est ouverte (rendu, minuteurs, sondages). La confirmation d'une
generation payante est un groupe en ligne « Confirmer · N credits », comme la
suppression d'un film.

### 13.3 Voix : cause reelle du « Connect Error »

Verifie depuis le serveur Hetzner (conteneur jetable, 2026-10-27) :
`msedge-tts@2.0.4` → « Connect Error », `msedge-tts@2.1.1` → audio recu. Le
service exige desormais le jeton `Sec-MS-GEC`, envoye a partir de la 2.1. La
dependance passe a `^2.1.1` ; l'API est inchangee. Aucun fournisseur payant
n'est branche sur la voix de Cinema.

## 14. Connecteur Higgsfield (declare, ETEINT)

Second fournisseur de generation reelle, ecrit le 2026-10-28. Il n'enleve rien :
sans la variable `CINEMA_FOURNISSEUR`, le fournisseur reel reste **Replicate**,
avec exactement le comportement d'avant.

### 14.1 Les trois conditions d'allumage

| Variable | Role |
|---|---|
| `CINEMA_FOURNISSEUR=higgsfield` | choix EXPLICITE du fournisseur reel (absent ⇒ Replicate) |
| `CINEMA_GENERATION_REELLE=true` | le meme interrupteur que Replicate, inchange |
| `HIGGSFIELD_API_KEY_ID` + `HIGGSFIELD_API_KEY_SECRET` | cles SERVEUR (jamais `NEXT_PUBLIC_*`) |

Une seule qui manque, et `actif` vaut `false` : `atelier.ts` refuse avant de
construire quoi que ce soit. S'y ajoutent, inchanges, l'autorisation du compte
(`CINEMA_GENERATION_REELLE_COMPTES`), les credits, le plafond par film
(`CINEMA_PLAFOND_USD`, **toujours 2 $ par defaut**) et le plafond par compte.

### 14.2 L'estimation est obligatoire, et elle refuse

`POST /estimate/<modele>` rend le prix du COMPTE pour le corps exact qui sera
soumis (`{"usd": "0.094"}`, documente comme faisant foi). Le connecteur l'appelle
avant chaque generation et refuse dans trois cas, tous **avant** la moindre
soumission payante : budget par unite non verifie, estimation illisible,
estimation superieure au budget autorise. Comme l'estimation prend le meme corps
que la generation, une erreur de schema remonte en 422 **sur l'estimation** :
c'est un pre-vol gratuit autant qu'un devis.

### 14.3 Modeles et bornes de prix

| Operation | Modele | Budget par unite | Source |
|---|---|---|---|
| image | `higgsfield-ai/soul/v2/standard` | 0,0032 $ | blog officiel, lu le 2026-10-28 |
| video | `kling-video/v2.5-turbo/standard/image-to-video` | 0,42 $ (0,042 $/s x 10 s au pire) | blog officiel, lu le 2026-10-28 |
| video | `alibaba/happy-horse/v1.1/image-to-video` | **non verifie ⇒ refuse** | prix non publie hors console |

Ces montants sont des **bornes hautes assumees**, pas une affirmation sur le prix
reel : c'est l'estimation par compte qui tranche a chaque appel. A 0,42 $ la
video, le plafond de 2 $ ne laisse passer que **quatre** plans animes par film —
c'est voulu, et non releve par ce lot.

### 14.4 Ce qui protege l'argent, en plus du plafond

- `Idempotency-Key` sur chaque soumission ; le seul rejeu (apres un echec reseau
  ou un 5xx) rejoue la MEME cle, donc ne peut pas creer une seconde generation
  facturee. C'est la reponse directe au double-debit observe cote Replicate.
- `failed`, `nsfw` et une annulation avant traitement ne sont **pas factures**
  par Higgsfield : ces issues rendent `nonFacture: true`, ce qui LIBERE la
  reservation de depense au lieu de la compter (`plafond-compte.ts`).
- Les fichiers Higgsfield vivent 7 jours : le resultat est rapatrie en local
  immediatement, puis passe par les memes controles qu'un import manuel.
- `status_url` vient de la reponse du fournisseur : il n'est suivi que s'il
  pointe sur `api.higgsfield.ai`.
- L'image source est televersee dans le stockage temporaire du fournisseur
  (`POST /files/generate-upload-url`), ce qui evite d'exposer MinIO ; aucune cle
  n'est envoyee a l'URL presignee.
- **Transferts de medias sans SSRF** (`generation/reseau-sur.ts`). Les URLs de depot, de
  media public et de resultat sont rendues par le fournisseur : jamais une cible de
  confiance, et HTTPS ne suffit pas.
  - URL : https, port 443, sans identifiants, NOM de domaine (jamais une IP litterale,
    `localhost`, un nom a un seul libelle ou un suffixe interne).
  - Adresse : verifiee DANS la resolution utilisee par la connexion (`lookup` de
    `https.request`) — l'adresse controlee est celle de la socket, sans fenetre entre
    verification et connexion (pas de rebinding). Refusees : prive, boucle locale,
    lien-local (metadonnees cloud), CGNAT, documentation, multicast, reserve, et les
    formes IPv6 encapsulant de l'IPv4 (mappee, NAT64, 6to4, Teredo). Un nom qui melange
    adresses publiques et privees est refuse en bloc.
  - Redirections : jamais suivies a l'aveugle ; chaque saut re-verifie (URL puis
    adresse), 3 au plus ; un depot (PUT) n'en suit aucune. Les appels a l'API officielle
    (qui portent les cles) refusent toute redirection (`redirect: 'error'`).
  - En-tetes fournis pour un depot presigne : `Host`, `Content-Length`, `Authorization`,
    `Cookie` et le cadrage du corps sont retires ; aucune cle n'est jamais envoyee.
  - Pas de liste figee de domaines (les noms reels du stockage/CDN ne sont pas
    verifies et peuvent changer) : ce sont les ADRESSES qui sont controlees.
  - Une cible refusee a la reprise est un echec FACTURE definitif (jamais retente).
  - Limite : le connecteur Replicate (inchange) rapatrie encore par `fetch` sans ce
    controle ; hors du perimetre de cette PR.
- A l'expiration de l'attente, la demande est annulee par
  `POST /requests/{request_id}/cancel`. Seul un **202** libere la depense (annulee
  avant traitement, non facturee) ; 400, 5xx ou echec reseau la laissent
  `incertaine`. Le chemin n'est construit que si `request_id` est un UUID.
- Rapatriement borne : 120 s et 200 Mo, plafond verifie PENDANT la reception
  (un `Content-Length` absent ou faux ne permet pas de le depasser).
- ⚠️ Aucune annulation UTILISATEUR d'une generation n'existe a ce jour :
  « Annuler » ne concerne que le rendu du film (local, sans fournisseur). Un tel
  parcours (route, bouton, drapeau sur la generation) reste a concevoir ; il
  devra passer par la meme annulation officielle et la meme regle du 202.

### 14.5 Ce qui reste a faire avant un premier essai reel

1. Creer les cles dans la console Higgsfield et crediter le compte (5 $ suffisent).
2. Appliquer `migrations/2026-10-31-cinema-plafond-compte.sql` (non appliquee).
3. Lire le prix de Happy Horse 1.1 dans la console avant de l'activer.
4. Verifier que `aspect_ratio` est bien accepte par Soul v2 : le schema de la v2
   n'est pas publie dans `openapi.json`, et c'est l'estimation qui le dira — en
   422, gratuitement.

## 15. Prise en main : exemples et apercu agrandi

### 15.1 Trois exemples de depart (`components/cinema/ModelesFilm.tsx`)

Aventure, Romance, Publicite cinematique. Chaque carte remplit d'un coup le titre,
l'histoire AVEC ses repliques, le casting et son apparence, le format, la qualite et
le nombre de scenes. Les vignettes sont les images STATIQUES deja presentes dans
`public/styles-video/` : aucune image generee pour cet ecran.

Deux regles tenues par les tests (`cinema-modeles-film.test.tsx`) :

- **un exemple n'ecrase jamais une saisie sans accord** : tant que les champs sont
  encore ceux d'origine (ou vides), un clic suffit ; des qu'il y a quelque chose a
  perdre — ou qu'un film est charge — la carte demande une confirmation EN LIGNE,
  jamais une boite native ;
- **choisir un exemple ne genere rien** : des `set…` de formulaire, et rien d'autre.
  Aucun appel, aucun credit, aucune composition declenchee.

⚠️ Les repliques des exemples se ponctuent **a la virgule**. `scenario.phrases` coupe
apres chaque `.`, `!` ou `?` : une ponctuation forte DANS les guillemets scinde la
phrase et la replique n'est plus reconnue par `scenario.citation`.

### 15.2 Apercu agrandi

Une icone en haut a droite du cadre ouvre l'apercu en grand ; l'icone de retour, un
clic hors du cadre ou **Echap** referment. Le format (16:9 / 9:16) est tenu par le
meme helper canonique `ratioCadre` dans les deux tailles, et deux bornes (`96vw`,
`80vh`) le font tenir dans un telephone sans jamais le deformer.

Il n'y a **pas de second moteur d'apercu** : la chronologie, la lecture et la voix
restent dans `Apercu` ; `CadreMontage` et `CommandesMontage` ne font que dessiner
l'etat qu'on leur donne. Agrandir ne relance donc rien et ne perd aucune saisie.

⚠️ La fenetre est rendue dans `document.body` par un **portail**. Mesure le
2026-10-28 : la colonne de droite est `lg:sticky`, et `position: sticky` cree
TOUJOURS un contexte d'empilement — la barre laterale (`z-50`) passait par-dessus la
fenetre, qui s'arretait au bord du contenu. Augmenter le `z-index` a l'interieur n'y
pouvait rien.

## 16. Abonnements : films et minutes inclus (prepare, NON active)

`src/lib/cinema/abonnement/`, migration `2026-11-01-cinema-abonnements.sql`
(non appliquee), ecran Administration > « Cinema IA — formules ».

- Une formule Cinema se rattache a une formule existante (`plans.key`). Elle ne
  porte AUCUN prix : le prix CHF reste dans `plans` (Tarification, prix Stripe).
- Grandeurs distinctes : films distincts par periode, secondes de FILM FINAL,
  duree max d'un film, budget fournisseur USD (tentatives et regenerations
  comprises), tentatives (journal, information). Une regeneration d'un film deja
  compte ne consomme ni film ni minute, seulement du budget.
- Sans ligne en base, Cinema n'est PAS inclus : comportement actuel inchange
  (credits). Aucune valeur par defaut n'est choisie.
- Reservation atomique en base (`reserver_quota_cinema`, verrou par compte et
  periode), puis `confirmer_quota_cinema` : confirmee / incertaine (reste comptee)
  / liberee (tout est rendu ; le film reste compte s'il a une autre reservation
  active). Reference unique par compte : aucun double debit.
- Regimes : `cout_reel` (administrateur : ni quota ni credit, cout fournisseur
  reel, plafonds de depense par compte et global maintenus) et `abonnement`.
  Estimation obligatoire et > 0 dans les deux cas.
- Un film qui s'allonge : `reserver_quota_cinema` recoit la duree TOTALE du film
  et n'ajoute, sous le verrou, que la difference avec ce qui est deja reserve pour
  ce film dans la periode. Un film raccourci ne rend rien.

### 16.1 Raccordement (`abonnement/regime.ts`, `executeur-generation.ts`)

- Interrupteur `CINEMA_ABONNEMENTS=true`, FERME par defaut : eteint, tout compte
  reste en regime `credits`, exactement comme avant.
- Regime decide cote serveur, au moment du paiement : `cout_reel` si l'email RELU
  EN BASE depuis l'identifiant de session est admin (`isAdmin`, liste unique de
  `lib/admin.ts`) ; `abonnement` si la meilleure ligne `subscriptions` en
  `active`/`trialing` a une formule qui inclut Cinema ; `credits` sinon ;
  `refus` si la base est illisible (jamais des credits pour ce qui est peut-etre
  inclus). `past_due` n'ouvre pas de quota.
- Ordre dans l'executeur : estimation (obligatoire hors credits) → plafond de
  depense compte/global (tous regimes) → quota atomique (abonnement) ou credits
  (regime credits seulement). Plafond par film (2 $) inchange, dans l'atelier.
  Un refus libere la depense reservee. Apres l'appel, le quota prend le MEME
  statut que la depense (liberee seulement sur preuve de non-facturation).
- Depassement : REFUS avec la raison (402 des la route). Aucune bascule vers les
  credits, aucun supplement.
- Periode : fenetres mensuelles ancrees sur `subscriptions.current_period_end`
  (seule date que le webhook ecrit). Fin inconnue ou passee : aucun quota.
- Affichage : `GET /api/cinema/films/[id]/quota` + `components/cinema/QuotaCinema.tsx`
  (films, minutes, duree du projet, disponibilite ; dollars pour l'admin
  seulement). Regime credits : rien n'est affiche.

### 16.2 Reconciliation

- La generation note `referenceDepense` et `referenceQuota` AVANT l'appel payant.
- Interrompue (serveur mort, bail expire) : `solderGenerationsInterrompues`
  rend les credits (regime credits, idempotent) et passe depense ET quota en
  `incertaine` — jamais `liberee` : rien ne prouve que l'appel n'a pas ete
  facture. `depenseReconciliee` evite de le refaire ; base injoignable = retente.
- Reussie apres interruption (executeur vivant, bail perdu) : depense et quota
  reclasses `confirmee` (facture). Le media est LIVRE (`livrerApresInterruption`)
  seulement si la generation n'a pris AUCUN credit (abonnement, administrateur)
  et que le plan n'a pas change depuis le depart — ecriture gardee, une seule
  livraison. Sinon (credits rendus, ou plan modifie) il est jete et la
  generation le DIT a l'utilisateur. Echec prouve non facture apres
  interruption : `incertaine` → `liberee`. Une issue definitive n'est jamais
  ecrasee (`deja_finalisee`).
- Processus MORT pendant l'appel (`generation/reprise.ts`) :
  - AVANT l'appel payant, la generation porte `externe` : fournisseur, cle
    d'idempotence (envoyee telle quelle a Higgsfield ; Replicate n'en propose
    pas), cout estime, media du plan au depart, date de soumission ;
  - DES l'acceptation, avant toute attente, l'identifiant de la demande y est
    ajoute (Higgsfield : apres la reponse de soumission ; Replicate : rappel
    `progress` du SDK, a la creation de la prediction) ;
  - a la relecture du film (GET) et avant une nouvelle generation, chaque
    generation interrompue est REPRISE : bail exclusif sur la generation, puis
    LECTURE SEULE du statut chez le fournisseur — jamais de resoumission ;
  - termine → media controle comme a la generation, livre si aucun credit pris
    et plan inchange, depense et quota `confirmee` ; echec non facture (engagement
    ecrit) → `liberee` ; echec sinon → `confirmee` ; en cours ou injoignable →
    retente plus tard ; sans identifiant, introuvable, ou au-dela de 7 jours →
    depense `incertaine` conservee et expliquee, jamais annoncee remboursee.
- Limite assumee : un arret ENTRE l'acceptation par le fournisseur et l'ecriture
  de son identifiant laisse une demande non relisible (`introuvable`). Elle n'est
  JAMAIS resoumise automatiquement (la resoumission avec la meme cle n'est pas un
  « nouvel appel » chez Higgsfield, mais la regle est : aucun appel payant pendant
  une reprise). Fenetre de quelques millisecondes, comptee en `incertaine`.
- Les champs `externe` et le bail de reprise ne sortent jamais vers le
  navigateur (`filmPublic`, `generationPublique`).

### 16.3 Devis global et budget du projet

- `devisProjet` : scenes, plans, duree, qualite, modeles et prix unitaires,
  images manquantes, animations possibles, deja engage ; deux perimetres
  approuvables (`images`, `complet`). Tarif inconnu = `null`, jamais partiel.
- Hors regime credits, AUCUNE generation payante sans `film.budgetApprouve`
  (POST `…/quota`, devis RECALCULE par le serveur, borne par le plafond par film
  et, pour l'abonne, par le budget restant de la formule). Le budget approuve
  borne la depense CUMULEE du film a chaque generation (route et executeur).
  Le regime credits garde sa confirmation par generation, inchangee.

### 16.4 Minutes reellement produites

- Les generations reservent des minutes PREVUES ; le rendu final les regle :
  `reserver_production_cinema` avant de rendre (ajustement signe, refus si les
  minutes manquent), `finaliser_production_cinema` sur la duree mesuree (jamais
  au-dela de la reserve), liberation si le rendu n'aboutit pas.
- Un film deja livre ne rend pas ses minutes en etant raccourci ; un film sans
  generation payante dans la periode n'est pas concerne (rendu libre).
- Budget fournisseur (USD) et minutes sont deux compteurs separes : un film plus
  court rend des minutes, jamais du budget consomme.

### 16.5 Reste a faire avant activation

Valeurs par formule ; application de la migration (puis SIGUSR1 PostgREST) ;
reconciliation des depenses `incertaine` contre l'etat reel chez le fournisseur
(lecture de statut, a construire sans appel payant) ; verification en staging
avec un abonnement Stripe de test.

## 17. Styles cinematographiques et mouvements de camera

Six styles (Cinema realiste, Film noir, Publicite premium, Romantique, Documentaire,
Science-fiction), definis dans `src/lib/cinema/direction/styles.ts` : profil, eclairage,
palette, ambiance, texture. Un style est choisi pour le film (`film.styleCinema`) et peut
avoir une exception par scene (`scene.styleCinema`). Huit mouvements de camera par plan
(`plan.camera`, `direction/camera.ts`) : automatique (defaut, champ absent), fixe, travelling
avant/arriere, panoramique gauche/droite, suivi lateral, orbite.

**Application reelle** : `generation/atelier.ts` enveloppe le prompt du moteur partage
(`lib/ai/prompt-image.ts`, non modifie) avec `direction/prompt.ts`, a chaque generation, depuis
le film COURANT (premiere generation et regeneration passent par le meme chemin). Image : bloc
de style avant le rappel « Original request ». Video : la camera remplace la consigne figee
« subtle and steady camera motion », le style est rappele. Le bloc de style interdit de
modifier personnages, dialogues et decor.

**Limites** : aucun connecteur (Replicate wan-2.1, Higgsfield Kling) n'expose de parametre de
camera natif : le mouvement est une INDICATION dans le prompt, pas une garantie. Les miniatures
sont des illustrations statiques (`public/cinema-styles/`), jamais des resultats generes.

**Donnees et couts** : champs optionnels du JSON du film, aucune migration. Un film d'avant n'a
aucun champ : ses images sont inchangees ; ses videos recoivent la camera automatique. Style et
camera ne changent ni modele, ni duree, ni devis, ni empreinte de scene : aucune re-validation
de budget, aucune depense au choix. API : `POST /films {styleCinema}`, `PATCH {style}`,
`{scenes:[{id, style}]}`, `{plans:[{id, camera}]}` (`null` ou `auto` retire le reglage).
