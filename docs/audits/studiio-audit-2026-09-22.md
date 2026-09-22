# Audit technique Studiio — 2026-09-22

> **Mission : AUDIT SEULEMENT.** Aucune correction, migration, déploiement, merge,
> changement de config, appel fournisseur payant ni publication réseau.
> Ce document consigne les causes prouvées avant toute décision de correction.

## 0. Périmètre & commit en production

- **Prod = `c13c948` = `origin/main` HEAD** (vérifié : `git rev-parse origin/main == c13c948`).
  Ce commit a été déployé et vérifié en ligne (health 200, endpoints du nouveau
  code présents). ⚠️ *Limite de preuve* : `/api/health` renvoie `version:"dev"`,
  aucun SHA n'est injecté au runtime ; la preuve « c'est bien c13c948 qui tourne »
  repose sur la chaîne de déploiement (SHA épinglé + build fini + comportement des
  endpoints) et non sur un identifiant renvoyé par l'app.
- Worktree isolé : `/Users/afroboost/studiio-audit`, branche `audit/studiio-2026-09-22`,
  basée sur `origin/main`. Ce doc est le **seul** fichier ajouté (aucune modif applicative).

## 1. Méthode de preuve

Chaque cause est étayée par : code réel, comportement runtime observé via des
**sondes gratuites** (endpoints internes lus avec la session), la source du SDK
concerné, ou les données existantes en base (historique des générations).
Les logs bruts de conteneur n'ont **pas** pu être lus (service temps-réel Coolify
HS ; `docker logs` = terminal, bloqué par la sécurité). Là où la preuve fine
exige un appel payant, c'est signalé **`TEST PAYANT REQUIS`**.

---

## 2. Tableau de synthèse

