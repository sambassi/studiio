-- ============================================================================
-- REMBOURSEMENT ATOMIQUE ET IDEMPOTENT DES OPERATIONS HORS RENDU
--
-- ⚠️ TANT QU'ELLE N'EST PAS APPLIQUEE, `rembourser_credits_operation` n'existe
--    pas : le code appelant le detecte et rend un echec explicite, jamais un
--    remboursement silencieusement perdu.
--
-- ⚠️ NON APPLIQUEE EN PRODUCTION. Preparee pour la PR "Finaliser Cinema IA" ;
--    a appliquer sur `studiio-db` puis recharger PostgREST (SIGUSR1) avant
--    toute activation de `CINEMA_GENERATION_REELLE`, exactement comme les
--    trois migrations precedentes (voir CLAUDE.md, section PostgreSQL).
--
-- Depend de `2026-08-27-credits-atomiques.sql` (index unique partiel
-- `credit_transactions_reference_unique (user_id, reference_id)`) et de
-- `2026-08-30-debit-operation.sql` (meme precondition verifiee ci-dessous).
--
-- ---------------------------------------------------------------------------
-- POURQUOI UNE FONCTION SEPAREE, ET PAS `debiter_credits_operation` AVEC UN
-- MONTANT NEGATIF
-- ---------------------------------------------------------------------------
--
-- `debiter_credits_operation` REFUSE expressement tout montant <= 0
-- ('montant_invalide') — c'est une garantie, pas un oubli : un negatif
-- crediterait le compte par la porte du debit, sans le controle de solde
-- qui protege un vrai debit. Il faut donc une fonction SYMETRIQUE, qui :
--
--   * credite plutot que debite (`credits = credits + montant`) ;
--   * ne verifie AUCUN solde minimum (crediter ne peut jamais echouer pour
--     « solde insuffisant ») ;
--   * reste idempotente par la MEME garantie : une reference deja vue ne
--     credite pas une seconde fois. L'appelant doit fournir une reference
--     DIFFERENTE du debit original (ex. `<reference-debit>:remboursement`),
--     sinon l'index unique la ferait passer pour « deja remboursee » alors
--     qu'elle est seulement « deja debitee ».
--
-- ---------------------------------------------------------------------------
-- CE QU'ELLE CORRIGE
-- ---------------------------------------------------------------------------
--
-- Avant cette fonction, un echec de generation SURVENU APRES le paiement
-- (`atelier.ts`, debit "au dernier moment") laissait les credits pris sans
-- recours : le fournisseur pouvait avoir ete facture ou non, le resultat
-- n'etait de toute facon jamais produit, et le compte perdait ses credits.
-- La route (`/api/cinema/films/[id]/generation/route.ts`) appelle desormais
-- cette fonction des qu'un paiement reussi est suivi d'un echec.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PRECONDITION — le socle du 27 et du 30 aout doit exister
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname  = 'credit_transactions_reference_unique'
  ) then
    raise exception
      'credit_transactions_reference_unique absent : appliquer d abord 2026-08-27-credits-atomiques.sql';
  end if;
  if not exists (
    select 1 from pg_proc
     where proname = 'debiter_credits_operation'
  ) then
    raise exception
      'debiter_credits_operation absente : appliquer d abord 2026-08-30-debit-operation.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. LA FONCTION
-- ---------------------------------------------------------------------------
create or replace function public.rembourser_credits_operation(
  p_user_id     uuid,
  p_montant     integer,
  p_reference   text,
  p_description text default null
)
returns table (ok boolean, solde integer, deja_rembourse boolean, motif text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_solde integer;
begin
  -- Meme garde que le debit : une reference vide ou blanche echapperait a
  -- l'index partiel, et le remboursement serait rejouable a l'infini.
  if p_reference is null or length(btrim(p_reference, E' \t\n\r')) = 0 then
    return query select false, 0, false, 'reference_absente'::text;
    return;
  end if;

  -- Un montant nul ou negatif ne serait pas un remboursement ; au-dela de
  -- 1000, le meme plafond de securite que le debit (la plus chere des
  -- operations connues coute 40 credits).
  if p_montant is null or p_montant <= 0 or p_montant > 1000 then
    return query select false, 0, false, 'montant_invalide'::text;
    return;
  end if;

  select credits into v_solde from public.users where id = p_user_id;
  if not found then
    return query select false, 0, false, 'utilisateur_inconnu'::text;
    return;
  end if;

  -- Idempotence sequentielle : un second appel avec la MEME reference ne
  -- credite pas deux fois.
  if exists (
    select 1 from public.credit_transactions
     where user_id = p_user_id and reference_id = p_reference
  ) then
    return query select true, v_solde, true, null::text;
    return;
  end if;

  -- Meme discipline que le debit : l'ecriture et son journal dans UNE seule
  -- transaction, protegee par un savepoint contre la course concurrente.
  begin
    update public.users
       set credits = credits + p_montant
     where id = p_user_id
     returning credits into v_solde;

    insert into public.credit_transactions (user_id, amount, type, reference_id, description)
    values (p_user_id, p_montant, 'refund', p_reference, p_description);

  exception when unique_violation then
    -- L'autre appel a gagne la course et a deja credite. Le savepoint annule
    -- NOTRE credit : on rend le solde actuel, sans en ajouter un second.
    select credits into v_solde from public.users where id = p_user_id;
    return query select true, coalesce(v_solde, 0), true, null::text;
    return;
  end;

  return query select true, v_solde, false, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. DROITS — retiree a `public`, comme `debiter_credits_operation`
-- ---------------------------------------------------------------------------
revoke all on function
  public.rembourser_credits_operation(uuid, integer, text, text) from public;

-- ---------------------------------------------------------------------------
-- 4. APRES APPLICATION — recharger le cache de schema de PostgREST
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- CONTROLES DE BON FONCTIONNEMENT (lecture seule) :
--   select proname, prosecdef, proconfig from pg_proc
--    where proname = 'rembourser_credits_operation';
--   select has_function_privilege(
--     'public',
--     'public.rembourser_credits_operation(uuid,integer,text,text)',
--     'EXECUTE');   -- attendu : false
-- ---------------------------------------------------------------------------
