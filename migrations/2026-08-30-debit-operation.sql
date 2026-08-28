-- ============================================================================
-- DEBIT ATOMIQUE ET IDEMPOTENT DES OPERATIONS HORS RENDU
--
-- ⚠️ TANT QU'ELLE N'EST PAS APPLIQUEE, `debiter_credits_operation` n'existe
--    pas : le code appelant le detecte et retombe sur un refus explicite,
--    jamais sur un debit silencieux.
--
-- Depend de `2026-08-27-credits-atomiques.sql`, qui a cree
-- `credit_transactions.reference_id`, `description`, et l'index unique
-- partiel `credit_transactions_reference_unique (user_id, reference_id)`.
-- Cette migration-ci N'AJOUTE AUCUNE TABLE, AUCUNE COLONNE, AUCUN INDEX :
-- elle ne fait que rendre cette garantie utilisable par des operations que
-- `tarifs_rendu` ne sait pas tarifer.
--
-- ---------------------------------------------------------------------------
-- POURQUOI UNE SECONDE FONCTION, ET PAS `debiter_credits`
-- ---------------------------------------------------------------------------
--
-- `debiter_credits(uuid, text, text)` prend un FORMAT et lit le prix dans
-- `public.tarifs_rendu`. C'est ce qui la rend imbattable pour un montage :
-- le prix affiche et le prix preleve viennent de la meme ligne, et le
-- navigateur n'a aucun moyen d'en proposer un autre.
--
-- Elle ne peut pas servir aux autres operations. `tarifs_rendu.format` est
-- reference par `rendus.format` : y ajouter 'ocr', 'upscale' ou 'avatar'
-- ferait accepter ces valeurs comme FORMATS de montage, ce qu'elles ne sont
-- pas. On aurait echange une garantie contre un mensonge de schema.
--
-- Le montant devient donc un PARAMETRE. C'est un cran en dessous : la base
-- ne possede plus le prix. Ce qui reste garanti, et qui est l'essentiel :
--
--   * le decrement et sa condition sont UNE seule instruction ;
--   * le journal est ecrit dans la MEME transaction ;
--   * une meme reference ne peut debiter qu'une fois, l'index le tient ;
--   * un montant negatif, nul ou aberrant est refuse ici, pas plus loin.
--
-- Le prix, lui, reste decide par les contrats serveur qui existent deja
-- (`AI_CREDITS`, `AVATAR_VIDEO_COST`, `RENDER_COSTS`) — jamais par le
-- navigateur, dont aucun champ de cout n'atteint cette fonction.
--
-- ---------------------------------------------------------------------------
-- CE QU'ELLE REMPLACE
-- ---------------------------------------------------------------------------
--
-- `deductCredits` (TypeScript) faisait, en trois requetes separees :
--
--   SELECT credits  ->  comparaison en JavaScript  ->  UPDATE credits = <valeur absolue>
--                                                 ->  INSERT dans le journal
--
-- Deux appels concurrents lisaient le meme solde et ecrivaient la meme
-- valeur : un debit disparaissait. Le journal pouvait manquer alors que le
-- solde avait bouge. Et aucune reference n'etait ecrite, donc un rejeu
-- debitait une seconde fois.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PRECONDITION — l'index unique du 27 aout doit exister
--
-- Sans lui, la fonction s'installerait et paraitrait idempotente alors que
-- deux appels simultanes passeraient tous les deux. Mieux vaut refuser la
-- migration que livrer une garantie qui n'en est pas une.
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
end $$;

