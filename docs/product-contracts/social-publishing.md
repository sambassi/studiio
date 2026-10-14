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
accord). Les six bugs (1-6) sont CORRIGÉS par la PR Social Safety : leurs tests
sont redevenus des `it` normaux (« CORRIGÉ »).

---

## C-SOCIAL-PUBLISHING — post préparé = post Calendrier = post envoyé

```
ID=C-SOCIAL-PUBLISHING
RÈGLE=Seuls les réseaux demandés ET connectés sont ciblés, chacun avec son compte ;
la vidéo envoyée est celle du post (jamais le rush brut) ; ce qui part correspond
exactement à la ligne du Calendrier.
TEST=src/__tests__/contracts/social-publishing.contract.test.ts (cas A, E, I)
BUG (5) CORRIGÉ (fix/social-safety-social-a)=post mixte Instagram + E-mail : l'e-mail
ne partait jamais (`continue` sur le chemin Zernio). Désormais, APRÈS les réseaux
Zernio (y compris quand Zernio refuse ou qu'aucun compte n'est connecté), le canal
E-mail part par `envoyerCanalEmail` — la logique exacte de l'ancien chemin (opt-in
réservé au détenteur, `filterSuppressed` / `isSuppressed`, envoi via `sendEmail`).
Idempotence propre au canal, `metadata.canalEmail.etat` : `en_cours` écrit AVANT
l'envoi (écriture impossible → rien ne part), `envoye` → jamais renvoyé (cron suivant,
« Réessayer »), `echec` (rien n'est parti) → retenté au passage suivant. Un passage
interrompu après `en_cours` ne renvoie jamais : un e-mail manquant plutôt qu'un double.
Chaque écriture relit `metadata` juste avant et ne change QUE `canalEmail` ; relecture
impossible → aucune écriture (jamais de copie périmée qui ressusciterait une preuve
retirée par `post.failed` ou effacerait `zernioPartiel`). Fenêtre résiduelle de
quelques ms entre relecture et update (pas de jsonb_set sans migration).
Post E-mail seul et post Zernio seul : inchangés.
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
bloqués (> 10 min) ne remet jamais en « scheduled » un post qui a une preuve d'envoi
NI un marqueur de tentative.
RÈGLE (tentative)=Avant createPost, `metadata.zernioTentative = { cle, pour, le }` est
écrit (échec d'écriture → aucun envoi). `cle` part en en-tête `Idempotency-Key`
(Zernio rend le post original pendant 24 h, docs.zernio.com/guides/idempotency).
Une tentative sans preuve = PUBLISHED_BUT_CONFIRMATION_LOST : jamais de renvoi à
l'aveugle ; « Réessayer » interroge d'abord Zernio (GET /v1/posts filtré par compte
et date, comparaison de metadata.studiioPostId) :
trouvé → preuve écrite, aucun envoi (published / publishing / partiel selon Zernio) ;
trouvé en échec → nouvel envoi, nouvelle clé ; absent et clé < 23 h → envoi avec la
MÊME clé ; recherche en erreur ou clé > 23 h → `failed` + `confirmationRequise`, et
seul un « Réessayer » CONFIRMÉ par l'utilisateur (`publierSansVerification`) republie.
Refus net de Zernio (4xx hors 408/409) = FAILED_BEFORE_PUBLISH : marqueur retiré.
Renvoi sans couverture (400/422 sur la couverture) : clé DÉRIVÉE `<cle>:sans-couverture`
(corps différent), notée `zernioTentative.cleSansCouverture` AVANT le renvoi ; un
« Réessayer » repasse directement par elle.
Le statut du post RENDU par createPost compte (rejeu de clé = post original, 207) :
failed/cancelled → `failed`, preuve et marqueur retirés ; partial → état partiel ;
published → `published` ; sinon `publishing` jusqu'au webhook.
`publierSansVerification` est à usage unique : retiré à l'écriture du marqueur et à
toute écriture d'échec du cron.
Limite connue : la doc list-posts ne dit pas explicitement que chaque élément porte
`metadata` (le schéma Post l'a ; GET /v1/posts/{id} le rend). S'il manquait, la
recherche ne trouverait rien : < 23 h la clé d'idempotence reste la barrière, au-delà
confirmation explicite (fail-closed).
TEST=src/__tests__/contracts/social-no-duplicate.contract.test.ts (cas G, H, CORRIGÉ 1-4)
     src/__tests__/contracts/social-confirmation-perdue.contract.test.ts (cas limites)
CORRIGÉ (PR Social Safety, 2026-10-14)=
1. Échec d'écriture de la preuve après createPost réussi → était remis en « scheduled »
   après 10 min → REPUBLIÉ. Désormais : `{ error }` vérifié + 1 nouvel essai ; sinon le
   reset met le post en `failed` + `confirmationPerdue` (message « Confirmation perdue »).
2. Délai dépassé de createPost → « Réessayer » publiait une 2e fois. Désormais :
   erreur ambiguë après envoi (délai, coupure, 5xx, 408, 409) = confirmation perdue,
   marqueur gardé, vérification Zernio avant tout renvoi.
3. Écriture inconditionnelle de « publishing » qui écrasait un « published » posé par
   un webhook précoce. Désormais conditionnée à `status = 'publishing'` (l'écriture
   `failed` aussi).
4. Webhook post.partial puis « Réessayer » → bloqué en « publishing » sans message.
   Désormais : `zernioPartiel` + `zernioResultatsReseaux` (par réseau) en metadata ;
   « Réessayer » finit en `failed` explicite (réseaux en échec listés ; pour eux :
   Dupliquer en ne gardant que ces réseaux). Pas de renvoi partiel automatique.
VALIDÉ_LE=2026-10-14
ROUVRIR_SEULEMENT_SI=changement de fournisseur ou du modèle preuve / tentative
```

