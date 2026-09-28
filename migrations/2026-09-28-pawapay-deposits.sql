-- ═══════════════════════════════════════════════════════════════════════════
-- PAWAPAY : DEPOTS MOBILE MONEY ET CREDIT ATOMIQUE
--
-- ⚠️ TANT QU'ELLE N'EST PAS APPLIQUEE
--
-- `obtenirStore()` (src/lib/payment/pawapay/store.ts) ne renvoie un store que
-- si `PAWAPAY_ENABLED === "true"`. Tant que cette variable n'est pas posee,
-- rien ne lit ni n'ecrit ces objets. Ordre obligatoire en production :
-- migration + SIGUSR1 PostgREST D'ABORD, variable ENSUITE.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE APPORTE
-- ─────────────────────────────────────────────────────────────────────────
--
--   1. `pawapay_deposits` : la trace locale d'un depot, ecrite AVANT l'appel
--      a PawaPay. C'est ELLE qui fait foi pour le montant, la devise,
--      l'utilisateur et le nombre de credits — jamais le corps d'un callback.
--   2. `crediter_depot_pawapay` : le SEUL chemin de credit. Dans UNE
--      transaction, elle verrouille le depot, credite le solde, journalise
--      dans `credit_transactions` et marque le depot `credite`. Aucun etat
--      « credite sans credit » ni « credit sans depot credite » n'existe.
--
-- Elle REUTILISE, sans les redefinir, l'index unique
-- `credit_transactions_reference_unique (user_id, reference_id)` et les
-- colonnes `reference_id` / `description` poses par
-- `2026-08-27-credits-atomiques.sql`, qui doit donc etre appliquee AVANT.
--
-- Additive et rejouable : aucune donnee existante n'est touchee.
-- Rollback : `2026-09-28-pawapay-deposits.rollback.sql`.
-- ═══════════════════════════════════════════════════════════════════════════

-- Garde-fou : sans l'index de reference, la protection anti double credit
-- par `unique_violation` n'existerait pas. On refuse de s'appliquer plutot
-- que de livrer une fonction qui se croirait protegee.
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'credit_transactions_reference_unique'
  ) then
    raise exception 'Prerequis absent : appliquer 2026-08-27-credits-atomiques.sql avant cette migration';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. LA TABLE
--
-- Colonnes = contrat `DepotAttendu` (src/lib/payment/pawapay/types.ts) :
--   depositId → deposit_id   userId → user_id   pack → pack
--   credits → credits        montant → montant  devise → devise
--   pays → pays              statut → statut    creeLe → cree_le
--   verifieLe → verifie_le
-- Plus `montant_chf_centimes` (prix du pack en CHF au moment de l'achat,
-- rempli par le store depuis `PACKS_PAWAPAY`) et `credite_le`.
--
-- `montant` est un `numeric` EXACT (jamais un flottant). Le store le relit
-- par `montant::text` pour que la chaine decimale arrive intacte a
-- `normaliserMontant`, sans passer par un nombre JSON.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.pawapay_deposits (
  deposit_id           uuid primary key,
  user_id              uuid not null references public.users(id) on delete cascade,
  pack                 text not null check (pack in ('small', 'medium', 'large', 'xlarge')),
  credits              integer not null check (credits > 0),
  montant_chf_centimes integer check (montant_chf_centimes is null or montant_chf_centimes > 0),
  montant              numeric not null check (montant > 0),
  devise               text not null check (devise ~ '^[A-Z]{3}$'),
  pays                 text check (pays is null or pays ~ '^[A-Z]{3}$'),
  statut               text not null default 'en_attente'
                         check (statut in ('en_attente', 'credite', 'echec')),
  cree_le              timestamptz not null default now(),
  verifie_le           timestamptz,
  credite_le           timestamptz,
  -- Un depot est `credite` si et seulement si il porte sa date de credit.
  constraint pawapay_deposits_credite_coherent
    check ((statut = 'credite') = (credite_le is not null))
);

