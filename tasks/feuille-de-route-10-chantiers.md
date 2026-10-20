# Feuille de route permanente — 10 chantiers (reçue le 2026-10-20)

Référence de suivi du projet Studiio. États : **TERMINÉ** (preuve fournie) /
**PARTIEL** / **NON FAIT** / **À TESTER** (code fusionné, pas encore vérifié en
conditions réelles). Ne jamais passer une ligne à TERMINÉ sans preuve (vidéo
réelle, ffprobe, capture ou test en production).

Règle absolue transverse : la qualité sonore actuelle est validée — ne pas
modifier le moteur audio, la voix clonée, les prononciations ni le mixage ;
jamais d'accélération de la voix pour tenir une durée.

| # | Chantier | État | Références | Reste à faire |
|---|----------|------|-----------|---------------|
| 1 | Créer : import universel, édition, séquences, frise, effets, aperçu/export, brouillons, avatar | PARTIEL | #543 multi-sources, #606 (avatar dans la liste, médias exclus signalés, vrai MP4, cartes animées), #605 | Fin d'export Créer (CTA/voix coupés sur banc local) à vérifier en vrai navigateur ; import universel et frise non revus |
| 2 | Autopilote : rushs analysés et utilisés, narration, réglages, génération récurrente, cohérence du sujet | À TESTER | #608 (alternance avatar/plans de coupe, filtre de sujet du stock, script calé sur la voix), #607 (aperçu du montage prévu = plan rendu), #584 A5, #433 jumeau cron | Tester une génération réelle avec rushs personnels ; calibrage du débit par compte (constante 0,76 aujourd'hui) |
| 3 | Intelligence narrative : storyboard, compréhension sémantique, dialogues, coupes et rythme | PARTIEL | #589 M2-a fiche de contenu, #591 M2-b analyse (éteinte), #592 M2-c pertinence (recommandation), #593–#595 M3-a passages (éteint, admin) | Brancher la pertinence sur la sélection ; storyboard non fait |
| 4 | Qualité cinématique : styles, transitions, typographie animée, sous-titres, LUT, effets | PARTIEL | #383 LUT (fermée, non fusionnée), Ken Burns photos, transitions existantes | LUT à reprendre ; sous-titres non revus |
| 5 | Avatar / voix / IA : jumeau, voix clonée, prononciation, médias IA, fiabilité, coûts | PARTIEL | #532 multi-avatars, #585 B1, #586 B2, #587 B3, #603, #605 (moteurs admin), #607 (étapes réelles de progression) | Progression à vérifier en production ; coûts HeyGen suivis |
| 6 | Bugs A3/A5/A6 et B1–B4 | PARTIEL | A3/A6 en prod (7158ae0), A5 #584, B1 #585, B2 #586, B3 #587 | B4 : statut non retrouvé dans le dépôt — à préciser ; parcours restants à vérifier |
| 7 | Calendrier / publication : parité vidéo, CTA, miniature, légende, hashtags, format, réseaux, horaires | À TESTER | #606 (MP4 durable `mp4Durable`, avis MP4 indisponible, plus de WebM brut), API Zernio | Vérifier MP4 + CTA + médias identiques dans le Calendrier sans publication réelle |
| 8 | Moteur vidéo commun : réutilisation, fiabilité, rendu pro | PARTIEL | #606, #608 (`alterner()` partagé, `planCompletAutopilote`), contrat de design canonique | Créer (compositeur navigateur) et Autopilote (Remotion) restent deux moteurs |
| 9 | Nettoyage : ancien éditeur avancé, liens obsolètes, sans perte de données | PARTIEL | Suppression creer-avance (7158ae0) | Liens obsolètes restants à recenser |
| 10 | UX / performance : design premium, interfaces simples, avatars, médias lourds, rapidité | PARTIEL | #607 (débordement audio, aperçu style ≠ montage réel), #598 limites de conversion | Débordement audio à vérifier visuellement |

## Points obligatoires avant le prochain GO de production (2026-10-20)

1. Fin de l'export Créer vérifiée dans un vrai navigateur (CTA et voix complets).
2. MP4 final, CTA et médias identiques dans le Calendrier, sans publication réelle.
3. Débordement audio vérifié visuellement.