| # | Fonction | Symptôme | Cause prouvée | Type | Preuve | Dépendance | Correctif recommandé (à décider) | Risque |
|---|----------|----------|---------------|------|--------|-----------|----------------------------------|--------|
| 1 | Images IA (texte→image, « partir de ma photo », retouche) | « Le modèle IA n'a renvoyé aucune image » / « Modèle IA temporairement indisponible » | **SDK Replicate 1.4.0 `run()` en mode `block` (`Prefer: wait` ~60 s) renvoie `prediction.output = null` quand la génération dépasse ~60 s** : `isDone = block && status!=="starting"` est vrai pour un statut `processing`, donc le poll est sauté et un output nul est renvoyé → `lireOctetsSortie` → « sortie-vide ». | **CODE** | Source `node_modules/replicate/index.js` run() l.145-210 ; `ai/image/route.ts` l.204-207 (« sortie-vide »), l.375 (`new Replicate` sans `useFileOutput`, sans `wait:{mode:"poll"}`) ; token présent (Coolify) ; l'erreur n'est PAS « 503 non configuré ». | Racine A | Passer `replicate.run(..., { wait: { mode: 'poll' } })` (ou gérer le poll nous-mêmes / augmenter le timeout côté modèle), pour toujours attendre l'état terminal. | Moyen (chemin critique IA image) |
| 2 | Créer > Style — « contenu / Anthropic » | Bandeau « Modèle IA temporairement indisponible. Réessayez plus tard. » | La chaîne EXACTE ne vient **pas** d'Anthropic : `content/ai-generate` échoue en douceur (`if(!res.ok) return null` côté wizard → **repli local `generateSmartContent`**, pas de bandeau). Le bandeau est le message générique **de la route IMAGE** (`ai/image/route.ts:732`) laissé par un échec de génération d'image → **même racine que BUG 1**. | **CODE (= BUG 1)** | `ai-generate/route.ts` (repli 503 « …mode local ») ; `AssistantWizard.tsx:6695` + `if(!res.ok) return null` ; seule occurrence de la chaîne = `ai/image/route.ts:732`. | Racine A | Corriger BUG 1. Anthropic a un repli local sûr : pas un bloqueur. `ANTHROPIC_API_KEY` présent (Coolify). | Faible |
| 3 | Photo d'affiche — Pexels / Unsplash | « Aucune photo pour cette recherche » | **Les clés fonctionnent** (Pexels et Unsplash renvoient 6/6 sur requête simple). La requête de l'utilisateur est une **phrase française longue non simplifiée** : Pexels la tolère (6 résultats), **Unsplash renvoie 0** (plus strict). L'écran affiche alors « Aucune photo » (chemin résultat VIDE, pas erreur clé). | **CODE / UX** | Sondes gratuites : `pexels?query=fitness woman`→6 ; requête longue → Pexels 6 / **Unsplash 0** ; `pexels/route.ts` : `if(!KEY) return []` mais clés présentes (Coolify) donc l'appel a lieu ; 0 résultat = requête, pas clé. | — | Simplifier/tronquer la requête (mots-clés, pas la phrase) avant l'appel, surtout Unsplash ; message « élargissez la recherche ». | Faible |
| 4 | Jumeau dans Créer — rendu bloqué à 5 % | « Votre jumeau est en cours de préparation… » figé à 5 % | La génération D-ID du jumeau **fonctionne côté serveur** (2 générations `completed` avec vidéo aujourd'hui 12:35 et 12:39 ; 1 `failed` sur délai 30 min le 21). Au moment du blocage (14:40) **aucune nouvelle génération n'existe en base** → soit la reprise/dedup renvoie une génération déjà terminée sans faire avancer l'UI, soit la barre reste au **5 % statique** de l'attente (le poll ne remonte qu'un message, pas de %). | **CODE / UX (client)** — non tranché | Historique `avatar_generations` (sonde `/api/avatar/status`) ; `jumeau.ts:118` (`onEtape` sans %), `attendreStatutJumeau` ; pas de génération 14:xx. | Racine C | Confirmer par une repro (voir tests). Puis : barre de progression réelle + détecter la fin de génération et avancer l'UI. | Moyen |
| 5 | Autopilote — aucune vidéo (immédiat + programmé) | Rien ne se crée | Le montage Autopilote de base **ne dépend PAS** de Replicate ni d'Anthropic : contenu = `generateSmartContent` (LOCAL), affiche = Pexels (OK par défaut `posterMode:auto`). Le point de rupture est donc soit le **rendu serveur** (`renderAndUpload` → Remotion + Chromium sans tête), soit — pour le programmé — le **cron non déclenché** (aucun ordonnanceur Coolify vérifié). | **NON DÉTERMINÉ** (candidats : INFRA rendu / CONFIG cron) | `engine.ts:131` (`generateSmartContent` local) ; `render.ts` (Chromium/Remotion) ; posterMode défaut `auto` (Pexels OK). Pas de dépendance à la racine A par défaut. | Indépendant de A/B par défaut | Obtenir l'erreur du rendu (repro) + vérifier la tâche planifiée Coolify du cron. | Moyen |
| 6 | UX aperçu (bascule séquence, %, aperçu jumeau) | Manque : bascule auto, %, aperçu jumeau | État existant : `previewFocus` (défaut `'all'`) pilote les onglets Titre/Cartes/Vidéo/CTA/Tout. Pas de bascule auto à la config d'une séquence ; pas de % granulaire (5 % figé) ; pas d'aperçu de la vidéo du jumeau dans Créer. | **UX / CODE** | `AssistantWizard.tsx` `previewFocus` ; `jumeau.ts:118` (message sans %). | Racine C (pour le %) | Ajouts ciblés : `setPreviewFocus(seq)` à la config/génération d'une séquence ; barre % réelle ; bloc aperçu jumeau. Peu risqué. | Faible |
| 7 | Sélection complète du texte impossible | Pas de « tout sélectionner » souris/tactile | L'aperçu (composition rendue) porte `pointerEvents:'none'` **par conception** (ce n'est pas du texte éditable). La saisie réelle se fait dans des champs/`textarea` ailleurs ; « tout sélectionner » est difficile sur mobile (comportement natif). | **UX / CODE** — à préciser | `AssistantWizard.tsx` `pointerEvents:'none'` (l.2320/2329…) ; `select-none`/`userSelect:'none'` dans quelques panneaux d'édition (ImageEditorPanel, CropRushModal). | — | Identifier le champ visé par l'utilisateur (aperçu vs éditeur) ; si éditeur : bouton « tout sélectionner » / `user-select:text`. Repro nécessaire pour cibler. | Faible |

---

## A. Causes racines

- **Racine A — Intégration Replicate (SDK 1.4.0 `run()` en mode block).**
  Renvoie un `output` nul pour toute génération > ~60 s → « aucune image ».
  Touche : génération texte→image, « partir de ma photo », retouche IA, et le
  bandeau du BUG 2. **CODE.** Token/crédit OK.
- **Racine B — Requête photo non simplifiée.** La phrase FR longue donne 0
  résultat (surtout Unsplash). **CODE/UX.** Clés OK.
- **Racine C — Progression/intégration du rendu jumeau côté client.** Barre à 5 %
  statique ; fin de génération pas répercutée. **CODE/UX.** D-ID OK côté serveur.
- **Racine D — Rendu serveur Autopilote et/ou ordonnancement du cron.**
  **NON DÉTERMINÉ** (INFRA/CONFIG), à confirmer par repro + vérif tâche cron.
- **UX indépendants** — bascule d'onglet, aperçu jumeau, sélection de texte.

## B. Carte de dépendances

```
Racine A (Replicate run() null > 60s)
  → BUG 1 (texte→image)
  → BUG 1 (« partir de ma photo »)
  → Retouche IA
  → BUG 2 (bandeau « Modèle IA temporairement indisponible » = échec image résiduel)

Racine B (requête non simplifiée)
  → BUG 3 (Unsplash 0 résultat ; Pexels tolère)

Racine C (progression rendu jumeau client)
  → BUG 4 (5 % figé)
  → BUG 6 (% + aperçu jumeau)

Racine D (rendu serveur / cron)
  → BUG 5 (Autopilote immédiat + programmé)

Indépendants : BUG 6 (bascule onglet), BUG 7 (sélection texte)
```

Anthropic (BUG 2 supposé) **n'est pas** une cause : repli local sûr. Pexels/Unsplash
(BUG 3 supposé « clés absentes ») **n'est pas** une cause de config : clés OK.

## C. Ordre de correction recommandé (aucune correction lancée)

1. **Racine A (Replicate `run()`)** — débloque BUG 1, la retouche IA et BUG 2 d'un coup. Chemin critique, meilleur rapport impact/effort.
2. **Racine D (Autopilote/rendu+cron)** — d'abord *diagnostiquer* (obtenir l'erreur réelle de rendu + vérifier la tâche cron), avant de corriger.
3. **Racine C (rendu jumeau client, 5 %)** — après repro ; livre aussi une partie de BUG 6 (%).
4. **Racine B (requête photo)** — correctif simple, faible risque.
5. **UX** — bascule d'onglet, aperçu jumeau, sélection de texte (BUG 6/7).

