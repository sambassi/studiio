# Contrats produit — publication réseaux sociaux et planification

La publication et la planification FONCTIONNENT en production. Ce document les
**protège** ; il n'autorise aucune réécriture. Toute modification de
`src/app/api/cron/publish/*`, `src/lib/social/*`, Zernio ou du webhook Zernio exige :
une preuve qu'un changement est nécessaire, l'accord du propriétaire, et
`npm run test:contracts` vert avant ET après.

Chemin réel vérifié (audit lecture seule, main bfc6b3f, 2026-10-14) :
Calendrier / Créer / Autopilote → `scheduled_posts` (DATE + TIME locales,
`metadata.timezone`, défaut Europe/Paris) → `GET /api/cron/publish` (chaque minute)
→ prise atomique `scheduled → publishing` → `publierViaZernio` → Zernio
`uploadMedia` + `createPost` → webhook Zernio. Zernio est le SEUL fournisseur actif
pour Instagram, Facebook, TikTok, YouTube.

Tous les tests sont **mockés** (Zernio, base en mémoire, stockage, ffmpeg, e-mail,
`fetch` qui lève s'il est appelé) : aucune publication réelle.

Les cas marqués `it.fails` documentent un **BUG RÉEL** démontré : la suite reste verte,
et le test devient rouge le jour où le bug est corrigé (il faudra alors retirer `.fails`).
Ces bugs ne sont PAS corrigés dans la PR A (règle : ne pas toucher la publication sans
accord).

---

## C-SOCIAL-PUBLISHING — post préparé = post Calendrier = post envoyé

```
ID=C-SOCIAL-PUBLISHING
RÈGLE=Seuls les réseaux demandés ET connectés sont ciblés, chacun avec son compte ;
la vidéo envoyée est celle du post (jamais le rush brut) ; ce qui part correspond
exactement à la ligne du Calendrier.
TEST=src/__tests__/contracts/social-publishing.contract.test.ts (cas A, E, I)
BUG RÉEL (it.fails)=post mixte Instagram + E-mail : l'e-mail ne part jamais
(route.ts : `continue` sur le chemin Zernio).
VALIDÉ_LE=2026-10-14 (contrat de test, preuves par mutation)
ROUVRIR_SEULEMENT_SI=changement de fournisseur décidé par le propriétaire
```

## C-SOCIAL-TEXT — la légende envoyée est la légende saisie

```
ID=C-SOCIAL-TEXT
RÈGLE=content = caption tel quel ; à défaut le titre ; sinon ''. Aucun texte ancien.
Les hashtags ne sont ni stockés ni ajoutés aujourd'hui (comportement actuel, à
décider séparément).
TEST=src/__tests__/contracts/social-publishing.contract.test.ts (cas F)
VALIDÉ_LE=2026-10-14
ROUVRIR_SEULEMENT_SI=décision produit sur les hashtags
```

## C-SCHEDULING + C-SOCIAL-TIMEZONE — date, heure, fuseau identiques jusqu'au réseau

```
ID=C-SCHEDULING / C-SOCIAL-TIMEZONE
RÈGLE=Un post à 18:30 Europe/Paris ne part ni à 17:29 ni à 18:29 (heure locale) et part
à 18:30 ; jamais la veille ni le lendemain ; changements d'heure (29/03, 25/10) gérés ;
un autre fuseau (America/New_York) est respecté ; fuseau absent ou invalide → Paris ;
un brouillon ne part jamais, même avec ?force=true.
TEST=src/__tests__/contracts/social-scheduling.contract.test.ts (cas B, C, D)
VALIDÉ_LE=2026-10-14
ROUVRIR_SEULEMENT_SI=changement du stockage date/heure décidé par le propriétaire
```

## C-NO-DUPLICATE-PUBLISH — une publication logique = une publication réseau

```
ID=C-NO-DUPLICATE-PUBLISH
RÈGLE=Deux passages du cron, 2–3 crons simultanés, webhook déjà reçu, reprogrammation
d'un post déjà prouvé : un seul uploadMedia / createPost. La remise à zéro des posts
bloqués (> 10 min) ne remet jamais en « scheduled » un post qui a une preuve d'envoi.
TEST=src/__tests__/contracts/social-no-duplicate.contract.test.ts (cas G, H)
BUG RÉEL (it.fails)=
1. Échec d'écriture de la preuve après createPost réussi → remis en « scheduled »
   après 10 min → REPUBLIÉ automatiquement.
2. Délai dépassé de createPost → « failed » sans preuve → « Réessayer » publie une
   2e fois (pas de distinction FAILED_BEFORE_PUBLISH / PUBLISHED_BUT_CONFIRMATION_LOST).
3. Écriture inconditionnelle de « publishing » qui écrase un « published » posé par un
   webhook arrivé tôt.
4. Webhook post.partial puis « Réessayer » → bloqué en « publishing » sans message.
VALIDÉ_LE=2026-10-14
ROUVRIR_SEULEMENT_SI=correction des bugs ci-dessus (PR dédiée, accord du propriétaire)
```

## C-SOCIAL-MEDIA-FILE — le fichier envoyé est le fichier du post, au bon format

```
ID=C-SOCIAL-MEDIA-FILE
RÈGLE=MP4 9:16, 1:1, 16:9 : la même URL est transmise à uploadMedia, octets identiques,
aucun téléchargement ni conversion (cas J, K, L). media_url prime sur renderedVideoUrl
(comportement actuel). WebM : converti en MP4 en gardant le ratio (boîte max 1080×1920,
donc un 16:9 sort réduit) ; échec de conversion → refus, rien n'est envoyé. GIF refusé.
TEST=src/__tests__/contracts/social-media-file.contract.test.ts
     src/__tests__/contracts/social-media-bytes.contract.test.ts
BUG RÉEL (it.fails)=rendu déjà mixé + hasAudio + musicUrl → remuxé avec
`-map 0:v:0 -map 1:a:0 -shortest` : la piste mixée (voix, son du rush, ducking) est
remplacée par la musique brute et la vidéo peut être raccourcie.
VALIDÉ_LE=2026-10-14
ROUVRIR_SEULEMENT_SI=correction du remux (PR dédiée, accord du propriétaire)
```
