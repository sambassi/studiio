# Contrats produit — génération vidéo (Créer · Autopilote · Calendrier)

Un invariant = un bloc. Il dit ce que l'utilisateur doit TOUJOURS obtenir, pourquoi,
quel test le garde, et à quelle condition seulement on peut le rouvrir.
Registre des fonctionnalités verrouillées : `docs/FEATURE_LOCKS.md`.

## Règle avant toute modification de Créer, Autopilote ou Calendrier

1. **Lire** les contrats ci-dessous qui touchent la zone modifiée.
2. **Lancer** `npm run test:contracts` — noter le résultat.
3. **Modifier.**
4. **Relancer TOUS les contrats** (`npm run test:contracts`). Un contrat vert devenu
   rouge = STOP : on ne réécrit pas le test pour faire passer la CI ; on prouve le
   changement voulu et on obtient l'accord du propriétaire.

Les tests de contrat vivent dans `src/__tests__/contracts/*.contract.test.ts`.

---

## C-FORMAT — un projet a UN format, partout le même

```
ID=C-FORMAT
RÈGLE=
- Un projet vidéo a un format parmi 9:16, 1:1, 16:9 (`ProjectVideoFormat`,
  `src/lib/format/projet.ts`), défaut 9:16.
- Tout créateur de post l'écrit par `metadataFormat(f)` :
  metadata.videoFormat + metadata.videoSize + metadata.format (« reel » | « tv »),
  et la colonne `scheduled_posts.format` = formatRenduFacturation(f).
  Concerné : Créer (AssistantWizard), Autopilote cron (design.ts + engine.toPostRow),
  montage de rushes (rendu-passerelle.creerBrouillonPlanification, dimensions RÉELLES
  du fichier dans videoSize), post modifiable depuis la Bibliothèque (editable-post).
  EXCEPTION facturation : le montage de rushes n'écrit QUE videoFormat + videoSize ;
  sa colonne `format` reste absente (« reel » posé par /api/posts) et son
  metadata.format garde l'ancienne règle — aucun changement de prix par effet de bord.
- Tout lecteur passe par `formatDuPost` / `dimensionsDuPost` / `ratioCss` :
  priorité metadata.videoFormat > ratio de metadata.videoSize > metadata.format >
  colonne post.format (« reel » → 9:16, « tv » → 16:9) > défaut.
  Concerné : Calendrier (aperçu plein écran, lecteur du montage serveur, vignette,
  libellés), recomposition (options-depuis-metadata.montageSize), réouverture dans
  Créer (to-wizard), modification dans Créer (from-wizard : videoFormat suit videoSize).
- Une seule table de dimensions : `VIDEO_SIZE` de `src/lib/creer/designSpec.ts`.
- Facturation inchangée : 9:16 → « reel », 1:1 et 16:9 → « tv » (valeur envoyée au
  serveur de rendu, qui choisit le tarif).
- Aucun nouveau '9 / 16' ou 1080x1920 écrit en dur hors liste autorisée.
POURQUOI=
Le format vivait à quatre endroits contradictoires. Bug constaté : un montage de rushes
16:9 ou carré était posté sans colonne format (défaut « reel ») ni videoSize, et le
Calendrier le jouait dans un cadre 9:16. Un carré Créer était aussi libellé « 16:9 ».
TEST=src/__tests__/contracts/format.contract.test.ts
- « C-FORMAT — aller-retour écriture → lecture » (9:16, 1:1, 16:9 ; cadre Calendrier ;
  facturation inchangée ; défaut)
- « C-FORMAT — montage de rushes (passerelle) : le post porte le format RÉEL du montage »
  (dont « un montage 16:9 n'est JAMAIS joué dans un cadre 9:16 (bug Calendrier) »)
- « C-FORMAT — Autopilote (cron) : post 9:16 »
- « C-FORMAT — anciens posts : affichage identique à avant »
- « C-FORMAT — Créer en modification »
- « C-FORMAT — les lecteurs passent par le module »
- « C-FORMAT — aucun 9:16 codé en dur hors liste »
VALIDÉ_LE=2026-10-14 (tests ; pas encore de validation en production)
FACTURATION DU CARRÉ — comportement ACTUEL documenté (non modifié, décision séparée) :
- Créer, export : 1:1 → renderFormat « tv » envoyé à la réservation (`/api/render/jobs`),
  le serveur applique donc le tarif 16:9 ; l'écran Créer affiche pourtant le prix
  `render.reel` (9:16) pour le carré → écran et serveur divergent.
- Calendrier, régénération : prix lu sur la colonne (`formatRendu`) → carré Créer
  (colonne « tv ») au tarif 16:9 ; brouillon carré du montage de rushes (colonne
  « reel ») au tarif 9:16.
- Proposition à trancher par le propriétaire : un tarif explicite pour le carré (ou
  aligner l'écran sur le serveur). Rien n'est changé tant que ce n'est pas décidé.
ROUVRIR_SEULEMENT_SI=ajout d'un 4e format | décision de facturation explicite sur le
carré | la colonne scheduled_posts.format change de domaine
```