## D. Configuration (variables — NOMS uniquement, aucune valeur)

Définies dans Coolify (`studiio-app`) et attendues par le code :
`ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`,
`DID_API_KEY`, `DID_VIDEO_AVATAR_ACTIVE`, `HEYGEN_API_KEY`, `ELEVENLABS_API_KEY`,
`GROQ_API_KEY`, `OPENAI_API_KEY`, `AUTOPILOT_*_ANTHROPIC_*`, `MINIO_*`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `STRIPE_*`, `RESEND_*`,
`ZERNIO_*`, OAuth sociaux (`FACEBOOK_*`, `TIKTOK_*`, `YOUTUBE_*`, `META_*`), `GOOGLE_ID`/`GOOGLE_SECRET`.

Constats :
- **Présentes et fonctionnelles au runtime (prouvé)** : `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`
  (résultats renvoyés), `DID_API_KEY`/`ELEVENLABS_API_KEY` (jumeau voix + vidéo terminés),
  `REPLICATE_API_TOKEN` (erreur = « sortie-vide », pas « 503 non configuré » ⇒ injecté).
- **Nom couvert** : le code lit `GOOGLE_CLIENT_ID || GOOGLE_ID` et `GOOGLE_CLIENT_SECRET || GOOGLE_SECRET` ⇒ `GOOGLE_ID`/`GOOGLE_SECRET` de Coolify **conviennent** (pas de bug de nom).
- **Historique / à nettoyer (non bloquant)** : `TEST_VAR` (variable de test résiduelle),
  `VERCEL_OIDC_TOKEN` (reliquat Vercel), `NEXT_PUBLIC_SUPABASE_URL` pointe encore vers
  le Supabase cloud (cf. CLAUDE.md — dette de migration côté client).
