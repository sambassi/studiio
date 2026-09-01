# Note technique — Rushes portrait : divergence de géométrie M3-B → M3-F → M3-G → M3-H

**Statut : DOCUMENTÉ, NON CORRIGÉ.** Établi pendant H5, consigné pendant H5-C.
**Aucun changement M3-A → M3-G n'a été fait pour ce point.**
Correctif à traiter dans un lot séparé, après M3-H ou avant production si le cas
portrait est jugé indispensable.

---

## Le symptôme

Un rush filmé au téléphone en portrait produit un plan de montage que M3-H
**refuse**, avec le motif `plan_non_conforme`. Le refus survient après le
téléchargement de toutes les sources, et son motif accuse le plan alors que la
cause est en amont.

Aucun cadrage faux n'est jamais produit : M3-H refuse plutôt que de rendre de
travers. Mais pour une application dont le format nominal est le 9:16, un rush
portrait non rendable est un défaut de chaîne, pas un détail.

---

## Le scénario reproductible

1. Un rush `.mov`/`.mp4` de téléphone porte ses pixels en **1920×1080 codés**
   plus une **matrice d'affichage `rotate=90`**. C'est la forme normale : les
   capteurs enregistrent en paysage et décrivent la rotation en métadonnée.

2. **M3-B** sonde le rush. `extraction.ts:471` extrait bien la rotation
   (`rotation: rotationDepuisFlux(video)`, avec repli sur `tags` pour les
   vieilles versions de ffprobe, `extraction.ts:895-899`). `technique` porte
   donc `largeur: 1920`, `hauteur: 1080`, `rotation: 90`.

3. **M3-F** découpe le clip. `argumentsDecoupe` **ré-encode sans
   `-noautorotate`** — le drapeau n'apparaît nulle part dans le dépôt. ffmpeg
   applique donc l'autorotation : le clip produit est **physiquement 1080×1920**,
   et sa matrice d'affichage a disparu, absorbée dans les pixels.

4. **M3-G** calcule le plan. `geometrieDepuisTechnique` (`montage.ts:183-197`)
   lit `technique.largeur` et `technique.hauteur` et **ignore
   `technique.rotation`** : le plan porte `largeurSource: 1920`,
   `hauteurSource: 1080`, et son rectangle de recadrage est calculé sur cette
   géométrie-là.

5. **M3-H** sonde la source descendue et compare aux dimensions du plan
   (`rendu.ts`, garde des dimensions décodées). Il lit 1080×1920 là où le plan
   annonce 1920×1080 : les deux ne coïncident pas, le rendu est refusé en
   `plan_non_conforme`.

| Étape | Ce qui est connu | Valeur |
|---|---|---|
| Rush réel | pixels codés + matrice | 1920×1080, `rotate=90` |
| M3-B `technique` | mesuré, rotation comprise | `largeur 1920`, `hauteur 1080`, `rotation 90` |
| M3-F clip produit | ré-encodé, autorotation appliquée | **1080×1920**, sans matrice |
| M3-G plan | `largeurSource`/`hauteurSource` | **1920×1080** (rotation ignorée) |
| M3-H sonde | dimensions décodées du clip | **1080×1920** |
| M3-H verdict | comparaison | `plan_non_conforme` |

---

## Pourquoi la garde de M3-H est correcte, et pourquoi elle ne suffit pas

La garde a été ajoutée en H3 pour empêcher exactement le pire cas : appliquer
un rectangle calculé sur 1920×1080 à une image réellement 1080×1920. Mesuré
pendant H5 : un `crop=608:1080:656:0` sur une image 1080×1920 **ne fait pas
échouer ffmpeg** — il rabote `x` de 656 à 472 **sans un mot, code de sortie 0**,
et `scale` force ensuite la résolution cible. Le fichier passerait alors
`resolutionConforme`, `dureeConforme` et le contrôle de cadence : **un cadrage
faux, décalé de 184 pixels, serait déclaré conforme.**

La garde est donc l'unique filet — mais elle ne tient aujourd'hui que par un
**effet de bord** de M3-F : c'est parce que M3-F ré-encode en appliquant
l'autorotation que le clip et le plan divergent de façon détectable. Le jour où
M3-F copierait le flux (`-c copy`) ou poserait `-noautorotate`, le clip
conserverait sa matrice, la sonde lirait les dimensions **codées**, la garde
comparerait codé à codé, **passerait** — et le cadrage faux serait produit.

Vérifié pendant H5 : `ffprobe -show_entries stream=width,height` sur un fichier
à `rotate=90` rend les dimensions **codées** (1920×1080), pas les dimensions
décodées (1080×1920). Le commentaire de `sonderSource` qui affirme l'inverse est
donc inexact ; il ne l'est pas dans le pipeline actuel, où M3-F a déjà supprimé
la matrice, mais il repose sur une propriété qui n'est écrite nulle part.

---

## Le module qui devrait devenir l'autorité géométrique

**M3-G**, dans `geometrieDepuisTechnique`. C'est lui qui décide du rectangle ;
c'est donc lui qui doit décider sur la géométrie **telle qu'elle sera décodée**,
et non telle qu'elle est codée.

La donnée existe déjà : `technique.rotation` est mesurée par M3-B et jamais
lue. Le geste minimal est d'échanger largeur et hauteur quand la rotation vaut
90 ou 270, avant de calculer quoi que ce soit.

Deux garde-fous à poser dans le même lot :

1. **M3-F devrait figer son contrat d'orientation** — soit en documentant que
   le clip est toujours ré-encodé avec autorotation appliquée, soit en le
   rendant explicite. Aujourd'hui, la correction de M3-G dépend d'un
   comportement de M3-F qui n'est écrit nulle part.
2. **La garde de M3-H reste**, et son commentaire doit être rectifié : ce
   qu'elle compare, ce sont les dimensions **décodées telles que la sonde les
   voit après le ré-encodage de M3-F**, pas les dimensions décodées d'un rush
   quelconque.

## Ce qu'il ne faut pas faire

Relâcher la garde de M3-H pour « laisser passer » le portrait. Elle est le seul
point où la divergence devient visible ; sans elle, le défaut cesse d'être un
refus et devient un montage faux livré en silence.