## C-CONTENT — le contenu choisi est le contenu rendu

```
ID=C-CONTENT
RÈGLE=Titre, sous-titre et les cartes (titre ET valeur, toutes) affichés dans l'aperçu
sont exactement ceux du montage et du post Calendrier ; aucune donnée choisie
(rush, musique, carte, CTA) n'est écartée en silence.
POURQUOI=Aperçu et Calendrier ont déjà divergé (sujet « Produire maintenant », cartes
perdues) : l'utilisateur publie autre chose que ce qu'il a vu.
TEST=src/__tests__/contracts/contenu.contract.test.ts (8 tests ; mutation sample.ts → rouge)
VALIDÉ_LE=2026-10-14 (contrat de test, preuve par mutation ; comportement déjà validé en production)
ROUVRIR_SEULEMENT_SI=crash | perte de données | régression majeure mesurable
```

## C-STYLE — le style choisi est le style rendu

```
ID=C-STYLE
RÈGLE=Le style d'aujourd'hui = le design courant (polices, couleurs, positions,
typographie, transition, animation de texte, LUT) : aperçu, montage et
recomposition Calendrier lisent le MÊME état (metadata.design + contrat canonique
postMetadata). Partie V2 (styles nommés / préréglages) : à compléter PR C.
POURQUOI=Une transformation appliquée seulement à l'export est une divergence garantie
(leçon 2026-10-12).
TEST=AUCUN test dédié aujourd'hui (le design courant est couvert indirectement par contenu.contract.test.ts) — partie V2 : à créer en PR C
VALIDÉ_LE=à compléter (PR C)
ROUVRIR_SEULEMENT_SI=PR C (styles V2) | régression majeure mesurable
```

## C-CTA — le CTA de l'utilisateur, complet, prioritaire

```
ID=C-CTA
RÈGLE=Le CTA du brief est rendu tel quel, sans troncature, dans l'aperçu, la vidéo et
le Calendrier ; jamais « LIEN EN BIO » à sa place ; aucun CTA inventé si
l'utilisateur n'en a pas. Même règle Créer et Autopilote.
POURQUOI=CTA appliqué seulement au rendu → vidéo ≠ écran (leçon 2026-10-12).
TEST=src/__tests__/contracts/cta.contract.test.tsx (4 tests ; metadata = drawCTA = Remotion = aperçu Créer)
VALIDÉ_LE=2026-10-14 (contrat de test, preuve par mutation ; comportement déjà validé en production)
ROUVRIR_SEULEMENT_SI=crash | régression majeure mesurable
```

## C-MEDIA-MANUAL — un média choisi à la main n'est jamais remplacé

```
ID=C-MEDIA-MANUAL
RÈGLE=Rush, photo, musique ou voix choisis par l'utilisateur sont ceux du montage ; un
média introuvable bloque l'envoi avec un message AVANT tout débit, jamais un
remplacement silencieux ; supprimer un post n'emporte pas la bibliothèque.
POURQUOI=Rush et musique disparus du montage sans message (leçon 2026-09-29).
TEST=src/__tests__/contracts/medias-manuels.contract.test.ts (7 verts + 2 it.fails BUG RÉEL : rush mort et média forcé remplacé non affichés à l'écran + 1 it.todo rushDuCreneau)
VALIDÉ_LE=2026-10-14 (contrat de test, preuve par mutation ; comportement déjà validé en production)
ROUVRIR_SEULEMENT_SI=perte de données | régression majeure mesurable
```

## C-PROGRESS — la progression dit la vérité

```
ID=C-PROGRESS
RÈGLE=Une progression ou un succès (« déposé », « publié ») ne s'affiche que sur une
preuve : identifiant de l'objet relu côté serveur ; un traitement asynchrone a son
état « en préparation » suivi jusqu'à la preuve.
POURQUOI=« Brouillon déposé » affiché, Calendrier vide (leçon 2026-10-13).
TEST=src/__tests__/contracts/progression.contract.test.tsx (5 tests)
VALIDÉ_LE=2026-10-14 (contrat de test, preuve par mutation ; comportement déjà validé en production)
ROUVRIR_SEULEMENT_SI=régression majeure mesurable
```