## C-SOCIAL-WEBHOOK-ENVELOPPE — le webhook lit l'enveloppe documentée par Zernio

```
ID=C-SOCIAL-WEBHOOK-ENVELOPPE
RÈGLE=Événement PÉRIMÉ OU REJOUÉ ignoré : si l'événement porte `post.id` et que le post
a une preuve d'envoi VALIDE (`zernioForPostId` = ce post) dont `zernioPostId` diffère, rien n'est écrit (un ancien
`post.failed` redélivré n'efface jamais la preuve d'un nouvel envoi). Sans `post.id`
(ancienne forme), sans preuve, ou preuve d'un autre post (copie « Dupliquer ») :
comportement inchangé.
RÈGLE=Le webhook accepte l'enveloppe DOCUMENTÉE (OpenAPI Zernio) : événements post
`{ id, event, post: { id, status, platforms[], metadata }, timestamp }` — le post
Studiio est retrouvé par `post.metadata.studiioPostId` (écho de la metadata de
création, changelog Zernio 2026-07-09) ; événements compte `{ id, event, account:
{ accountId, profileId, platform, username }, timestamp }`. L'ancienne forme
`{ event, data: {...} }` reste acceptée en repli. Inchangés : HMAC sur le corps BRUT
avant tout parsing, 503 sans secret, 401 signature absente/invalide, 200 même si le
traitement échoue, recherche par `studiioPostId` seulement (absent → aucune
écriture), événement inconnu → 200 sans écriture, relecture-fusion de metadata,
post.failed retire la preuve, post.partial la garde.
TEST=src/__tests__/contracts/social-webhook-enveloppe.contract.test.ts
BUG CORRIGÉ (fix/social-safety)=le webhook lisait `data.metadata` et `data.accountId`
— une enveloppe jamais documentée, inventée par nos fixtures : tout vrai événement
Zernio était acquitté 200 et ignoré (posts bloqués à `publishing`, déconnexions de
comptes jamais enregistrées).
VALIDÉ_LE=2026-10-14
ROUVRIR_SEULEMENT_SI=Zernio change le schéma `WebhookPayloadPost` / `WebhookPayloadAccount*`
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
BUG (6) CORRIGÉ (fix/social-safety-social-a)=rendu déjà mixé + hasAudio + musicUrl était
remuxé avec `-map 0:v:0 -map 1:a:0 -shortest` (piste mixée remplacée par la musique
brute, vidéo raccourcie). Désormais (hasAudio + musicUrl/voiceUrl), ffprobe sonde la
vidéo — montage composé ou non — et décide SEUL : piste audio présente → l'URL
d'origine part telle quelle (octets identiques, rien réécrit) ; ffprobe absent ou en
échec → tel quel (défaut sûr : au pire sans musique, jamais une piste écrasée) ;
vidéo MUETTE → musique/voix intégrées comme avant. Pas de raccourci sur
`renderedVideoUrl` : quand le chargement du son échoue, le compositeur retombe en mode
rapide SANS piste audio alors que hasAudio + musicUrl sont écrits — ces montages
gardent leur musique. Même règle sur l'ancien chemin (post E-mail seul).
VALIDÉ_LE=2026-10-14
ROUVRIR_SEULEMENT_SI=un nouvel écrivain pose musicUrl/voiceUrl à intégrer côté serveur
```
