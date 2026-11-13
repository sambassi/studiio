-- ============================================================================
-- MOBILE MONEY — JOURNAL DES DEPOTS ET CREDIT ATOMIQUE
--
-- ⚠️ NON APPLIQUEE EN PRODUCTION. Preparee avec sa procedure
--    (`2026-11-13-mobile-money.procedure.md`) et son retour arriere. Tant
--    qu'elle n'est pas jouee, le code appelant le DETECTE et rend un echec
--    explicite : aucun credit silencieusement perdu, aucun credit accorde
--    sans garantie.
--
-- Depend de `2026-08-27-credits-atomiques.sql` (table `credit_transactions`
-- et sa colonne `reference_id`), verifie ci-dessous.
--
-- ---------------------------------------------------------------------------
-- POURQUOI UNE FONCTION SEPAREE DE `crediter_credits_stripe`
-- ---------------------------------------------------------------------------
--
-- Cette derniere REFUSE toute reference qui ne commence pas par `stripe:`
-- (`p_reference not like 'stripe:_%'`). Ce n'est pas un oubli : son index
-- unique partiel ne couvre que `stripe:%`, et lui faire accepter un autre
-- prefixe lui ferait promettre une unicite que l'index ne tient pas.
--
-- Le Mobile Money a donc SA reference (`mm:<depositId>`), SON index unique
-- partiel, et une fonction qui est la copie conforme de l'autre : memes
-- controles, meme verrou de ligne, meme traitement du rejeu sequentiel ET
-- concurrent. Deux chemins de paiement, deux index, une seule discipline.
--
-- ---------------------------------------------------------------------------
-- POURQUOI UNE TABLE DE DEPOTS
-- ---------------------------------------------------------------------------
--
-- La ligne est ecrite AVANT l'appel reseau au prestataire. Si la reponse se
-- perd, le depot existe quand meme chez nous : c'est lui qui permet a la
-- reconciliation de retrouver le paiement et de crediter. Sans cette ligne,
-- un paiement reussi dont la reponse s'est perdue serait invisible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PRECONDITION
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'credit_transactions'
       and column_name = 'reference_id'
  ) then
    raise exception
      'credit_transactions.reference_id absent : appliquer d abord 2026-08-27-credits-atomiques.sql';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. LE JOURNAL DES DEPOTS
