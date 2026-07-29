# Refonte — « Créer (simple) » comme page unique

> Cahier de référence validé par l'utilisateur le 2026-07-29. Sert de source de
> vérité pour la refonte. Ne rien perdre de ce qui suit.

## Vision (décision produit)

- **Créer (simple)** devient la **SEULE** page de création à terme. Inspiration : **Canva**.
- Créer (simple) est la **version améliorée** de Créer — pas une version réduite.
- **Créer** (l'ancienne, complète) est **gardée temporairement** uniquement comme
  référence, pour ne rien oublier. Elle sera retirée du menu une fois la parité atteinte.
- **Média** et **Bibliothèque** sont **rapatriées dans Créer** — plus d'entrées de menu séparées.
- **Règle absolue : aucune vidéo déformée, quel que soit le format** (9:16, 1:1, 16:9).
  L'aperçu comme l'export doivent respecter le ratio source.
- Icônes **SVG uniquement** (lucide), jamais d'emojis (déjà acté dans CLAUDE.md).

## Inventaire des fonctionnalités de Créer (à reprendre, en mieux)

Organisé selon les 7 onglets du menu latéral de Créer.

### 1. Modèles
- Templates par thème (fitness, santé, nutrition, …).
- Génération auto de 5 cartes (base de contenu locale `smart-content`).

### 2. Éléments
- Ajout d'éléments graphiques, logo, images, icônes SVG.

### 3. Texte
- Zones : Titre, Sous-titre, CTA principal, CTA sous-texte, Overlay (vidéo).
- Pour chaque zone : police (5 Google Fonts), taille, couleur, interlettrage,
  interligne, gras, italique.
- Icône de titre + icône de CTA (SVG).

### 4. Cartes
- Contenu par carte : icône SVG, titre, description, valeur.
- Icônes personnalisées.
- Mode **grille ↔ libre**.
- Réinitialiser les positions, distribuer vertical/horizontal.
- Grouper / dégrouper / dupliquer.

### 5. Médias  (← intègre l'actuelle page Média)
- Upload rush vidéo, overlay vidéo.
- Éditeur d'image : luminosité, contraste, saturation, température, filtres,
  upscale, retrait de fond, …
- **Détection des temps forts** (découpage auto de clips).

### 6. Audio
- Musique + voix TTS (14 voix), voix par séquence.
- Upload audio, volumes, preview temps réel.

### 7. Paramètres
- Format **9:16 / 1:1 / 16:9**.
- Couleurs accent / dégradé + opacité.
- Branding : logo (position, taille, opacité), watermark.

### Transversal
- **Séquences** (Titre, Cartes, Vidéo, CTA) : ordre modifiable, durées réglables,
  afficher/masquer, **Play montage auto**.
- **Aperçu** : panneaux flottants au double-clic, guides d'alignement, grille,
  annuler/refaire.
- **Export** : MP4 / JPG / PNG, vers **Calendrier** + **Bureau** (poster + rush + config JSON).
- **Agent IA** : génération auto de contenu 7 / 14 / 30 jours.
- **Bibliothèque** (← intègre l'actuelle page Bibliothèque) : vidéos finies —
  relire, télécharger, dupliquer, rééditer, partager, supprimer.

## Bugs connus à corriger dans la refonte
- Vignettes « temps forts » déformées : le canvas de vignette est fixé à 320×180
  (16:9) et étire la frame (`clip-detector.ts` l.91-93 + l.285). Le clip **extrait**
  garde le bon ratio (dimensions natives, l.332-333) — seul l'aperçu est en cause.
  → Calculer la taille de la vignette d'après le ratio de la source.

  Diagnostic **vérifié dans le code le 2026-07-29** :

  | Ligne | Code | Effet |
  |-------|------|-------|
  | 92-93 | `thumbCanvas.width = 320; thumbCanvas.height = 180;` | canvas figé en 16:9 |
  | 285 | `thumbCtx.drawImage(video, 0, 0, thumbCanvas.width, thumbCanvas.height)` | étire la frame source |
  | 332-333 | `canvas.width = video.videoWidth \|\| 1080;` | l'extraction, elle, garde le ratio natif |

  Conséquence concrète : un rush 9:16 apparaît écrasé dans la liste des temps
  forts alors que le fichier produit est correct. C'est le cas le plus visible
  de la **règle absolue « aucune vidéo déformée »** — la même vérification est
  à faire sur l'aperçu de la page et sur l'export.