-- ---------------------------------------------------------------------------
-- 2. LA FONCTION
--
-- `security definer` + `search_path` fige : meme raison que les autres. Une
-- fonction qui ecrit dans `users` ne doit pas pouvoir etre detournee par un
-- schema pose devant `public`.
-- ---------------------------------------------------------------------------
create or replace function public.debiter_credits_operation(
  p_user_id     uuid,
  p_montant     integer,
  p_type        text,
  p_reference   text,
  p_description text default null
)
returns table (ok boolean, solde integer, deja_debite boolean, motif text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_solde integer;
begin
  -- Une reference vide rendrait `reference_id` nul, donc hors de l'index
  -- partiel : le debit serait rejouable a l'infini sans que rien ne le dise.
  if p_reference is null or length(trim(p_reference)) = 0 then
    return query select false, 0, false, 'reference_absente'::text;
    return;
  end if;

  -- Le montant vient du serveur, mais « du serveur » n'est pas « correct ».
  -- Un zero ne debiterait rien tout en ecrivant une trace de debit ; un
  -- negatif CREDITERAIT le compte par la porte du debit.
  if p_montant is null or p_montant <= 0 then
    return query select false, 0, false, 'montant_invalide'::text;
    return;
  end if;

  -- Plafond de securite. Il ne remplace pas les contrats de prix : il borne
  -- ce qu'une erreur de code peut retirer en une fois. La plus chere des
  -- operations connues coute 40 credits.
  if p_montant > 1000 then
    return query select false, 0, false, 'montant_invalide'::text;
    return;
  end if;

  -- `credit_transactions.type` porte deja un CHECK ferme. Le verifier ici
  -- rend le refus lisible au lieu d'une violation de contrainte opaque.
  if p_type is null or p_type not in ('purchase', 'render', 'refund', 'bonus', 'subscription') then
    return query select false, 0, false, 'type_invalide'::text;
    return;
  end if;

  select credits into v_solde from public.users where id = p_user_id;
  if not found then
    return query select false, 0, false, 'utilisateur_inconnu'::text;
    return;
  end if;

  -- Idempotence sequentielle : le rejeu le plus courant est un second appel
  -- APRES le premier, pas pendant. On le traite sans toucher au solde.
  if exists (
    select 1 from public.credit_transactions
     where user_id = p_user_id and reference_id = p_reference
  ) then
    return query select true, v_solde, true, null::text;
    return;
  end if;

  -- Le bloc a EXCEPTION pose un savepoint. Le decrement est A L'INTERIEUR,
  -- deliberement : place avant, un `unique_violation` sur le journal le
  -- laisserait applique, et le compte perdrait des credits sans trace.
  begin
    update public.users
       set credits = credits - p_montant
     where id = p_user_id and credits >= p_montant
     returning credits into v_solde;

    if not found then
      select credits into v_solde from public.users where id = p_user_id;
      return query select false, coalesce(v_solde, 0), false, 'solde_insuffisant'::text;
      return;
    end if;

    insert into public.credit_transactions (user_id, amount, type, reference_id, description)
    values (p_user_id, -p_montant, p_type, p_reference, p_description);

  exception when unique_violation then
    -- Idempotence concurrente : l'autre appel a gagne la course et a deja
    -- debite. Le savepoint annule NOTRE decrement. On rend son solde.
    select credits into v_solde from public.users where id = p_user_id;
    return query select true, coalesce(v_solde, 0), true, null::text;
    return;
  end;

  return query select true, v_solde, false, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. DROITS
--
-- Retiree a `public` : seul le role de service, qui possede la fonction,
-- peut l'executer. Une fonction qui retire des credits n'a rien a faire
-- dans la surface anonyme de PostgREST.
-- ---------------------------------------------------------------------------
revoke all on function
  public.debiter_credits_operation(uuid, integer, text, text, text) from public;

-- ---------------------------------------------------------------------------
-- 4. APRES APPLICATION — recharger le cache de schema de PostgREST
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans cela la fonction existe en base mais reste invisible de l'API, et le
-- code la croit absente.
--
-- CONTROLES DE BON FONCTIONNEMENT (lecture seule) :
--   select proname, prosecdef, proconfig from pg_proc
--    where proname = 'debiter_credits_operation';
--   select has_function_privilege(
--     'public',
--     'public.debiter_credits_operation(uuid,integer,text,text,text)',
--     'EXECUTE');   -- attendu : false
-- ---------------------------------------------------------------------------
