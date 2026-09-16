# UX unifiée — Créer · Autopilote · Mon avatar

> Audit sur `main` **623019f** (2026-09-16). Quatre livrables : audit, cible, spécification, plan.
> Rien de ce document n'est encore implémenté : c'est la cible à valider avant tout code.

Fichiers audités : `src/app/dashboard/creer/AssistantWizard.tsx` (10 048 lignes, parcours guidé + Autopilote),
`src/components/creer/AutopilotPanel.tsx` (1 426), `src/app/dashboard/avatar/page.tsx` (1 087),
`src/components/avatar/AvatarVideoDid.tsx`, `src/components/creer/JumeauPanel.tsx`, `src/components/voice/MaVoixPanel.tsx`.

---

## Livrable 1 — Audit UX

### 1.1 Ce que chaque section fait déjà bien

| Brique | Créer (assistant) | Autopilote | Mon avatar |
|---|---|---|---|
| En-tête | `CreerEntete` : icône dégradée, titre, sous-titre, « Revenir au choix des modes » | Même `CreerEntete` (mode `autopilote`) | `<h1>Mon avatar qui parle</h1>` seul, pas de sous-titre, pas de retour |
| Fil d'étapes | `STEPS` Sujet · Style · Audio · Contenu · Envoi — puces numérotées, ✓ sur les franchies, cliquables si atteintes | `ETAPES` Sujets · Rushes · Style · Publication · Options · Vérification — barres + noms, `aria-current`, version mobile « Étape 2 sur 6 — Prochaine : … » | **Aucun** fil global. Seul le panneau D-ID a un pipeline (Téléchargement → Vérification → Création → Entraînement → Prêt) ; le flux HeyGen photo n'en a pas |
| « Quoi faire maintenant » | Implicite : le titre de l'étape et le bouton « Continuer » | Explicite : bloc `data-autopilot-a-faire` = **question + aide** à la même place à chaque étape | Implicite : titres numérotés « 1. À partir de quoi ? », puis blocs conditionnels |
| Aides / conseils | Encart violet « Double-cliquez un élément… » au-dessus de l'aperçu ; hints par séquence | `aide` par étape, hints des modes, `<details>` « avancé » repliés | Encart « Pour un bon résultat » (photo / vidéo HeyGen / liste D-ID) — uniquement à la création |
| Notifications | Bloc rouge `error` (AlertTriangle), bloc vert `jumeauNotice` avec « OK », bandeau gris « Brouillon retrouvé » avec action | `notice` texte « Enregistré. », avertissements ambre inline (`identite-absente`, `rush-unique`, `suivant-bloque`) | Bloc rouge `error`, bloc vert `notice` (Check) ; erreurs D-ID en petit texte rouge sous le panneau |
| Progression d'un travail long | `renderStage` + barre ; « La génération prend 1 à 5 minutes » | Checklist de vérification `data-autopilot-checklist` avec verdict prêt / pas prêt | Barre asymptotique (HeyGen), spinners « Entraînement en cours… », pipeline D-ID |
| Aperçu | Colonne droite permanente, onglets par séquence + « Tout », toujours visible | Même colonne (mode autopilote) | Aperçu de la **source** en vignette ; aperçu de validation (vidéo réelle) dans le bloc validation ; « Votre vidéo » (génération HeyGen) tout en bas |
| Action principale | Un CTA par étape, verrou de série | « Suivant » / « Lancer l'Autopilote », désactivés avec `title` explicatif | Plusieurs CTA visibles en même temps selon l'état |

### 1.2 Incohérences et écarts (ce qui coûte à l'utilisateur)

**A. Trois vocabulaires de progression.** Puces numérotées (Créer), barres fines (Autopilote), rien puis un pipeline textuel (Avatar). L'utilisateur réapprend « où j'en suis » à chaque page.

