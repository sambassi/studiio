# Banc de montage — comparer les montages sur de vrais rushs

But : savoir si les montages d'Autopilote et de Créer sont **meilleurs** avec les fiches de scènes, en les regardant **à l'aveugle**. Les mesures automatiques ne sont que des garde-fous.

## Ajouter vos vidéos (3 étapes)

1. **Déposez vos rushs** dans `e2e/banc-montage/medias/`, avec les noms exacts de `scenarios.json` (ex. `danse-1.mp4`, `coach-1.mp4`…). Un scénario sans tous ses fichiers est ignoré. Seulement des vidéos que vous avez le droit d'utiliser.
2. **Annotez ce que vous VOYEZ** : copiez `annotations/modele.json` en `annotations/danse-1.json` (un fichier par rush), puis remplissez les passages. Ne vous aidez pas du moteur : c'est la référence indépendante.
3. **Lancez** : `npx vitest run --config e2e/banc-montage/vitest.banc.config.ts`

## Ce que vous obtenez (dans `resultats/`)

- `<scénario>-<LETTRE>.mp4` : les montages, **étiquettes neutres** (A, B, C… mélangées). Regardez-les sans ouvrir la clé.
- `grille-modele.csv` : copiez-le et notez chaque vidéo de 1 à 5 (pertinence, fluidité des coupes, rythme, respect des dialogues, netteté, variété, cohérence narrative, durée ressentie).
- `cle-<scénario>.json` : quelle lettre = quelle méthode. **À ouvrir seulement après** avoir noté.
- `auto.json` : mesures automatiques (durée, nombre de rushs, intérêt moyen, secondes hors sujet ou floues, bornes dans la parole, contre vos annotations).

## Les cinq scénarios

| Scénario | Fichiers à déposer |
|---|---|
| Danse collective | `danse-1.mp4`, `danse-2.mp4`, `danse-3.mp4` |
| Coach qui parle puis danse | `coach-1.mp4`, `coach-2.mp4` |
| Témoignage | `temoignage-1.mp4`, `temoignage-2.mp4` |
| Plusieurs rushs nets et flous | `fitness-net-1.mp4`, `fitness-net-2.mp4`, `fitness-flou-1.mp4` |
| Scène hors sujet | `horssujet-1.mp4`, `horssujet-2.mp4` |

Détail de ce qui est demandé pour chacun : champ `demande` de `scenarios.json`.

## Méthodes comparées

- **A — sans fiche** : le montage actuel.
- **B — avec fiche** : le même moteur, avec les fiches de scènes (`fiches/<rush>.json`, format de `src/lib/creer/fiche-scenes.ts`). Il n'existe pas encore de producteur de fiches : sans elles, B est omis. Ne recopiez pas vos annotations en fiches (le banc le détecterait : elles ne seraient plus indépendantes).
- **C — variante expérimentale** : uniquement si A et B montrent une raison de la tester. Non prévue.

Chaque méthode est jouée pour **Autopilote** (son des rushs coupé par défaut) et pour **Créer** (protection de la parole selon le réglage actuel).

## Règles

- Rien n'est envoyé à un fournisseur : le banc est 100 % local (ffmpeg).
- Les médias, annotations remplies, fiches et rendus ne sont **jamais versionnés** (`.gitignore`).
- Ne décidez qu'au vu du visionnage. Un chiffre automatique meilleur ne prouve pas une vidéo meilleure.
