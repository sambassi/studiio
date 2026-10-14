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
TEST=à venir (QA)
VALIDÉ_LE=à compléter
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
TEST=à venir (QA) — partie V2 : à compléter PR C
VALIDÉ_LE=à compléter
ROUVRIR_SEULEMENT_SI=PR C (styles V2) | régression majeure mesurable
```

## C-CTA — le CTA de l'utilisateur, complet, prioritaire

```
ID=C-CTA
RÈGLE=Le CTA du brief est rendu tel quel, sans troncature, dans l'aperçu, la vidéo et
le Calendrier ; jamais « LIEN EN BIO » à sa place ; aucun CTA inventé si
l'utilisateur n'en a pas. Même règle Créer et Autopilote.
POURQUOI=CTA appliqué seulement au rendu → vidéo ≠ écran (leçon 2026-10-12).
TEST=à venir (QA) — voir aussi src/__tests__/contracts/autopilot.contract.test.ts
VALIDÉ_LE=à compléter
ROUVRIR_SEULEMENT_SI=crash | régression majeure mesurable
```

## C-MEDIA-MANUAL — un média choisi à la main n'est jamais remplacé

```
ID=C-MEDIA-MANUAL
RÈGLE=Rush, photo, musique ou voix choisis par l'utilisateur sont ceux du montage ; un
média introuvable bloque l'envoi avec un message AVANT tout débit, jamais un
remplacement silencieux ; supprimer un post n'emporte pas la bibliothèque.
POURQUOI=Rush et musique disparus du montage sans message (leçon 2026-09-29).
TEST=à venir (QA)
VALIDÉ_LE=à compléter
ROUVRIR_SEULEMENT_SI=perte de données | régression majeure mesurable
```

## C-PROGRESS — la progression dit la vérité

```
ID=C-PROGRESS
RÈGLE=Une progression ou un succès (« déposé », « publié ») ne s'affiche que sur une
preuve : identifiant de l'objet relu côté serveur ; un traitement asynchrone a son
état « en préparation » suivi jusqu'à la preuve.
POURQUOI=« Brouillon déposé » affiché, Calendrier vide (leçon 2026-10-13).
TEST=à venir (QA)
VALIDÉ_LE=à compléter
ROUVRIR_SEULEMENT_SI=régression majeure mesurable
```

## C-COST — le coût affiché est le coût débité

```
ID=C-COST
RÈGLE=Le prix affiché vient de la grille centrale (tarifs_rendu) que débite le serveur ;
aucune opération payante sans crédit ; échec fournisseur = remboursement ; opération
payante lancée à la main par un admin = devis/garde 428 avant tout appel.
POURQUOI=Coûts fournisseur invisibles et écarts écran/serveur (leçons 2026-10-13).
TEST=à venir (QA)
VALIDÉ_LE=à compléter
ROUVRIR_SEULEMENT_SI=décision tarifaire explicite
```

## C-BARS — pas de bandes parasites

```
ID=C-BARS
RÈGLE=Aucune bande (noire ou claire) incrustée dans le montage final, en particulier
l'avatar en 9:16 ; le lecteur du Calendrier ne masque rien par CSS (object-contain
sur un cadre au ratio du fichier).
POURQUOI=BUG 6 (#565) : bandes claires de l'avatar en 9:16.
TEST=à venir (QA) — voir src/__tests__/bug6-avatar-bandes-claires-9-16.test.ts
VALIDÉ_LE=à compléter
ROUVRIR_SEULEMENT_SI=régression majeure mesurable
```

## C-PLAYER — un seul lecteur, lisible

```
ID=C-PLAYER
RÈGLE=Un seul lecteur Studiio (« Audio complet »), jamais un lecteur natif blanc ; la
vidéo démarre en muet (autoplay) et l'utilisateur rétablit le son.
POURQUOI=Lecteur blanc signalé deux fois (#564, leçon 2026-10-13).
TEST=à venir (QA)
VALIDÉ_LE=à compléter
ROUVRIR_SEULEMENT_SI=régression majeure mesurable
```

## C-PRONUNCIATION — la prononciation demandée est appliquée

```
ID=C-PRONUNCIATION
RÈGLE=Une correction de prononciation produit un texte différent de l'original et
c'est elle qui part à la synthèse ; jamais une « suggestion » identique au texte.
POURQUOI=« Suggérer » recopiait le texte (#564).
TEST=à venir (QA)
VALIDÉ_LE=à compléter
ROUVRIR_SEULEMENT_SI=régression majeure mesurable
```

## C-DUREE — la durée cible s'applique sur chaque chemin

```
ID=C-DUREE
RÈGLE=La durée cible est une fonction pure partagée écran + moteur (duree-cible.ts),
appliquée sur CHAQUE chemin (avatar, multi-sources, smart montage, mono-rush) ;
un raccourcissement est annoncé.
POURQUOI=Réglage appliqué à une seule branche (leçon 2026-10-13).
TEST=à venir (QA)
VALIDÉ_LE=à compléter
ROUVRIR_SEULEMENT_SI=régression majeure mesurable
```

## C-THEME — le thème choisi n'est jamais remplacé

```
ID=C-THEME
RÈGLE=Le thème choisi (et le contenu qui en découle, affiche comprise) est celui du
rendu ; un repli générique n'impose jamais un autre thème (ex. « fitness »).
POURQUOI=Affiche Finance retombée sur « fitness » par repli (leçon 2026-10-13).
TEST=à venir (QA)
VALIDÉ_LE=à compléter
ROUVRIR_SEULEMENT_SI=régression majeure mesurable
```