-- Le rattrapage (cron) : `statut = 'en_attente'`, trie par `verifie_le`
-- (jamais verifies d'abord), puis `cree_le`.
create index if not exists pawapay_deposits_statut_verifie_le
  on public.pawapay_deposits (statut, verifie_le nulls first, cree_le);

create index if not exists pawapay_deposits_user_id
  on public.pawapay_deposits (user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. LE CREDIT ATOMIQUE
--
-- Parametres = `DemandeCredit` envoyee par `crediterSiNonCredite` :
--   p_deposit_id  = depositId
--   p_user_id     = userId       (s'il est fourni : doit etre le proprietaire)
--   p_credits     = credits      (s'il est fourni : doit etre celui du depot)
--   p_reference   = referenceId  (doit valoir 'pawapay:' || deposit_id)
--
-- L'utilisateur credite et le nombre de credits sont LUS DANS LA LIGNE
-- VERROUILLEE, jamais pris dans les parametres : le depot enregistre fait
-- foi. Les parametres ne servent qu'a controler ; un ecart LEVE, rien n'est
-- ecrit.
--
-- Condition de credit : `statut <> 'credite'`. Un depot `echec` PEUT donc
-- etre credite : `marquerEchec` n'est pose que sur un refus explicite ou une
-- relecture FAILED, et si une relecture ulterieure chez PawaPay dit
-- COMPLETED (montant et devise conformes, verifies par `evaluerDepot`), le
-- client a paye : il doit etre credite. C'est le comportement du store
-- memoire de reference (`creerStoreMemoire`).
--
-- Deroule, dans la transaction de l'appelant :
--   a. `select ... for update` : les appels concurrents sur le MEME depot
--      sont serialises ici. Le second attend, puis voit `credite`.
--   b. deja `credite` → 'deja_credite', sans rien ecrire.
--   c. increment RELATIF de `users.credits`, journal `purchase` avec la
--      reference unique, depot marque `credite` — dans un meme bloc.
--   d. `unique_violation` sur la reference : un credit portant cette
--      reference existe deja pour cet utilisateur (ecrit hors de ce chemin).
--      Le savepoint du bloc annule NOTRE increment ; on marque le depot
--      `credite` (le credit, lui, existe) et on rend 'deja_credite'.
--   e. toute autre erreur REMONTE : la transaction entiere est annulee, le
--      depot reste non credite et sera re-tente.
--
-- SECURITY DEFINER avec `search_path` fige, tables qualifiees : meme
-- discipline que `debiter_credits`.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.crediter_depot_pawapay(
  p_deposit_id uuid,
  p_user_id    uuid,
  p_credits    integer,
  p_reference  text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_depot public.pawapay_deposits%rowtype;
begin
  if p_deposit_id is null then
    raise exception 'crediter_depot_pawapay : depot absent'
      using errcode = '22023';
  end if;

  if p_reference is distinct from ('pawapay:' || p_deposit_id::text) then
    raise exception 'crediter_depot_pawapay : reference invalide pour %', p_deposit_id
      using errcode = '22023';
  end if;

  select * into v_depot
    from public.pawapay_deposits
   where deposit_id = p_deposit_id
     for update;

  if not found then
    raise exception 'crediter_depot_pawapay : depot inconnu %', p_deposit_id
      using errcode = 'P0002';
  end if;

  if p_user_id is not null and v_depot.user_id <> p_user_id then
    raise exception 'crediter_depot_pawapay : depot % d''un autre utilisateur', p_deposit_id
      using errcode = '42501';
  end if;

  if v_depot.statut = 'credite' then
    return 'deja_credite';
  end if;

  if p_credits is not null and p_credits <> v_depot.credits then
    raise exception 'crediter_depot_pawapay : credits % differents du depot (%)', p_credits, v_depot.credits
      using errcode = '22023';
  end if;

  begin
    update public.users
       set credits = coalesce(credits, 0) + v_depot.credits
     where id = v_depot.user_id;

    if not found then
      raise exception 'crediter_depot_pawapay : utilisateur inconnu %', v_depot.user_id
        using errcode = 'P0002';
    end if;

    insert into public.credit_transactions (user_id, amount, type, reference_id, description)
    values (
      v_depot.user_id, v_depot.credits, 'purchase', p_reference,
      'PawaPay ' || v_depot.pack || ' ' || v_depot.montant::text || ' ' || v_depot.devise
    );

    update public.pawapay_deposits
       set statut = 'credite', credite_le = now()
     where deposit_id = p_deposit_id;

  exception when unique_violation then
    update public.pawapay_deposits
       set statut = 'credite', credite_le = coalesce(credite_le, now())
     where deposit_id = p_deposit_id;
    return 'deja_credite';
  end;

  return 'credite';
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. DROITS
--
-- Meme discipline que `debiter_credits` et `lut_assets_ajouter` :
-- `revoke ... from public` retire l'execution a tout le monde, le
-- proprietaire la garde. En production PostgREST se connecte en `studiio`,
-- qui est aussi le role qui joue les migrations — donc le proprietaire. Le
-- `grant` conditionnel le nomme quand meme, pour le jour ou il ne le serait
-- plus. Jamais a `public`, `anon` ou `authenticated`.
--
-- Table : aucun `grant ... to public`. Le code passe par le role serveur
-- (`supabaseAdmin`). Si le role PostgREST n'est pas proprietaire, lui
-- accorder NOMMEMENT select/insert/update, jamais a `public`.
-- ─────────────────────────────────────────────────────────────────────────
revoke all on function public.crediter_depot_pawapay(uuid, uuid, integer, text) from public;
revoke all on table public.pawapay_deposits from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'studiio') then
    grant execute on function public.crediter_depot_pawapay(uuid, uuid, integer, text) to studiio;
    grant select, insert, update on table public.pawapay_deposits to studiio;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans ce signal, PostgREST ignore la table et la fonction : 404 sur
-- /rpc/crediter_depot_pawapay et « Could not find the table » sur
-- /pawapay_deposits. Procedure complete : tasks/pawapay-migration-runbook.md.
-- ═══════════════════════════════════════════════════════════════════════════
