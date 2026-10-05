# Registre des fonctionnalités verrouillées — Studiio

Une fonctionnalité **LOCKED** a été validée en production. Aucune modification ailleurs
ne doit la casser. Elle n'est rouverte que dans les cas `REOPEN_ONLY_IF`.

## Règle avant toute modification

1. Lister les fonctionnalités LOCKED potentiellement impactées.
2. Lire leurs invariants ci-dessous.
3. `npm run test:contracts` **avant** la modification.
4. Modifier.
5. `npm run test:contracts` **après**. Un contrat vert devenu rouge = **STOP** :
   ne jamais contourner ni réécrire le contrat pour faire passer la CI ; prouver le
   changement de comportement voulu et obtenir l'accord explicite du propriétaire.

Toute PR fournit : `CHANGED_FILES=` `LOCKED_FEATURES_IMPACTED=` (ou `NONE`)
`CONTRACTS_RUN=` `CONTRACTS_RESULT=` `NEW_RISK=`.

CI : job « Contrats verrouilles + build » — `CONTRACTS=GREEN` et `BUILD=GREEN`, sinon merge interdit.

Interdits (régressions silencieuses) : remplacer une voix clonée par une voix standard
sans le dire ; perdre un fichier après refresh ; utiliser un voice_id devenu invalide ;
perdre rushes, musique, CTA ou cartes ; remplacer une valeur validée par un fallback
non annoncé ; supprimer une fonctionnalité parce qu'un fournisseur est indisponible ;
refactor global d'une fonctionnalité stable. Tout fallback est prévu, visible et testé.

Fournisseurs (ElevenLabs, D-ID, Stripe, Meta…) : contrôle **non payant** d'abord (clé,
ressource existante, voice_id / avatar_id accessible, bon compte, permissions). Une
valeur en base ne prouve jamais que la ressource existe encore chez le fournisseur.

Données persistantes : création → base → refresh → relecture → utilisation → résultat.
Un `blob:`, une URL temporaire ou un état React n'est jamais une sauvegarde.

Production : branche → tests → contrats → CI → merge → production → smoke non payant.
Noter `PROD_SHA_BEFORE=` puis `PROD_SHA_AFTER=` `HEALTH=` `LOCKED_CONTRACTS=` ; rollback
= redéployer `PROD_SHA_BEFORE` (Coolify, champ Commit SHA).

---

## MONTAGE

```
FEATURE=MONTAGE
STATUS=LOCKED
DATE=2026-10-05
VALIDATED_SHA=d75acfe (prod, #504) — inchangé dans 0c7baad
USER_FLOW=Créer ou Autopilote → rushes + musique + cartes + CTA → montage → rendu
INVARIANTS=
- aucun passage source répété
- pas de freeze significatif (lecture pilotée / rendu image par image)
- pas de noir et blanc si des alternatives couleur existent
- CTA complet, sans troncature ; CTA utilisateur prioritaire
- cartes complètes (titre ET valeur), les 5 affichées
- voix/audio réellement enregistrés
- Créer et Autopilote partagent le même moteur et les mêmes règles
- raccourcissement si rushes uniques insuffisants, annoncé à l'utilisateur
CONTRACT_TESTS=src/__tests__/contracts/montage.contract.test.ts
PROD_SMOKE=un rendu Créer réel déjà validé ; smoke non payant = /api/health 200, /dashboard/creer 200
REOPEN_ONLY_IF=crash | rendu impossible | perte de données | régression majeure mesurable
MONTAGE_LOCKED=OUI
```

## CRÉER

```
FEATURE=CREER
STATUS=LOCKED
DATE=2026-10-05
VALIDATED_SHA=d75acfe
USER_FLOW=/dashboard/creer → contenu → audio → rendu → Envoi (brouillon / programmer / bureau)
INVARIANTS=
- brouillon : jamais de date exigée ; programmer : date ET réseau
- Modifier : la date du post est conservée
- CTA du brief rendu tel quel, headline gardée
- carte incomplète → arrêt clair AVANT tout débit
CONTRACT_TESTS=src/__tests__/contracts/creer.contract.test.ts
PROD_SMOKE=/dashboard/creer 200 authentifié
REOPEN_ONLY_IF=crash | rendu impossible | perte de données | régression majeure mesurable
```

## AUTOPILOTE

```
FEATURE=AUTOPILOTE
STATUS=LOCKED
DATE=2026-10-05
VALIDATED_SHA=d75acfe
USER_FLOW=configuration Autopilote → cron → rendu serveur → post Calendrier
INVARIANTS=
- même règle de CTA que Créer ; jamais « LIEN EN BIO » à la place du CTA utilisateur
- aucun CTA inventé si l'utilisateur n'en a pas
- tout repli (voix standard, musique introuvable, son absent, montage simple) est écrit
  en métadonnées et affiché dans le Calendrier
CONTRACT_TESTS=src/__tests__/contracts/autopilot.contract.test.ts
PROD_SMOKE=/api/autopilot/config 200 authentifié
REOPEN_ONLY_IF=crash | rendu impossible | perte de données | régression majeure mesurable
```

## MON JUMEAU

```
FEATURE=JUMEAU
STATUS=EN_VALIDATION
DATE=2026-10-05
VALIDATED_SHA=— (aucun rendu réel réussi en production)
USER_FLOW=Mon avatar → avatar D-ID validé → Créer « Jumeau avatar » → vidéo du jumeau dans le montage
INVARIANTS=
- vidéo « réussie » seulement si enregistrée sur NOTRE stockage
- copie impossible → nouvel essai ; au-delà du délai → échec franc ET remboursé
CONTRACT_TESTS=src/__tests__/contracts/jumeau.contract.test.ts
PROD_SMOKE=GET /api/creer/jumeau (pret, moteurDisponible) — non payant
REOPEN_ONLY_IF=— (pas encore LOCKED)
JUMEAU_LOCKED=NON — après un test réel de bout en bout réussi
```

## VOIX CLONÉE

```
FEATURE=VOICE_CLONE
STATUS=EN_VALIDATION
DATE=2026-10-05
VALIDATED_SHA=—
USER_FLOW=Mon avatar > Ma voix → clonage ElevenLabs → écoute → Créer / Autopilote narrent avec cette voix
INVARIANTS=
- la voix d'un compte n'est jamais utilisée par un autre
- voix inconnue ou d'autrui → AUCUN appel payant
- la bonne voix part avec l'identifiant nu, une seule fois
CONTRACT_TESTS=src/__tests__/contracts/voice.contract.test.ts
PROD_SMOKE=GET /api/voice/profil, GET /api/voice/clone — non payants
KNOWN_GAP=voice_id périmé (voix supprimée puis recréée) encore sélectionné dans Créer / Autopilote
REOPEN_ONLY_IF=— (pas encore LOCKED)
VOICE_CLONE_LOCKED=NON — après un test réel de bout en bout réussi
```
