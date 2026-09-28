-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de 2026-09-28-pawapay-deposits.sql
--
-- ⚠️ AVANT : poser `PAWAPAY_ENABLED` a autre chose que "true" (ou la
-- retirer) et redeployer, sinon les routes PawaPay repondront 500.
--
-- ⚠️ DESTRUCTIF pour `pawapay_deposits` : la table et ses lignes sont
-- supprimees. Faire un `pg_dump` avant (voir le runbook). Les credits DEJA
-- accordes restent, eux : `users.credits` et les lignes `credit_transactions`
-- (`reference_id = 'pawapay:<id>'`) ne sont PAS touches — les retirer
-- reviendrait a reprendre de l'argent paye.
--
-- Ne touche PAS l'index `credit_transactions_reference_unique` ni les
-- colonnes de `credit_transactions` : ils appartiennent a
-- `2026-08-27-credits-atomiques.sql`.
--
-- Rejouable. Apres : `docker kill -s SIGUSR1 studiio-postgrest`.
-- ═══════════════════════════════════════════════════════════════════════════

drop function if exists public.crediter_depot_pawapay(uuid, uuid, integer, text);
drop table if exists public.pawapay_deposits;
