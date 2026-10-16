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
  - `DELETE /api/admin/users/[id]` — `requireAdmin`, uid validé ;
  - `POST /api/data-deletion` — Meta, signature HMAC-SHA256 vérifiée, portée Meta seulement.
- **Statut public** : `GET /api/data-deletion?code=<32 hex>` — état réel, sans uid, sans
  identifiant Meta, sans adresse, sans motif interne. Code inconnu → 404.

### Portée `compte` (utilisateur authentifié ou admin)

1. `verifications` — compte existant ; **refus si un abonnement facture encore**
   (`active|trialing|past_due|unpaid|incomplete` sans `cancel_at_period_end`) : il doit être
   résilié d'abord, aucun appel Stripe ici ; refus si compte administrateur.
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
| Registre `media/suppressions/<code>.json` | Preuve de la demande et de son exécution (contient l'uid, et l'id Meta pour une demande Meta). |

## Reste en dette (hors de ce lot)

1. **Fournisseurs non appelés** (interdit dans ce lot) : clones de voix ElevenLabs, avatars
   HeyGen/D-ID, profil Zernio facturé, abonnement Stripe (bloquant, voir `verifications`),
   révocation des jetons Meta/Google côté fournisseur. Les lignes locales partent ; les
   copies chez le fournisseur restent.
2. **Pas de bouton dans Réglages** : la route existe (`POST /api/user/suppression`), l'interface
   non.
3. **Session encore valide** après anonymisation (JWT) jusqu'à expiration ; `blocked` n'est
   vérifié nulle part à la connexion (dette préexistante).
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
7. **Tables absentes** (42P01 / PGRST205) : comptées comme « rien à supprimer ». Une table qui
   existerait sans droit PostgREST serait ainsi ignorée — vérifier les `grant` (CLAUDE.md).
8. Fiches de contenu orphelines (rush disparu, compte vivant) : toujours conservées
   (point 4 de l'ancien TODO).