## C-COST — le coût affiché est le coût débité

```
ID=C-COST
RÈGLE=Le prix affiché vient de la grille centrale (tarifs_rendu) que débite le serveur ;
aucune opération payante sans crédit ; échec fournisseur = remboursement ; opération
payante lancée à la main par un admin = devis/garde 428 avant tout appel.
POURQUOI=Coûts fournisseur invisibles et écarts écran/serveur (leçons 2026-10-13).
TEST=src/__tests__/contracts/cout-fournisseur.contract.test.ts (4 verts + 1 it.fails BUG RÉEL : /api/voice/audio-complet admin sans garde 428)
VALIDÉ_LE=2026-10-14 (contrat de test, preuve par mutation ; comportement déjà validé en production)
ROUVRIR_SEULEMENT_SI=décision tarifaire explicite
```

## C-BARS — pas de bandes parasites

```
ID=C-BARS
RÈGLE=Aucune bande (noire ou claire) incrustée dans le montage final, en particulier
l'avatar en 9:16 ; le lecteur du Calendrier ne masque rien par CSS (object-contain
sur un cadre au ratio du fichier).
GARDE-FOU=Détection CONSERVATRICE (dans le doute, aucun recadrage), sur les deux
mesures (cropdetect noir ET bandes unies) : (b) fichier déjà au ratio demandé →
letterbox seul en vertical, pillarbox seul en horizontal ; (c2) chaque bande finit sur
un BORD DROIT (étendue de l'image ≥ 90 % de la ligne frontière, médiane des images).
Un 9:16 plein cadre sur fond uni (blanc, gris, noir), sujet touchant le haut et/ou le
bas, ou un sujet large / rond sur fond uni, n'est JAMAIS recadré.
Même tolérance de couleur (8) pour détecter la bande et pour vérifier son bord.
LIMITES ACCEPTÉES (règle « dans le doute, rien ») : vraies bandes noires autour d'une
image dont le bord est lui-même très sombre → bandes gardées ; vraie bande de la couleur
du fond de l'image, ou bruit fort → gardée ; une ligne droite pleine largeur (étagère,
bureau) sur fond uni, ou un buste à bords droits demandé en 16:9 / 1:1 / autre ratio que
le fichier, reste indiscernable d'un letterbox. La protection principale reste la requête
HeyGen `fit: cover` (#565).
POURQUOI=BUG 6 (#565) : bandes claires de l'avatar en 9:16. Faux positif constaté en
revue de release : 9:16 plein cadre sur fond de studio uni zoomé ≈ 2× (coupe 532×944) ;
matrice QA 22 fixtures : 5 faux positifs → 0, aucun nouveau faux négatif.
TEST=src/__tests__/contracts/bandes-avatar.contract.test.ts (10 tests) — voir aussi src/__tests__/bug6-avatar-bandes-claires-9-16.test.ts et src/__tests__/avatar-bandes-faux-positif.test.ts (règles pures + vraie chaîne ffmpeg)
VALIDÉ_LE=2026-10-14 (contrat de test, preuve par mutation ; fusionné dans main via #564/#565, PAS ENCORE DÉPLOYÉ en production)
ROUVRIR_SEULEMENT_SI=régression majeure mesurable
```

## C-PLAYER — un seul lecteur, lisible

```
ID=C-PLAYER
RÈGLE=Un seul lecteur Studiio (« Audio complet »), jamais un lecteur natif blanc ; la
vidéo démarre en muet (autoplay) et l'utilisateur rétablit le son.
POURQUOI=Lecteur blanc signalé deux fois (#564, leçon 2026-10-13).
TEST=src/__tests__/contracts/lecteur-voix.contract.test.tsx (3 tests)
VALIDÉ_LE=2026-10-14 (contrat de test, preuve par mutation ; fusionné dans main via #564/#565, PAS ENCORE DÉPLOYÉ en production)
ROUVRIR_SEULEMENT_SI=régression majeure mesurable
```

## C-PRONUNCIATION — la prononciation demandée est appliquée

```
ID=C-PRONUNCIATION
RÈGLE=Une correction de prononciation produit un texte différent de l'original et
c'est elle qui part à la synthèse ; jamais une « suggestion » identique au texte.
POURQUOI=« Suggérer » recopiait le texte (#564).
TEST=src/__tests__/contracts/prononciation.contract.test.ts (13 tests)
VALIDÉ_LE=2026-10-14 (contrat de test, preuve par mutation ; fusionné dans main via #564/#565, PAS ENCORE DÉPLOYÉ en production)
ROUVRIR_SEULEMENT_SI=régression majeure mesurable
```

