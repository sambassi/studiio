-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de `migrations/2026-09-29-stripe-events.sql`
--
-- Range dans `migrations/rollback/` : hors du dossier des migrations, aucun
-- outil qui applique `migrations/*.sql` ne peut le jouer par erreur.
--
-- ORDRE : d'abord redeployer un webhook qui n'appelle PAS ces fonctions
-- (commit anterieur a celui de l'agent A), PUIS jouer ce fichier, PUIS
--   docker kill -s SIGUSR1 studiio-postgrest
-- Dans l'autre ordre, le webhook deploye appellerait des fonctions absentes.
--
-- Ce qui est retire : les quatre fonctions. Ce qui est GARDE, deliberement :
--   * la table `stripe_events` et ses lignes — l'ancien webhook la lit et y
--     insere `{event_id, type, received_at}` ; le defaut `status='processed'`
--     laisse cet insert passer. La supprimer ferait perdre l'historique
--     d'idempotence et rouvrirait la porte aux doubles traitements ;
--   * les lignes `credit_transactions` ecrites par `crediter_credits_stripe`
--     — ce sont des credits reellement octroyes, pas un artefact de schema.
--
-- Rejouable : `if exists` partout.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.stripe_event_claim(text, text, int);
drop function if exists public.stripe_event_complete(text);
drop function if exists public.stripe_event_fail(text, text);
drop function if exists public.crediter_credits_stripe(uuid, integer, text, text, text, text);

-- L'ancien webhook, s'il tourne avec un role non proprietaire, a besoin de
-- lire et d'inserer. A decommenter en nommant le role reel (jamais `public`) :
--   grant select, insert on table public.stripe_events to <role_serveur>;

-- ---------------------------------------------------------------------------
-- RETRAIT COMPLET — seulement si la table n'existait PAS avant la migration
-- (controle prealable `select to_regclass('public.stripe_events')` = NULL),
-- et en acceptant de perdre l'historique d'idempotence :
--
--   drop table if exists public.stripe_events;
-- ---------------------------------------------------------------------------