- **`BATCH_RENDER_DESACTIVE`** : **absent de Coolify, et c'est normal** — désactivé par
  **constante de code** (`src/lib/render/batch-disabled.ts:35 = true`). La route
  `/api/render/batch` reste inatteignable. Baseline préservée.
- **Runtime non prouvé finement** (`ANTHROPIC_API_KEY`, flags AUTOPILOT_*) : présents dans
  Coolify ; confirmation d'injection = un appel (payant pour Anthropic) → non fait.

## E. Risques de régression (pour les corrections futures)

- **Racine A** : ne pas casser le chemin « affiche IA durable » (rapatriement MinIO,
  débit crédits, garde-fous URL `replicate.delivery`). Conserver `AVATAR`/voix intacts.
- **Racine C / rendu jumeau** : ne pas toucher au **jumeau VOIX** (fonctionne) ni à la
  chaîne D-ID validée. Préserver le débit/remboursement idempotent.
- **Racine D** : Chromium/Remotion — tout changement de rendu doit préserver Créer.
- **Général** : préserver la baseline (voix clonée, import rushes, protection 24 h,
  jumeau voix, Série ≤ 10, boucle séquentielle, migrations posées) ; **NE PAS**
  réactiver `/api/render/batch` (`BATCH_RENDER_DESACTIVE` reste `true`).

## F. Tests nécessaires

- **Gratuits / déjà faits (sondes runtime)** : `/api/pexels` (Pexels/Unsplash),
  `/api/creer/jumeau`, `/api/avatar/status` (historique), `/api/autopilot/config`,
  `/api/admin/service-health`.
- **Mockés / hors ligne** : source SDK Replicate, lecture code.
- **Production SANS coût** : baseline `tsc` (129, inchangé), CI verte sur `c13c948`.
- **`TEST PAYANT REQUIS`** (attendre autorisation Bassi) :
  - **BUG 1** — confirmer le mécanisme null-output sur une génération > 60 s :
    fournisseur *Replicate*, action *generate-bg / kontext*, coût *~5 crédits + ~0,04 $*,
    raison *observer l'`output` réel d'une génération lente*.
  - **BUG 4** — repro du 5 % : fournisseur *D-ID + ElevenLabs*, action *rendu Créer avec
    jumeau*, coût *~50 crédits + ~0,2 $*, raison *voir si l'UI avance après la fin serveur*.
  - **BUG 5** — erreur réelle du rendu Autopilote : action *« Produire maintenant »*,
    coût *~15 crédits (+ rendu)*, raison *capturer le point de rupture du rendu*.

## G. Git

- Worktree : `/Users/afroboost/studiio-audit` — branche `audit/studiio-2026-09-22` (base `origin/main` = `c13c948`).
- PR : **draft, audit uniquement** (ce seul fichier `docs/audits/studiio-audit-2026-09-22.md`, aucune modif applicative).
- Baseline : `tsc` = **129** (identique à `main`, par contenu — aucune erreur nouvelle) ; CI (Vitest + Credits-PG) **verte** sur `c13c948` (#423).

## H. DÉCISIONS REQUISES DE BASSI

1. **Autorises-tu les tests payants** listés en **F** (BUG 1, 4, 5) pour prouver les 3
   derniers points au niveau « vidéo finale » ? (Coûts chiffrés ci-dessus.)
2. **Ordre de correction** : valides-tu l'ordre proposé en **C** (Racine A d'abord) ?
3. **Cron Autopilote programmé** : une tâche planifiée Coolify appelle-t-elle
   `/api/cron/autopilot` (avec `CRON_SECRET`) ? Si tu ne sais pas, je peux le vérifier
   avec toi (lecture seule). C'est déterminant pour le « programmé » du BUG 5.
4. **Nettoyage config** (optionnel) : ok pour retirer `TEST_VAR` et `VERCEL_OIDC_TOKEN` ?

**Aucune correction n'est commencée.** J'attends ta validation avant tout second prompt.
