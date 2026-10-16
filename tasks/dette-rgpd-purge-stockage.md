# Dette RGPD — suppression réelle des données

> Constat initial : 2026-10-16 (lot M2-a). **Mise à jour : 2026-10-16, lot
> `fix/rgpd-suppression-donnees`** — la suppression réelle est livrée ; ce document dit ce
> qu'elle fait, ce qu'elle conserve volontairement, et ce qui reste en dette.

## Avant ce lot (constat, pour mémoire)

| Point | Où | Constat |
|-------|----|---------|
| Callback Meta « Data Deletion » | `src/app/api/data-deletion/route.ts` | **Stub**. POST : `signed_request` décodé **sans vérifier la signature**, lu en JSON alors que Meta envoie du `x-www-form-urlencoded` (→ 500 sur une vraie requête), `console.log` seulement. URL de statut vers `/api/data-deletion/status` (**route inexistante**). GET : `status: 'completed'` / « Your data has been deleted » **sans rien avoir supprimé**. |
| Suppression admin | `src/app/api/admin/users/[id]/route.ts` (~139) | Soft delete `users.deleted_at` seul ; aucune ligne liée, aucun objet de stockage. `deleted_at`/`blocked` ne sont vérifiés nulle part à la connexion. |
| Suppression par l'utilisateur | — | Aucune route, aucun bouton. |
| Stockage du compte | MinIO | Aucune purge liée au compte (seule la rétention par âge). |

## Ce que fait la suppression maintenant

Cœur : `src/lib/rgpd/suppression-donnees.ts` (pur, dépendances injectées). Adaptateurs :
`src/lib/rgpd/adaptateurs.ts` (PostgREST + MinIO). Signature Meta :
`src/lib/rgpd/meta-signed-request.ts`.

- **Demande enregistrée avant toute action** : `media/suppressions/<code>.json` (objet privé,
  durable, hors dossiers `<uid>/`). Aucune migration.
- **Étapes ordonnées, statut réel par étape** (`en_attente | en_cours | terminee | partielle |
  echec`), registre réécrit après chaque étape. Une étape ratée n'est jamais « terminée ». La
  reprise rejoue la même demande et ne refait que le non-terminé ; tout est idempotent.
- **Stockage** : purge par préfixe STRICT dérivé de l'uid côté serveur —
  `<bucket>/<uid>/` et `<bucket>/{audio-complet,stock-attributions,fiches-contenu}/<uid>/`
  pour `media`, `audio`, `videos`, `images`. Uid non UUID canonique minuscule → refus.
  Listage récursif + suppression par lots de 1000, 200 lots max par passe (au-delà :
  `partielle`, la passe suivante continue). Une clé listée hors préfixe arrête tout.
- **Entrées autorisées, et elles seules** :
  - `POST /api/user/suppression` — l'utilisateur authentifié, pour SON compte (uid de session,
    corps `{ "confirmation": "SUPPRIMER" }`) ;
  - `DELETE /api/admin/users/[id]` — `requireAdmin`, uid validé, **et corps obligatoire
    `{ "confirmation": "SUPPRIMER DÉFINITIVEMENT", "userId": "<même id que l'URL>" }`**
    (comparaison stricte : casse, accents, espaces) ; sinon 400 et rien n'est supprimé. L'interface
    `/admin/users` ouvre une modale (nom, e-mail, id, conséquences) dont le bouton rouge
    « Supprimer définitivement » reste désactivé tant que la phrase exacte n'est pas tapée ;
    « Bloquer » (cadenas) reste l'action réversible ;
  - `POST /api/data-deletion` — Meta, signature HMAC-SHA256 vérifiée, portée Meta seulement.
- **Statut public** : `GET /api/data-deletion?code=<32 hex>` — état réel, sans uid, sans
  identifiant Meta, sans adresse, sans motif interne, sans identifiant fournisseur. Code inconnu
  → 404. Champs : `statut` (GLOBAL), `studiio` (base + stockage seuls), `externes`
  (`[{ fournisseur, action, etat }]`), `conserve`, `etapes`. **`statut` ne vaut `terminee` que
  si Studiio est terminé ET qu'aucune opération externe n'est `a_faire_manuellement`** ; sinon
  `terminee_studiio_externes_restantes` (« Terminée dans Studiio — opérations externes
  restantes »). Mêmes champs dans les réponses admin et utilisateur.
