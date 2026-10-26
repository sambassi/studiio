# Studiio Cinema IA — module, etat reel, suite

> Branche `feat/cinema-ia`, worktree `/Users/afroboost/studiio-cinema-ia`, base
> `origin/main` (`02fedad`). Rien n'est pousse, rien n'est deploye, aucune
> table n'est creee, aucun fournisseur payant n'est actif.

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

## 2. Architecture

```
src/lib/cinema/
  types.ts        Film -- Scene[] -- PlanCinema[]  (+ dureeFilm, TAILLES)
  scenario.ts     histoire -> scenes (LOCAL, deterministe, sans reseau)
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

## 3. Couts

`FOURNISSEURS_VISUELS` declare les emplacements ; un seul est **actif** :
`cartes-remotion`, local, `0 USD/s`. Les autres ont `usdParSeconde: null` et
`actif: false` — et `devisFilm` rend alors un total **`null`**, affiche comme
« tarif non declare », jamais comme gratuit.

## 4. Gardes d'acces (revue de securite du 2026-10-26)

`/api/cinema/*` n'est PAS dans le `matcher` du middleware : chaque route
verifie donc elle-meme. `src/lib/cinema/acces.ts` tient les trois regles,
testees dans `src/__tests__/cinema-acces.test.ts` :

| Regle | Defaut evite | Verifie |
|---|---|---|
| Un film a un **proprietaire**, compare a la session sur GET, PATCH et `produire` ; la liste est filtree | IDOR : l'identifiant suffisait a lire, modifier et faire rendre le film d'autrui | 404 sur les trois routes, liste vide |
| Un identifiant suit `^film-[a-z0-9][a-z0-9-]{0,62}$`, a la lecture **comme a l'ecriture** | traversee de chemin (`../`) dans le magasin | 404, et `enregistrerFilm` leve |
| Un media de plan est un chemin **local** sous `cinema/` | SSRF : l'URL d'un plan est chargee par Chromium au rendu | 400 sur `http://169.254.169.254/...` |

Un film d'avant cette regle (sans proprietaire) n'appartient a personne : il
devient inaccessible plutot que public — l'un se repare, l'autre fuite.
L'echec de `produire` rend une reference courte ; le detail (stderr, chemins)
reste dans le journal du serveur.

## 5. Etat reel

**Fonctionnel et verifie** : decoupage, casting versionne, empreintes,
devis, chronologie, voix (moteur hors ligne sur ce poste), rendu scene par
scene, cache de scene, recollage, controle ffprobe, API REST, page du parcours.

**Simule / en place mais non prouve** : les visuels sont des **cartes de plan**
dessinees par Remotion, pas des images generees ; la coherence visuelle d'un
personnage en generation IA **n'a pas ete testee** et n'est pas promise ; la
persistance est un fichier JSON local, pas une table.

**A faire pour un vrai Studio Cinema IA** : voir le rapport de session.

## 6. Commandes

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

## 7. Mesures du 2026-10-26 (poste local, Apple Silicon)

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