**B. « Mon avatar » est une page à part.** Pas d'en-tête commun, pas de fil global, pas de bloc « à faire », des cartes numérotées 1/2 qui ne correspondent pas aux vraies étapes vécues (source → consentement → entraînement → aperçu → validation → prêt). Le flux HeyGen photo n'a **aucune** progression visible entre « Créer mon avatar » et « Avatar validé ».

**C. Le « quoi faire maintenant » n'est écrit qu'en Autopilote.** Créer le suggère par le CTA ; Avatar le laisse deviner par l'ordre des blocs. Résultat : sur Avatar, après un import, l'utilisateur voit à la fois le bouton d'aperçu, les boutons Changer/Supprimer, la voix, la génération — sans hiérarchie.

**D. Notifications : forme correcte, contenu insuffisant.** Les blocs existent (rouge/vert/ambre) mais :
- une erreur dit *ce qui s'est passé*, rarement *pourquoi* et *comment corriger* (« La création de l'avatar a échoué. », « Le rendu a échoué : … ») ;
- pas d'action dans le bloc (sauf « Repartir de zéro » et « OK ») ;
- pas de niveau **information** distinct de **succès** (les deux sont verts) ;
- les erreurs D-ID sont en `text-xs` rouge sous le panneau, moins visibles que le bloc rouge global ;
- « Enregistré. » (Autopilote) n'est pas un bloc, c'est un mot.

**E. Aides contextuelles inégales.** Excellentes à l'import (photo / vidéo), absentes ensuite : aucune consigne au moment d'enregistrer la vidéo de consentement (la phrase est là, la *méthode* non), aucune consigne « que faire si l'aperçu ne me plaît pas », aucune consigne en Créer sur le choix du format hors hints.