- **Session** : un compte supprimé perd l'accès immédiatement — voir « Session après
  suppression » ci-dessous.

### Portée `compte` (utilisateur authentifié ou admin)

1. `verifications` — compte existant ; **refus si un abonnement facture encore**
   (`active|trialing|past_due|unpaid|incomplete` sans `cancel_at_period_end`) : il doit être
   résilié d'abord, aucun appel Stripe ici ; refus si compte administrateur.
1bis. `inventaire_externes` — relève, à partir des SEULES données locales et AVANT toute
   suppression, ce qui reste à faire chez chaque fournisseur (voir « Fournisseurs externes »).
   Figé ensuite : une reprise ne le recalcule jamais (les lignes qui le prouvent ont disparu).
2. `jetons_sociaux` — `social_accounts` (toutes plateformes), `user_drive`, `zernio_accounts`.
3. `stockage` — préfixes ci-dessus.
4. `contenus` — avatars (générations, versions, verrous, identités), tournage et rushes
   (+ analyses, transcriptions, candidats, clips, plans, montages, brouillons), autopilote,
   `render_jobs`, `scheduled_posts`, `videos` (→ `publishing_history` en cascade), `objectives`,
   `lut_assets`, `user_voices`, `user_notifications`, `user_settings`, `chat_logs`.
5. `liens_meta` — liens d'identité Facebook de ce compte.
6. `compte` — **anonymisation** de `users` (adresse `supprime-<uid>@supprime.invalid`, nom et
   photo vidés, `deleted_at`, `blocked = true`). Tentée seulement si 1–5 sont terminées.

### Portée `meta` (callback Meta signée) — règle retenue

