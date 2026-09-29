-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de `2026-09-29-users-contraintes.sql`.
--
-- Retire les deux index et la contrainte ajoutes. Ne touche a AUCUNE ligne.
-- Rejouable, et sans effet si la migration n'a jamais ete appliquee.
--
-- `users.stripe_customer_id` est VOLONTAIREMENT conservee : le code l'ecrit
-- deja (create-checkout, purchase-pack) et la supprimer effacerait le lien
-- compte ↔ client Stripe. La retirer, si un jour c'est voulu, est une
-- decision a part :
--   alter table public.users drop column if exists stripe_customer_id;
--
-- Apres execution : `docker kill -s SIGUSR1 studiio-postgrest`.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

drop index if exists public.users_email_lower_unique;
drop index if exists public.users_stripe_customer_id_unique;
alter table public.users drop constraint if exists users_email_non_vide;

commit;