**F. Aperçu : trois logiques.** Créer/Autopilote : colonne droite permanente (mémoire projet : « l'aperçu toujours visible »). Avatar : la source en vignette en haut, l'aperçu de validation au milieu, la vidéo générée en bas — trois « aperçus » sans zone dédiée.

**G. Ton et jargon.** Restes techniques visibles : « migration `autopilot_config` n'a pas été appliquée », « (409) », « HeyGen », « D-ID », « status=done », « Token ». Le nom des fournisseurs n'aide pas l'utilisateur à agir.

**H. Actions secondaires au même niveau que la principale.** Avatar : « Changer de source » / « Supprimer mon avatar » sont dans l'en-tête de la carte, aussi visibles que « Générer mon aperçu ».

**I. Deux entrées vers la voix.** `VoiceCloneRecorder` (enregistrer) et `MaVoixPanel` (choisir, prononciations) sont empilés sous l'avatar, sans lien avec l'étape où la voix est **requise** (aperçu D-ID → « Configurez votre voix personnelle »).

---

## Livrable 2 — Proposition UX unifiée

### 2.1 Le gabarit commun (les trois pages, une seule grammaire)

```
┌ En-tête ─────────────────────────────────────────────────────────────┐
│ [icône] Titre · sous-titre                         [← Retour / Aide] │
├ Notifications (zone unique, sous l'en-tête) ─────────────────────────┤
│ ✓ succès · ℹ information · ⚠ avertissement · ✕ erreur — + action    │
├ Fil d'étapes (FilEtapes) ────────────────────────────────────────────┤
│ ✓ Étape 1 ─ ✓ Étape 2 ─ ● Étape 3 (vous êtes ici) ─ ○ Étape 4 ─ ○ … │
├──────────────────────────────┬───────────────────────────────────────┤
│ Consigne (à faire maintenant)│ ZoneApercu                            │
│  Question · aide courte      │  ce que l'utilisateur a produit,      │
│  [Checklist / Conseils]      │  ou pourquoi il n'y a rien encore,    │
│  Contenu de l'étape          │  et l'action suivante mise en avant   │
│  [Action principale]         │                                       │
│  actions secondaires (texte) │                                       │
└──────────────────────────────┴───────────────────────────────────────┘
```

Cinq briques réutilisables, **une seule implémentation chacune** :

| Brique | Rôle | Existe déjà (à généraliser) |
|---|---|---|
| `EnteteSection` | icône, titre, sous-titre, action de retour, lien « Aide » | `CreerEntete` (Créer/Autopilote) |
| `Notification` | 4 niveaux, message en 3 temps (quoi · pourquoi · quoi faire), 0–2 boutons d'action, fermeture | blocs `error`/`notice` des trois pages |
| `FilEtapes` | étapes passées ✓ / courante ● / à venir ○, nom de chaque étape, « Prochaine : … » en mobile, cliquable si atteinte | `STEPS` (Créer) + `ETAPES` (Autopilote) + pipeline D-ID |
| `Consigne` | question + aide + checklist repliable « Conseils », toujours au même endroit sous le fil | `data-autopilot-a-faire` |
| `ZoneApercu` | cadre, état vide expliqué, résultat, action suivante | colonne droite Créer/Autopilote |

### 2.2 Les étapes de chaque parcours (ce que le fil affiche)

**Créer** (inchangé) : Sujet · Style · Audio · Contenu · Envoi — plus un état terminal « Envoyé » qui ouvre l'action suivante (Voir dans le Calendrier).

**Autopilote** (inchangé) : Sujets · Rushes · Style · Publication · Options · Vérification — la Vérification garde sa checklist, dans le composant `Checklist` commun.

**Mon avatar** (nouveau fil, dérivé de l'état serveur `etat` / `etape_did`, jamais recalculé à l'écran) :

| Étape | HeyGen photo | D-ID vidéo |
|---|---|---|
| 1. Source | photo importée | vidéo importée |
| 2. Consentement | consentement Studiio (case) — franchie à l'import | phrase → vidéo → vérification (ou réutilisation) |
| 3. Entraînement | `entrainement` | `creation_en_cours` |
| 4. Aperçu | `entraine_non_valide` sans aperçu prêt | idem |
| 5. Validation | aperçu vu → « Valider » | idem |
| ✓ Prêt | `valide` | `valide` |

Le pipeline D-ID actuel (Téléchargement → … → Prêt) **disparaît** au profit de ce fil unique : plus deux progressions sur la même page.

### 2.3 Les notifications : un contrat

Chaque notification a **quatre champs** : `niveau` (succes | info | avertissement | erreur), `titre` (ce qui s'est passé, une phrase), `detail` (pourquoi / quoi vérifier — liste courte autorisée), `actions` (0–2 : libellé + geste). Règles :
- l'erreur nomme toujours une sortie (« Réessayer », « Obtenir une nouvelle phrase », « Voir les consignes ») ;
- jamais de nom de fournisseur ni de code technique dans `titre` ; le détail technique va dans une ligne repliée « Détail technique » (utile au support) ;
- une seule notification à la fois par zone ; la plus récente remplace ;
- succès et information ne se ressemblent pas (vert vs bleu-gris).

### 2.4 Les aides : trois formes, toujours placées pareil

- **Aide courte** (une ligne) sous la question — obligatoire à chaque étape.
- **Conseils** (encart repliable, ouvert par défaut la première fois) — pour toute étape où l'utilisateur produit un fichier ou un enregistrement.
- **Checklist** (cases informatives, non bloquantes, sauf en Vérification Autopilote où elle est calculée) — avant une action coûteuse ou refusable.

### 2.5 L'aperçu : une zone, une logique

`ZoneApercu` connaît quatre états : `vide` (« Rien à montrer encore — [ce qu'il faut faire] »), `en_cours` (progression + durée attendue), `pret` (le média + l'action suivante mise en avant), `indisponible` (pourquoi, et la sortie). Sur Avatar, la zone montre selon l'étape : la source (1–3), l'aperçu de validation (4–5), l'avatar validé (✓). La vidéo générée HeyGen (« Votre vidéo ») devient un état `pret` de la même zone.

---

## Livrable 3 — Spécification à implémenter

### 3.1 Composants à créer (`src/components/ux/`)

**`Notification.tsx`**
```ts
interface NotificationProps {
  niveau: 'succes' | 'info' | 'avertissement' | 'erreur';
  titre: string;                       // quoi
  detail?: string | string[];          // pourquoi / quoi vérifier (liste = puces)
  actions?: Array<{ libelle: string; onClick: () => void; principale?: boolean }>;
  detailTechnique?: string | null;     // replié, jamais la clé, jamais l'URL fournisseur
  onFermer?: () => void;
  'data-notification'?: string;        // hook de test : `data-notification="erreur"`
}
```
Couleurs : succès `emerald`, info `sky`, avertissement `amber`, erreur `red` (celles déjà utilisées). Icônes lucide : `Check`, `Info`, `AlertTriangle`, `XCircle`. `role="status"` (succès/info) ou `role="alert"` (avertissement/erreur).

**`FilEtapes.tsx`**
```ts
interface Etape { cle: string; libelle: string }
interface FilEtapesProps {
  etapes: Etape[];
  courante: string;                    // clé
  franchies: string[];                 // clés
  atteignables?: string[];             // clés cliquables (Créer/Autopilote) ; Avatar : aucune
  onAller?: (cle: string) => void;
  accent?: string;
}
```
Rendu : puce ✓ (franchie, accent), ● (courante, accent, libellé blanc gras), ○ (à venir, gris). Ligne de liaison colorée jusqu'à la courante. Mobile : « Étape 3 sur 5 · Entraînement — Prochaine : Aperçu ». `aria-current="step"`. Hooks : `data-etape={cle}` `data-etape-etat="franchie|courante|a-venir"`.

**`Consigne.tsx`**
```ts
interface ConsigneProps {
  question: string;                    // « Que devez-vous faire ? » en une phrase
  aide?: string;                       // une ligne
  conseils?: { titre?: string; points: string[]; ouvertParDefaut?: boolean };
  checklist?: Array<{ libelle: string; ok?: boolean | null }>; // null = informatif
}
```
Toujours rendu juste sous le fil. Hooks : `data-consigne`, `data-conseils`, `data-checklist`.

**`ZoneApercu.tsx`**
```ts
type EtatApercu =
  | { statut: 'vide'; message: string; action?: Action }
  | { statut: 'en_cours'; message: string; progression?: number; dureeAttendue?: string }
  | { statut: 'pret'; media: React.ReactNode; actionSuivante?: Action; legende?: string }
  | { statut: 'indisponible'; message: string; action?: Action };
```
Hooks : `data-apercu={statut}`.

**`EnteteSection.tsx`** : extraction de `CreerEntete` avec `icone`, `titre`, `sousTitre`, `retour?`, `aide?` (lien vers l'encart Conseils de l'étape courante).

### 3.2 Câblage par page

**Créer / Autopilote** — remplacement à l'identique du rendu, sans changer une règle métier :
- `CreerEntete` → `EnteteSection` (mêmes textes).
- Fil de `STEPS` et `ETAPES` → `FilEtapes` (mêmes étapes, même cliquabilité `stepReachable` / `setEtape`).
- Blocs `error` / `jumeauNotice` / `restoredNotice` / `notice: 'Enregistré.'` → `Notification` (voir textes §3.3).
- `data-autopilot-a-faire` → `Consigne` ; ajouter la `Consigne` équivalente aux 5 étapes de Créer (textes §3.4).
- Colonne d'aperçu → enveloppée dans `ZoneApercu` (`pret` en permanence ; `en_cours` pendant `sending` avec `renderStage`).
- Les gardes serveur (jumeau, solde, lot) ne changent pas : seule la **présentation** de leur refus passe par `Notification` avec une action.

**Mon avatar** — refonte de la mise en page, logique serveur intacte :
1. `EnteteSection` : « Mon avatar », sous-titre « Votre double vidéo, à partir d'une photo ou d'une vidéo. », retour « Créer » masqué (page racine), lien « Aide ».
2. `Notification` unique sous l'en-tête (remplace `error` + `notice` + les petits textes rouges du panneau D-ID).
3. `FilEtapes` avec les 5 étapes de §2.2, dérivé de `avatar.etat` / `avatar.etape_did` / `apercu.statut`.
4. `Consigne` par étape (textes §3.4) — remplace les `<h2>1. …</h2>` et les encarts « Pour un bon résultat ».
5. Deux colonnes comme Créer : gauche = étape courante (import, consentement, création, aperçu/validation) ; droite = `ZoneApercu`.
6. Actions secondaires (« Changer de source », « Supprimer mon avatar ») sous la colonne gauche, en texte, jamais au niveau du CTA. Suppression : garder l'armement en deux clics.
7. `AvatarVideoDid` : conserver toute la logique (nom, phrase, réutilisation, expiration, vérification) ; **retirer** son pipeline interne (`data-avatar-did-pipeline`) au profit du fil global ; ses erreurs remontent à la `Notification` de page via `onErreur(notification)`.
8. Voix : `MaVoixPanel` reste sous l'avatar, mais l'étape 4 (Aperçu) affiche, quand la voix manque, une `Notification` avertissement « Votre voix personnelle est nécessaire pour l'aperçu » avec l'action « Configurer ma voix » qui fait défiler vers le panneau.
9. La génération HeyGen à la demande (« Ce que dit votre avatar ») n'apparaît qu'à l'état ✓ Prêt, sous la `ZoneApercu`, comme « Étape suivante ».

### 3.3 Textes des notifications (à utiliser tels quels)

| Cas | Niveau | Titre | Détail | Actions |
|---|---|---|---|---|
| Vidéo de consentement refusée (D-ID `error`) | erreur | Votre vidéo de consentement n'a pas été acceptée. | Vérifiez que : 1. votre nom affiché est correct ; 2. vous lisez la phrase exactement, y compris votre nom ; 3. vous êtes face caméra, visage visible ; 4. votre voix est claire et audible. Puis enregistrez une nouvelle vidéo et réimportez-la. | **Réenregistrer** · Obtenir une nouvelle phrase · Voir les consignes |
| Phrase expirée | avertissement | Votre phrase de consentement a expiré. | Une phrase est valable 30 minutes. Obtenez-en une nouvelle, puis enregistrez-la sans attendre. | **Obtenir une nouvelle phrase** |
| Consentement réutilisable détecté | info | Un consentement déjà validé existe pour Henri Bassi. | Vous n'avez pas à relire la phrase : il servira à ce nouvel avatar. | **Réutiliser mon consentement** · Obtenir plutôt une nouvelle phrase |
| Consentement accepté | succès | Consentement accepté. | Vous pouvez maintenant créer votre avatar. | **Créer mon avatar** |
| Entraînement lancé | info | Votre avatar est en préparation. | Cela prend généralement plusieurs minutes. Cette page se met à jour toute seule ; vous pouvez la laisser ouverte. | — |
| Entraînement échoué | erreur | L'entraînement de votre avatar n'a pas abouti. | La vidéo source n'a pas permis de créer l'avatar. Réessayez avec une vidéo plus longue, mieux éclairée, visage face caméra. | **Changer de vidéo** · Voir les consignes |
| Aperçu prêt | succès | Votre aperçu est prêt. | Regardez-le jusqu'au bout : le bouton « Valider mon avatar » apparaît dès que la lecture démarre. | **Voir mon aperçu** |
| Aperçu échoué | erreur | L'aperçu n'a pas pu être généré. | *(motif fournisseur en détail technique)* Vous pouvez le relancer sans frais. | **Relancer l'aperçu** |
| Voix manquante pour l'aperçu | avertissement | Votre voix personnelle est nécessaire pour l'aperçu. | L'aperçu fait parler votre avatar avec votre voix. Ajoutez ou choisissez-la dans « Ma voix ». | **Configurer ma voix** |
| Avatar validé | succès | Avatar validé. | Il est prêt pour vos vidéos. | **Créer une vidéo** (→ /dashboard/creer) |
| Service temporairement indisponible (drapeau/clé absents) | avertissement | L'avatar vidéo est temporairement indisponible. | Vous pouvez créer un avatar à partir d'une photo dès maintenant. | **À partir d'une photo** |
| Créer — crédits insuffisants | avertissement | Il vous manque des crédits pour ce montage. | Ce montage coûte N crédits ; vous en avez M. | **Recharger** · Réduire le lot |
| Créer — rendu échoué | erreur | Le montage n'a pas pu être produit. | Rien ne vous a été facturé. *(détail technique replié)* | **Réessayer** |
| Créer — envoyé | succès | Votre vidéo est dans le Calendrier. | Programmée le JJ/MM à HH:MM, en brouillon. | **Voir dans le Calendrier** · Créer une autre vidéo |
| Créer — brouillon retrouvé | info | Votre brouillon a été retrouvé. | Vous reprenez où vous en étiez. | Repartir de zéro |
| Autopilote — enregistré | succès (discret, 3 s) | Réglages enregistrés. | — | — |
| Autopilote — pas prêt | avertissement | L'Autopilote ne peut pas encore démarrer. | Il manque : *(éléments de la checklist non ok)*. | **Ajouter un rush** (ou l'étape manquante) |
| Autopilote — service non installé | avertissement | L'Autopilote n'est pas encore disponible. | Une mise à jour du serveur est nécessaire. Aucun réglage n'est perdu. | — |

### 3.4 Textes des consignes (question · aide · conseils)

**Mon avatar**
- *Source (photo)* — « À partir de quelle photo ? » · « Un portrait net, de face, bien éclairé. JPG, PNG ou WebP, 10 Mo max. » · Conseils : portrait net ; visage de face ; pas de masque ni lunettes de soleil ; bonne lumière ; visage entier, non coupé.
- *Source (vidéo)* — « À partir de quelle vidéo ? » · « Au moins 1 minute, en parlant naturellement. MP4 ou MOV, 50 Mo max. » · Conseils : parlez naturellement ; regardez régulièrement la caméra ; lumière stable ; visage bien visible ; évitez montage et coupures.
- *Consentement (phrase)* — « Confirmez votre nom, puis obtenez votre phrase. » · « Vous la lirez face caméra : c'est ce qui prouve que l'avatar est le vôtre. Un consentement déjà validé est réutilisé. »
- *Consentement (vidéo)* — « Enregistrez-vous en lisant exactement cette phrase. » · « Courte vidéo, face caméra, voix claire. Valable 30 minutes. » · Checklist : visage bien visible ; face caméra ; bonne lumière ; voix claire ; phrase lue exactement, votre nom compris ; vidéo courte ; fond calme.
- *Entraînement* — « Plus rien à faire pour l'instant. » · « Plusieurs minutes. Cette page se met à jour toute seule. »
- *Aperçu* — « Regardez votre avatar avant de le valider. » · « Une courte vidéo réelle, avec votre voix, offerte. »
- *Validation* — « Ça vous ressemble ? Validez. » · « Vous pourrez toujours changer de source plus tard. »
- *Prêt* — « Votre avatar est prêt. » · « Utilisez-le dans Créer, ou faites-lui dire un texte ici. »

**Créer**
- *Sujet* — « De quoi parle votre vidéo ? » · « Un thème ou votre propre sujet. Le jumeau numérique s'active ici si vous l'avez validé. »
- *Style* — « Quel ton, quel format ? » · « 9:16 pour Reels/TikTok, 16:9 pour YouTube, 1:1 pour le fil. » · Conseils : choisissez le format de la plateforme cible ; le ton se voit surtout dans les cartes.
- *Audio* — « Musique et voix (facultatif). » · « Une voix par séquence, ou une seule voix. Vous pouvez passer. »
- *Contenu* — « Relisez et ajustez. » · « Double-cliquez un élément pour le régler. Ce que vous voyez est ce qui sera rendu. »
- *Envoi* — « Où et quand ? » · « Calendrier, téléchargement ou aperçu. Le coût s'affiche avant. » · Conseils si le rendu ne plaît pas : revenez à Contenu, changez l'affiche ou le ton, relancez un aperçu (1 rendu).

**Autopilote** — conserver les `question`/`aide` existantes ; ajouter les Conseils : *Rushes* (au moins 3 rushes variés ; 20 s à 2 min ; sans musique incrustée) ; *Vérification* (« Studiio produira N contenus à la cadence X ; vous validez chacun si l'option est cochée ; vous pouvez mettre en pause à tout moment »).

### 3.5 Cas d'erreur à couvrir (test par cas)

Chaque cas ci-dessus = un test : la `Notification` attendue (niveau, titre, actions) est rendue **et** l'action principale déclenche le bon geste. Les gardes serveur existants ne changent pas ; on teste que leur refus **devient** la bonne notification.

### 3.6 Ce qui ne change pas

Aucune règle métier, aucun contrat serveur, aucune route, aucune migration. Le moteur Jumeau, l'Autopilote (moteur), LUT : intacts. Les hooks `data-*` existants sont conservés (ou dupliqués) pour ne pas casser les tests actuels.

---

## Livrable 4 — Plan d'implémentation

| # | Chantier | Contenu | Risque | Sortie |
|---|---|---|---|---|
| 1 | **Briques** | `Notification`, `FilEtapes`, `Consigne`, `ZoneApercu`, `EnteteSection` + tests unitaires (rendu, niveaux, actions, aria) | nul (rien branché) | PR isolée |
| 2 | **Quick wins Avatar** | Notifications D-ID → `Notification` avec actions (textes §3.3) ; consignes d'enregistrement (checklist) ; avertissement « voix manquante » avec action ; retrait des noms de fournisseurs des textes | faible | PR |
| 3 | **Refonte Mon avatar** | Fil unique 5 étapes (dérivé du serveur), deux colonnes avec `ZoneApercu`, actions secondaires rétrogradées, génération HeyGen déplacée sous « Prêt », pipeline D-ID interne retiré | moyen (page + tests de page) | PR |
| 4 | **Harmonisation Créer / Autopilote** | `EnteteSection`, `FilEtapes`, `Consigne` (5 consignes Créer), `Notification` pour erreurs/succès/brouillon/enregistré, `ZoneApercu` autour de la colonne | moyen (AssistantWizard : présentation seulement) | PR |
| 5 | **Validation** | Parcours complet réel sur preview : photo HeyGen jusqu'à validé ; vidéo D-ID jusqu'à validé avec réutilisation du consentement ; Créer avec jumeau ; Autopilote jusqu'à « Lancer ». Relecture de tous les textes à voix haute (ton simple, humain, direct) | — | rapport |

Critères d'acceptation communs : à tout moment l'écran répond aux cinq questions (où j'en suis, quoi faire, ce qui bloque, comment corriger, prochaine étape) ; aucune erreur sans action ; aucun nom de fournisseur ni code dans un titre ; un seul CTA principal visible ; l'aperçu au même endroit sur les trois pages ; suites Vitest existantes vertes, tsc = baseline.

Ordre recommandé : 1 → 2 → 3 → 4 → 5, une PR par ligne, GO explicite entre chaque.