## C-DUREE — la durée cible s'applique sur chaque chemin

```
ID=C-DUREE
RÈGLE=La durée cible est une fonction pure partagée écran + moteur (duree-cible.ts),
appliquée sur CHAQUE chemin (avatar, multi-sources, smart montage, mono-rush) ;
un raccourcissement est annoncé.
POURQUOI=Réglage appliqué à une seule branche (leçon 2026-10-13).
TEST=src/__tests__/contracts/duree.contract.test.ts (7 tests)
VALIDÉ_LE=2026-10-14 (contrat de test, preuve par mutation ; comportement déjà validé en production)
ROUVRIR_SEULEMENT_SI=régression majeure mesurable
```

## C-THEME — le thème choisi n'est jamais remplacé

```
ID=C-THEME
RÈGLE=Le thème choisi (et le contenu qui en découle, affiche comprise) est celui du
rendu ; un repli générique n'impose jamais un autre thème (ex. « fitness »).
POURQUOI=Affiche Finance retombée sur « fitness » par repli (leçon 2026-10-13).
TEST=src/__tests__/contracts/theme.contract.test.ts (16 tests)
VALIDÉ_LE=2026-10-14 (contrat de test, preuve par mutation ; comportement déjà validé en production)
ROUVRIR_SEULEMENT_SI=régression majeure mesurable
```

## SPEC DE RENDU CANONIQUE (A2.1) — branchée sur renderCreerSimple (A2.2)

```
ID=SPEC-RENDU (A2.1)
QUOI=src/lib/render/spec-rendu.ts — module feuille PUR (aucun React / réseau / base /
facturation). `SpecRendu` = `CreerSimpleRenderInput` + les champs que Remotion accepte
sans qu'ils y soient déclarés (subtitleColor, ctaColor, ctaSubColor, ctaBackground).
`versEntreeRemotion(spec)` = EXACTEMENT les props que `renderCreerSimple` confie au worker
(étalement, défauts 4/6/0/4, cards ?? []). `planDeRendu(spec)` = la ligne de temps
(buildSequences, images à 30 i/s, raccords, dimensions = VIDEO_SIZE[format], repli 9:16).
SENS=watermark = TEXTE du filigrane Remotion (le booléen « plan gratuit » du compositeur
est HORS spec) ; ctaText = CTA principal (compositeur : design.ctaMainText || watermarkText) ;
ctaSubText absent ≠ '' (absent → « LIEN EN BIO » par défaut Remotion) ; format = format
visuel, jamais reel/tv (facturation hors spec).
ÉTAT=BRANCHÉ sur renderCreerSimple (A2.2) : `inputProps = versEntreeRemotion(d)`, sortie
identique à l'ancien calcul (oracle gelé). Le bloc buildSequences / totalDurationFrames de
renderCreerSimple est conservé tel quel. NON branchés : compositeur navigateur, api/render ;
le chemin HYBRID reste hors spec. Aucun rendu ne change.
ÉCARTS CONNUS (rendus par le compositeur, pas par Remotion) : logoUrl, siteText, rushLut,
titleIcon*, extraTitle, habillageVideo, posterTransform/rushTransforms,
sequenceTransitions, rushAudioRequis, ducking du jumeau (`CORRESPONDANCE_COMPOSITEUR`).
TEST=src/__tests__/contracts/spec-rendu-parite.contract.test.ts (toStrictEqual contre les
inputProps réels, fixtures Autopilote A/D/E/F/G/H/J + specs 9:16 / 1:1 / 16:9 — devenu
partiellement tautologique depuis A2.2) ;
src/__tests__/contracts/spec-rendu-branchement.contract.test.ts (A2.2 : props worker
toStrictEqual l'oracle gelé `inputPropsHistoriques`, même ordre de clés, durée, séquences,
dimensions ; fixtures A/D/E/F/G/H/J + avatar+rush, 1:1, 16:9, ctaSubText '', média absent /
invalide, transitions, ancienne metadata ; test source du branchement)
```

## RENDU SERVEUR D'UNE TENTATIVE (A2.3) — derrière un interrupteur, éteint par défaut