Une demande Meta n'est authentifiée que par Meta : elle prouve « l'utilisateur Facebook X a
retiré l'appli », pas « le titulaire du compte Studiio veut le fermer ». Elle supprime donc
**les données obtenues via Facebook/Instagram** du seul compte rattaché à X : comptes sociaux
`facebook` / `instagram` (jetons de Page et d'Instagram Business), photo de profil si elle vient
d'un CDN Meta, lien d'identité. Le compte Studiio, ses contenus et ses autres réseaux restent.
La suppression complète relève de `/api/user/suppression` (session).

**Rattachement** : `social_accounts.account_id` contient l'id de **Page** ou d'**Instagram
Business**, jamais l'identifiant Facebook « app-scoped » de `signed_request.user_id` : aucun
rattachement n'était possible. Le lien est désormais écrit à chaque connexion Facebook
(NextAuth, `account.providerAccountId`) dans `media/liens-meta/<sha256(appli:id)>.json`
(+ index inverse `media/liens-meta/compte/<uid>/…`), sans migration. **Demande non rattachée
→ statut `en_attente`** (vérification manuelle), jamais « terminée ».

## Conservé volontairement (et pourquoi)

| Donnée | Raison |
|--------|--------|
| `credit_transactions`, `subscriptions`, `rendus` (coût, état, clé d'objet) | Pièces comptables et preuve des débits : obligation de conservation (CH : CO art. 958f, 10 ans ; FR : C. com. L123-22). Rattachées à un uid dont la ligne `users` est anonymisée. |
| Ligne `users` (anonymisée, pas supprimée) | `on delete cascade` sur toutes les tables filles : un `DELETE` emporterait la comptabilité. `stripe_customer_id`, `zernio_profile_id`, `credits`, `plan` restent (identifiants techniques nécessaires à la clôture fournisseur et à la comptabilité). |
| `audit_log` | Trace des actions d'administration (y compris de la suppression elle-même). |
| `email_suppressions` | Un désabonnement doit survivre au compte, sinon l'adresse redeviendrait contactable. |
| `media/converted/…`, `media/externes/…` | Préfixes partagés sans uid : impossible d'attribuer un objet à un compte (`converted/` est la dette connue de `PREFIXES_PARTAGES`). |
| Registre `media/suppressions/<code>.json` | Preuve de la demande et de son exécution (contient l'uid, l'id Meta pour une demande Meta, et `referencesExternes` jusqu'au traitement manuel). |

## Fournisseurs externes — traitement MANUEL restant

**Aucun appel fournisseur** n'est fait par Studiio. L'étape `inventaire_externes` pose, par
fournisseur, `non_applicable` uniquement si les données locales prouvent qu'il n'y a rien chez
lui ; dans tous les autres cas (traces trouvées, **ou lecture locale en échec**)
`a_faire_manuellement`. Les identifiants fournisseurs relevés sont copiés dans le registre
privé `media/suppressions/<code>.json`, champ **`referencesExternes`**
(`[{ fournisseur, table, colonne, valeur }]`) — jamais dans le statut public. C'est là que
l'opérateur les retrouve après la suppression locale (les tables source sont vidées). Une fois
l'opération faite chez le fournisseur, retirer ces références du registre.

| Fournisseur | Déclencheur local (`a_faire_manuellement`) | Action (`action`) | Où | Identifiant local |
|-------------|---------------------------------------------|-------------------|----|-------------------|
| **HeyGen** | ligne `user_avatars`, `avatar_versions`, `avatar_generations` ; `user_voices.provider = 'heygen'` | `supprimer_avatars_et_videos` | app.heygen.com → Avatars (supprimer l'avatar / la photo) et Projects/Videos (vidéos générées) ; ou API `DELETE` avatar | `provider_avatar_id`, `provider_asset_id` (avatars/versions), `provider_video_id` (générations), `provider_voice_id` (voix) |
| **ElevenLabs** | ligne `user_voices` (fournisseur ≠ heygen) | `supprimer_voix_clonees` | elevenlabs.io → Voices → My Voices → supprimer la voix clonée | `user_voices.provider_voice_id` (voice_id) |
| **Zernio** | ligne `zernio_accounts` ; `users.zernio_profile_id` | `supprimer_profil_et_comptes_connectes` | console Zernio → Profiles → profil du compte → déconnecter les comptes sociaux puis supprimer le profil | `zernio_accounts.profile_id` / `account_id`, `users.zernio_profile_id` |
| **Stripe** | ligne `subscriptions` ; `credit_transactions` (`purchase`/`subscription`) dont `reference_id` commence par `stripe:` ; `users.stripe_customer_id` | `verifier_resiliation_facturation_conservee` | dashboard.stripe.com → Customers → client : vérifier qu'aucun abonnement ne facture. **Ne pas supprimer** le client ni les factures (obligation comptable) ; au plus retirer les métadonnées non comptables | `stripe_customer_id`, `stripe_subscription_id` (`subscriptions` est conservée), `reference_id` `stripe:in:<facture>` / `stripe:cs:<session>` (`credit_transactions` conservée) |
| **Meta** | ligne `social_accounts` facebook/instagram ; lien d'identité Facebook (`media/liens-meta/compte/<uid>/`) ; photo de profil servie par un CDN Meta | `revoquer_autorisation_application` | Les jetons locaux sont supprimés, mais l'autorisation de l'application reste chez Meta : la révoquer (API Graph `DELETE /{user-id}/permissions` avec un jeton valide — impossible après suppression locale) ou demander à la personne de retirer Studiio dans Facebook → Paramètres → Applications et sites web | `social_accounts.account_id` (id de Page / IG Business). L'ASID de connexion n'est stocké que haché (`sha256(appli:id)`) |

Pour une demande **Meta** (callback signée), `externes` = `meta : non_applicable` : Meta
n'envoie ce rappel qu'après que la personne a retiré l'application.

## Session après suppression

`src/lib/auth/etat-compte.ts`, appelé par le callback `jwt` (`src/lib/auth/config.ts`) à chaque
lecture de session (`auth()` : middleware ET routes API) :

- compte **supprimé** = `users.deleted_at` renseigné, ou adresse
  `supprime-<uid>@supprime.invalid` (repli si la colonne `deleted_at` manque) → `jwt` renvoie
  `null` : Auth.js efface le cookie, `auth()` renvoie `null` → 401 sur les routes API, redirection
  `/auth/login` sur le dashboard ;
- base en panne, ligne introuvable, exception → **fail-open** (session conservée, rien mis en
  cache) : une panne ne déconnecte personne ;
- cache mémoire par instance : 60 s pour un compte actif, définitif pour un compte supprimé ;
  les routes de suppression appellent `marquerCompteSupprime` dès l'anonymisation (effet
  immédiat sur l'instance Node ; le middleware Edge a son propre cache, ≤ 60 s — les routes API,
  elles, refusent tout de suite) ;
- `blocked` (bannissement admin, réversible) **n'est toujours pas appliqué** à la session :
  c'était déjà le cas avant ce lot, et l'appliquer changerait le comportement des comptes déjà
  bannis — décision séparée. L'anonymisation pose `deleted_at`, qui suffit ;
- **conséquence assumée** : les comptes soft-deleted par l'ancienne route admin
  (`deleted_at` seul, adresse d'origine) sont eux aussi coupés.

**Reconnexion OAuth (Google / Facebook)** : l'adresse d'un compte supprimé RGPD n'existe plus
(anonymisée) → la connexion crée un **compte neuf, vierge** (10 crédits, e-mail de bienvenue) ;
l'ancien uid n'est jamais réutilisé. Si l'adresse retrouve une ligne marquée supprimée (ancien
soft-delete), la connexion est **refusée** et rien n'est écrit (la mise à jour nom/photo
réinscrirait des données personnelles). Une suppression `partielle` (étape `compte` pas encore
faite) laisse le compte connectable : il n'est pas encore anonymisé.

## Runtime Edge

Le middleware (Edge) importe `src/lib/auth/config.ts`. L'import dynamique de
`@/lib/rgpd/adaptateurs` (crypto, minio) y est sous `if (process.env.NEXT_RUNTIME !== 'edge')`,
condition remplacée à la compilation par Next : la branche est éliminée du bundle Edge. La
connexion (route `/api/auth/*`) s'exécute en Node.

## Reste en dette (hors de ce lot)

1. **Fournisseurs non appelés** (interdit dans ce lot) : voir le tableau ci-dessus — traitement
   manuel, guidé par `externes` et `referencesExternes`. Pas d'automatisation.
2. **Pas de bouton dans Réglages** : la route existe (`POST /api/user/suppression`), l'interface
   non.
3. **`blocked` non appliqué à la session** (dette préexistante, voir « Session après
   suppression »).
4. **Rattachement Meta robuste** : le lien n'existe que pour les comptes qui se reconnectent
   par Facebook après ce lot, et pas pour l'appli Instagram séparée
   (`META_INSTAGRAM_APP_ID`). Une colonne/table d'identités fournisseur (migration) serait la
   solution propre.
5. **Pas de reprise automatique** : une demande `partielle` est reprise en relançant la route
   (utilisateur ou admin, qui créent une nouvelle demande idempotente) ; pas encore de cron
   qui reprend les demandes ouvertes du registre. Les demandes Meta `en_attente` demandent un
   traitement manuel.
6. **Colonnes `users.deleted_at` / `blocked`** : déclarées par `004_admin_panel.sql`, dont
   l'application en production n'est pas prouvée. Absentes → étape `compte` en `echec`,
   statut `partielle` (honnête, mais à vérifier en lecture seule avant mise en service).
7. **Tables absentes** (42P01 / PGRST205) : comptées comme « rien à supprimer » (et
   `non_applicable` pour l'inventaire externe). Une table qui existerait sans droit PostgREST
   serait ainsi ignorée — vérifier les `grant` (CLAUDE.md).
8. Fiches de contenu orphelines (rush disparu, compte vivant) : toujours conservées
   (point 4 de l'ancien TODO).
9. **Recréation après suppression** : rien n'empêche de se reconnecter avec la même adresse et
   d'obtenir un compte neuf avec 10 crédits de bienvenue (abus marginal, non traité).


## Schéma réel de la production (relevé en lecture seule le 16/10/2026)

- `users` n'a **ni `deleted_at` ni `blocked`** (colonnes : id, name, email, password_hash, image, credits, role, created_at, updated_at, avatar_url, stripe_customer_id, plan, zernio_profile_id, publishing_enabled). 4 comptes, aucun anonymisé.
- Tables absentes : `chat_logs`, `user_drive`, `email_suppressions` (traitées comme vides par la suppression).
- Conséquence corrigée dans #590 : l'anonymisation retire une colonne absente et réessaie ; l'adresse anonymisée (obligatoire) suffit à couper la session ; `image` et `password_hash` sont désormais effacés.
- **Préexistant, hors #590** : le bannissement admin (`/api/admin/users/[id]/ban`, `blocked`) et le filtre « bloqués » de la liste admin échouent en production faute de colonne `blocked`. À traiter par une migration dédiée, avec accord.