-- ---------------------------------------------------------------------------
create table if not exists public.pawapay_depots (
  deposit_id      text primary key,
  user_id         uuid not null references public.users(id) on delete cascade,
  -- Ce qui a ete VENDU : la cle du pack ou du plan, et les credits promis.
  offre_type      text not null check (offre_type in ('pack', 'plan')),
  offre_cle       text not null,
  credits         integer not null check (credits > 0),
  -- Ce qui a ete DEMANDE au payeur, fige a la creation : une variation de
  -- taux apres coup ne doit pas changer ce qu'on attend de lui.
  montant_local   numeric(14, 2) not null check (montant_local > 0),
  devise          text not null,
  pays            text not null,
  prix_chf_cents  integer not null check (prix_chf_cents > 0),
  taux_eur_par_chf numeric(10, 5),
  taux_le         date,
  -- Ou en est-on.
  statut          text not null default 'en_attente'
                  check (statut in ('en_attente', 'reussi', 'echoue', 'expire', 'annule')),
  motif_echec     text,
  -- Horodatage du credit effectif. `null` = pas encore credite.
  credite_le      timestamptz,
  sandbox         boolean not null default true,
  -- Derniere relecture aupres du prestataire. `null` = jamais relu.
  -- C'est ce qui FAIT TOURNER la file de reconciliation : sans elle, un lot
  -- de depots abandonnes, toujours les plus anciens, occuperait indefiniment
  -- la fenetre et les paiements recents ne seraient jamais relus.
  derniere_verification_le timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Rattrapage d'une base ou la table existe deja sans la colonne.
alter table public.pawapay_depots
  add column if not exists derniere_verification_le timestamptz;

-- La reconciliation ne balaie que ce qui est encore ouvert, et prend d'abord
-- ce qui n'a pas ete relu depuis le plus longtemps -- jamais relu en tete.
create index if not exists pawapay_depots_en_attente
  on public.pawapay_depots (derniere_verification_le nulls first, created_at)
  where statut = 'en_attente';

create index if not exists pawapay_depots_user
  on public.pawapay_depots (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. L'INDEX QUI PORTE L'UNICITE DU CREDIT
-- ---------------------------------------------------------------------------
-- Sans lui, la fonction ci-dessous ne peut RIEN garantir : c'est lui qui
-- transforme une course en `unique_violation` plutot qu'en double credit.
create unique index if not exists credit_transactions_mm_reference_unique
  on public.credit_transactions (reference_id)
  where reference_id like 'mm:%';

-- ---------------------------------------------------------------------------
-- 4. LE CREDIT ATOMIQUE ET IDEMPOTENT
-- ---------------------------------------------------------------------------
create or replace function public.crediter_credits_mobile_money(
  p_user_id     uuid,
  p_montant     integer,
  p_type        text,
  p_reference   text,
  p_description text default null
)
returns table (ok boolean, solde integer, deja_credite boolean, motif text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_solde     integer;
  v_titulaire uuid;
begin
  if p_reference is null
     or length(btrim(p_reference, E' \t\n\r')) = 0
     or p_reference not like 'mm:_%'
     or length(p_reference) > 255 then
    return query select false, 0, false, 'reference_invalide'::text;
    return;
  end if;

  -- Meme plafond que le chemin carte : il borne ce qu'une erreur de code
  -- peut donner.
  if p_montant is null or p_montant <= 0 or p_montant > 100000 then
    return query select false, 0, false, 'montant_invalide'::text;
    return;
  end if;

  if p_type is null or p_type not in ('purchase', 'subscription', 'bonus') then
    return query select false, 0, false, 'type_invalide'::text;
    return;
  end if;

  select credits into v_solde from public.users where id = p_user_id;
  if not found then
    return query select false, 0, false, 'utilisateur_inconnu'::text;
    return;
  end if;

  -- Rejeu sequentiel : le cas courant (notification relivree apres un 200
  -- perdu, ou reconciliation qui repasse sur un depot deja credite).
  select user_id into v_titulaire
    from public.credit_transactions
   where reference_id = p_reference
   limit 1;
  if found then
    if v_titulaire = p_user_id then
      return query select true, coalesce(v_solde, 0), true, null::text;
    else
      return query select false, coalesce(v_solde, 0), false, 'reference_autre_compte'::text;
    end if;
    return;
  end if;

  -- Increment ET journal dans le MEME bloc a EXCEPTION : le savepoint
  -- implicite annule l'increment du perdant d'une course.
  begin
    perform 1 from public.users where id = p_user_id for update;

    update public.users set credits = coalesce(credits, 0) + p_montant
     where id = p_user_id returning credits into v_solde;

    insert into public.credit_transactions (user_id, amount, type, reference_id, description)
    values (p_user_id, p_montant, p_type, p_reference,
            coalesce(p_description, 'mobile money ' || p_type));

  exception when unique_violation then
    select credits into v_solde from public.users where id = p_user_id;
    select user_id into v_titulaire
      from public.credit_transactions where reference_id = p_reference limit 1;
    if v_titulaire is distinct from p_user_id then
      return query select false, coalesce(v_solde, 0), false, 'reference_autre_compte'::text;
    else
      return query select true, coalesce(v_solde, 0), true, null::text;
    end if;
    return;
  end;

  return query select true, v_solde, false, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. DROITS — retiree a `public`, comme ses soeurs
-- ---------------------------------------------------------------------------
revoke all on function
  public.crediter_credits_mobile_money(uuid, integer, text, text, text) from public;

-- ---------------------------------------------------------------------------
-- 6. APRES APPLICATION — recharger le cache de schema de PostgREST
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- CONTROLES (lecture seule) :
--   select proname, prosecdef from pg_proc
--    where proname = 'crediter_credits_mobile_money';          -- 1 ligne, prosecdef = t
--   select indexname from pg_indexes
--    where indexname = 'credit_transactions_mm_reference_unique';  -- 1 ligne
--   select has_function_privilege('service_role',
--     'public.crediter_credits_mobile_money(uuid,integer,text,text,text)',
--     'EXECUTE');                                              -- attendu : true
-- ---------------------------------------------------------------------------
