-- Retour arriere de 2026-10-30-remboursement-credits-operation.sql.
-- Supprime uniquement la fonction : aucune ligne de `users` ni de
-- `credit_transactions` n'est touchee. Les remboursements deja ecrits restent
-- en place (type 'refund', deja accepte avant cette migration).
begin;
drop function if exists public.rembourser_credits_operation(uuid, integer, text, text);
commit;