```
ID=RENDU-SERVEUR (A2.3)
ROUTE=POST|GET /api/render/jobs/[id]/serveur (src/app/api/render/jobs/[id]/serveur/route.ts),
logique dans src/lib/render/moteur-export-serveur.ts. POST { spec } → 202, le rendu
continue derrière la réponse ; GET → { etat, enCours }.
FLAG=MOTEUR_EXPORT_SERVEUR === 'true' (exactement, relu à chaque appel). Absent / autre
valeur → 404 { ok:false } AVANT toute lecture (ni session ni base).
ACCÈS=administrateurs seulement (isAdmin) ; sans session ou tout autre compte → même 404
neutre { ok:false } que le flag éteint.
Propriété par lireRendu (404), état reserved obligatoire (409 sinon : un job confirmé,
annulé ou échoué ne se rend plus), opération apercu|bureau|calendrier (403 sinon).
SPEC=corps ≤ 256 Ko (Content-Length vérifié en amont, puis req.body lu EN FLUX et coupé dès le
plafond, 413) ; liste blanche des clés PROPRES de
SpecRendu + types de base, title et format visuel obligatoires (422). Parcours profond :
tout champ média (*Url, *Urls.*, sequenceBackgrounds.*, rushs[].url, montage[].url) = null
ou une CHAÎNE URL http(s) CANONIQUE — jamais un tableau / objet / nombre (Remotion stringifierait
un tableau) ; cartes *Urls / sequenceBackgrounds = objet plat de chaînes | null, *Urls en
tableau = chaînes seulement — (new URL(v).href === v, sans blanc, sans \, sans // initial) sinon
422 media_invalide ; toute couleur (*Color, *Background, gradientStart/End, elements[].color)
= #RGB/#RRGGBB/#RRGGBBAA ou rgb(a) stricts sinon 422 couleur_invalide ; bornes : durées
0..120 s, cards ≤ 20, rushs ≤ 10, elements ≤ 50, montage ≤ 100, autres listes ≤ 200,
textes ≤ 2000, profondeur ≤ 8. Format FACTURÉ = rendus.format de la ligne ; formatRenduFacturation(
spec.format) différent → 422. Aucun nouveau mapper : la spec part dans renderCreerSimple
→ versEntreeRemotion. Aucune réservation, aucun tarif ici.
CONFIRMATION=la même porte que le navigateur : src/lib/rendus/confirmation.ts
(confirmerAvecPreuve, extraite de /confirm, comportement figé par
rendu-confirm-caracterisation.contract.test.ts). Objet invalide / rendu échoué /
téléversement échoué / délai dépassé / solde insuffisant → cloreRendu failed ; stockage
injoignable → laissé reserved ; confirmation interrompue → aucun réessai, re-confirmable
par /confirm (dejaConfirme). État changé pendant le rendu → ni upload ni confirmation.
CAPACITÉ=une place en processus (compteur séparé de l'Autopilote) + Set des jobs en cours :
même job → 409 deja_en_cours, autre job → 429. Un renderVideo étranger en cours
(rendusRemotionActifs() > 0, compteur PASSIF de worker.ts : il ne refuse rien) → 429 aussi.
L'Autopilote ne lit pas ce compteur : A2.3 ne le bloque jamais (le rendu hybride ffmpeg de
l'Autopilote n'y est pas compté). Retry-After = reste du budget du job + 30 s de marge.
La ligne est relue APRÈS la prise de place et au début du travail (non reserved → 409 /
aucun rendu).
DÉLAI=600 s. À l'échéance : cloreRendu failed delai_depasse IMMÉDIATEMENT (même si
localisation / bundle / selectComposition n'ont pas rendu la main) + ordre d'annulation
Remotion (renderMedia.cancelSignal, optionnel dans worker/creerSimple, absent = comportement
d'avant). renderMedia rejette par course, le nettoyage Chromium/ffmpeg continue quelques
secondes ; la place reste prise jusqu'à ce que la promesse du travail rende la main. Un
travail fini après l'échéance ne téléverse ni ne confirme rien.
FENÊTRE CONNUE (P2)=entre la relecture reserved et la fin du téléversement, une confirmation
concurrente ou une annulation peut survenir : objet écrasé après confirmation, ou orphelin
après annulation. Jamais de débit indu (RPC idempotente). Pas de correctif sans état durable.
LIMITES=verrou en processus seulement (conteneur unique — deux conteneurs ne se voient pas) ;
la clé rendus est en .webm mais contient du MP4 (point A2.4) ; pas de convertisseur
ComposerOptions → SpecRendu (A2.4) ; localiserEntreesRendu ne couvre pas surimpressions ni
ctaCopies → ces clés sont refusées.
TEST=src/__tests__/contracts/rendu-serveur-flag.contract.test.ts ;
src/__tests__/contracts/rendu-worker-occupation.contract.test.ts (options Remotion = 1a1a044) ;
src/__tests__/contracts/rendu-serveur-isolement.contract.test.ts (aucun parcours branché) ;
src/__tests__/contracts/rendu-confirm-caracterisation.contract.test.ts
```
