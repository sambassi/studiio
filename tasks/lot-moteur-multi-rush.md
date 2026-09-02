# Lot moteur — MULTI-RUSH (non implémenté)

> Rédigé le 2026-09-02 pendant P0-A/B/C. **Rien de ce document n'est codé.**
> Il existe pour que le futur lot parte d'un constat mesuré, pas d'une intuition.

---

## Ce que l'utilisateur veut

Deux modes, présentés comme un choix explicite :

```
Comment veux-tu créer ta vidéo ?

[ Un seul rush ]        [ Plusieurs rushes ]
```

**Mode 1 — un seul rush.** Exactement le parcours actuel. Il doit rester le
chemin le plus court, et **ne subir aucune régression**.

**Mode 2 — plusieurs rushes.** L'utilisateur coche les rushes d'une même
session, et Studiio construit **une seule** vidéo à partir des meilleurs
passages de l'ensemble.

```
☑ Rush caméra principale
☑ Rush téléphone
☑ Rush plan latéral
☐ Rush à ne pas utiliser
```

Règles attendues sur la sélection globale :

- pas deux passages très similaires ;
- pas de plage temporelle fortement répétée d'un même rush ;
- pas de surreprésentation d'un rush si de meilleures séquences existent
  ailleurs ;
- **aucune obligation d'utiliser tous les rushes** — un mauvais rush peut ne
  rien donner.

---

## Ce qui l'empêche aujourd'hui, structure par structure

Le pipeline est **mono-rush de bout en bout**, et ce n'est pas un réglage
d'interface : c'est écrit dans les tables et dans les identités.

| Étage | Structure | Ce qui bloque |
|---|---|---|
| M3-B | `rush_analyses.rush_id` | une analyse porte **un** rush |
| M3-C | `rush_candidate_sets.rush_id` | un jeu de passages porte **un** rush, et se demande par `POST /analyses/[id]/candidats` — donc par analyse, donc par rush |
| M3-E | `calerCoupes({ candidats, dureeRushSecondes })` | **une seule** durée de rush en entrée : les fenêtres sont calées contre un rush unique |
| M3-F | `rush_clip_sets.rush_id`, et `IdentiteSet` porte `candidateSetId` + `rushId` + `analysisId` | un jeu de clips vient d'**un** rush ; la clé de stockage d'un clip est `<userId>/<clipSetId>/rang-NN.mp4` |
| M3-G | `IdentitePlan` porte `clipSetId`, `candidateSetId`, `analysisId` — tous au singulier | un plan lit **un** jeu de clips ; `geometrieDepuisTechnique(analyse.technique)` lit **une** géométrie source, et le recadrage en découle |
| M3-H | `IdentiteRendu` = `montagePlanId` + version + méthode | rien à changer : le rendu concatène ce que le plan lui donne, quelle qu'en soit l'origine |

**Le verrou le plus dur n'est pas la base : c'est la géométrie.**
`planifierMontage` calcule **un** rectangle de recadrage à partir d'**une**
paire largeur/hauteur, et l'applique à tous les plans. Trois rushes de
formats différents (caméra 16:9, téléphone 9:16, plan latéral 4:3) demandent
un recadrage **par plan**, pas par montage.

---

## Le plus petit lot qui rende le mode 2 possible

Quatre changements, dans cet ordre. Aucun ne casse le mode 1.

### 1. Le recadrage descend au niveau du plan *(prérequis, et il vaut seul)*

`PlanMontage` porte **déjà** `largeurSource` / `hauteurSource` / `recadrage`
par plan — ils sont simplement tous remplis avec la même valeur aujourd'hui.
Il suffit que `planifierMontage` reçoive la géométrie **avec chaque clip**
plutôt qu'une fois pour toutes.

C'est un changement de signature, pas de structure de données. Il est
testable seul, et il n'a **aucun effet** sur un montage mono-rush : la même
géométrie pour tous les clips donne exactement le plan actuel.

### 2. Un jeu de clips multi-rush

`rush_clip_sets.rush_id` devient facultatif, et chaque entrée de `clips` porte
son propre `rushId` (le tableau `clips` est du JSON : **aucune migration de
colonne**, seulement un champ de plus dans les objets). L'identité du jeu
devient la **liste ordonnée** des jeux de candidats sources.

⚠️ La contrainte composite `rush_clip_sets_candidats_rush_proprietaire`
suppose un rush unique. C'est le seul endroit qui **exigera une migration**.

### 3. La sélection globale

Un module pur qui prend N jeux de candidats et rend une liste unique :

- fusion, puis tri par `scoreMontage` décroissant ;
- **`ecarterChevauchements` s'applique déjà** — il compare des fenêtres, il ne
  sait pas de quel rush elles viennent. Il faudra seulement le rendre
  conscient du rush : deux fenêtres identiques dans **deux rushes différents**
  ne sont pas un doublon.
- un plafond par rush, pour la non-surreprésentation, et **aucun plancher** :
  un rush peut ne rien donner.

Ce module est du calcul pur, donc testable sans base ni ffmpeg — comme
`coupe.ts` aujourd'hui.

### 4. Le choix dans l'écran

`SessionsTournagePanel` porte déjà la liste des rushes d'une session et leur
état. Il n'y manque que des cases à cocher et le choix de mode. **Le mode 1
reste le défaut** : un seul rush coché, c'est le parcours actuel, et le même
appel qu'aujourd'hui.

---

## Ce qu'il ne faut PAS faire

- **Ne pas fusionner les analyses.** Une analyse mesure un fichier ; trois
  rushes font trois analyses, et c'est correct.
- **Ne pas retirer le mode mono-rush.** Il reste le chemin rapide.
- **Ne pas toucher M3-H.** Le rendu concatène des clips ; leur provenance ne
  le regarde pas.
- **Ne pas commencer par la migration.** Le point 1 (recadrage par plan) est
  utile seul, se teste seul, et lève le vrai verrou.
