# RGPD — points restants après #590 (à NE PAS lancer sans accord)

Relevés le 16/10/2026. Aucun de ces chantiers n'est commencé.

## 1. Bouton « Bloquer » de l'admin défectueux en production (préexistant)

- La table `public.users` de production n'a **pas de colonne `blocked`** (ni `deleted_at`), relevé en lecture seule le 16/10.
- Conséquences actuelles, antérieures à #590 :
  - `POST/DELETE /api/admin/users/[id]/ban` (`update({ blocked })`) échoue ;
  - le filtre « Bloqués » / « Actifs » de la liste admin (`/api/admin/users`, `eq('blocked', …)`) échoue ;
  - `PATCH /api/admin/users` avec `blocked` échoue.
- `blocked` n'a jamais coupé la session (choix conservé dans #590).
- Correction envisagée : migration dédiée `alter table users add column if not exists blocked boolean not null default false` (+ `deleted_at timestamptz` si utile), puis `grant` et `docker kill -s SIGUSR1 studiio-postgrest` (CLAUDE.md). Décider aussi si un compte bloqué doit perdre sa session.

## 2. Suppressions à traiter chez les fournisseurs externes

Le statut d'une demande affiche « Terminée dans Studiio — opérations externes restantes » tant qu'un fournisseur est `a_faire_manuellement`. Le registre privé `media/suppressions/<code>.json` garde les identifiants utiles (`referencesExternes`). Traitement manuel détaillé par fournisseur dans `tasks/dette-rgpd-purge-stockage.md` :

| Fournisseur | Données | Identifiant local |
|-------------|---------|-------------------|
| HeyGen | avatars, vidéos générées | `user_avatars.provider_avatar_id`, `avatar_generations.provider_video_id` |
| ElevenLabs | voix clonées | `user_voices.provider_voice_id` |
| Zernio | profil et comptes connectés | `users.zernio_profile_id`, `zernio_accounts` |
| Stripe | client et facturation (conservés pour obligations comptables, résiliation à vérifier) | `users.stripe_customer_id`, `subscriptions.stripe_subscription_id` |
| Meta | autorisation de l'application | côté utilisateur / console Meta |
| Anthropic (M2-b, si activé) | images fixes des rushes personnels (analyse visuelle) — appel sans état, rien de stocké chez eux d'adressable par compte ; journaux ≤ 30 jours | aucun (aucun identifiant de fichier ni de requête conservé) — détail `tasks/m2b-confidentialite.md` |
| Groq (M2-b, si activé) | son des rushes personnels (≤ 120 s, transcription) — appel sans état ; journaux ≤ 30 jours, zéro conservation activable | aucun — détail `tasks/m2b-confidentialite.md` |

Aucun appel fournisseur n'est fait automatiquement. Automatisation possible plus tard, fournisseur par fournisseur, avec accord et coût vérifié.

## 3. Rejeu des demandes signées Facebook

- `signed_request` est vérifié (HMAC-SHA256, temps constant), mais `issued_at` n'est pas borné : une requête signée capturée peut être rejouée.
- Effet limité : uniquement les données Meta du même compte rattaché, déjà supprimées au premier passage ; aucun accès à d'autres données.
- Correction minimale envisagée : refuser un `signed_request` dont `issued_at` a plus de 24 h (dans `lireSignedRequest`), avec test.
