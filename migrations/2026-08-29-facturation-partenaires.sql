-- ============================================================================
-- FACTURATION DIFFERENCIEE : CREDITS OU FRAIS PARTENAIRES
--
-- ⚠️ TANT QU'ELLE N'EST PAS APPLIQUEE
--
-- `confirmer_rendu_sans_debit` n'existe pas : la confirmation d'un rendu
-- administrateur repond 503 et le montage n'est pas delivre. Aucun credit
-- n'est preleve a tort -- mais l'administrateur ne peut rien produire.
-- A appliquer AVANT de deployer le code qui l'utilise.
--
-- Depend de `2026-08-28-rendus-preuve-serveur.sql` (table `rendus`).
--
-- ----------------------------------------------------------------------------
-- POURQUOI UNE MIGRATION ICI
-- ----------------------------------------------------------------------------
--
-- `confirmer_rendu` fait DEUX choses indissociables : la transition d'etat et
-- le debit. Un administrateur a besoin de la premiere sans la seconde -- la
-- preuve serveur du rendu doit etre identique pour tout le monde, seul le
-- paiement differe.
--
-- Refaire la transition d'etat en TypeScript aurait sorti la regle du moteur,
-- qui est precisement ce qui la rend fiable. On ajoute donc une seconde
-- fonction, avec la MEME machine a etats et aucune ligne touchant aux credits.
--
-- ----------------------------------------------------------------------------
-- LE COUT PARTENAIRE N'EST JAMAIS INVENTE
-- ----------------------------------------------------------------------------
--
-- `cout_partenaire` est NULLABLE, et `NULL` veut dire INDISPONIBLE. Ecrire 0
-- se relirait plus tard comme « cette operation n'a rien coute », alors qu'elle
-- signifie « le partenaire ne nous a pas dit combien ». La facture du
-- partenaire reste la source de verite.
--
-- Additive et rejouable : aucune donnee existante n'est lue, corrigee ni
-- reecrite.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CE QUE LA TENTATIVE RETIENT DE SA FACTURATION
-- ----------------------------------------------------------------------------

-- Fige a la RESERVATION, depuis le role lu en base. La releve ici rend la
-- decision verifiable apres coup, meme si le role change entre-temps.
alter table public.rendus
  add column if not exists politique text not null default 'credits';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'rendus_politique_connue'
       and conrelid = 'public.rendus'::regclass
  ) then
    alter table public.rendus
      add constraint rendus_politique_connue
      check (politique in ('credits', 'partner_cost_only'));
  end if;
end $$;

alter table public.rendus
  add column if not exists partenaire            text,
  add column if not exists operation_partenaire  text,
  -- NULL = indisponible. JAMAIS 0 estime.
  add column if not exists cout_partenaire       numeric(12,4);

create index if not exists rendus_politique_idx on public.rendus (politique);

-- ----------------------------------------------------------------------------
-- 2. CONFIRMER SANS DEBITER
--
-- Meme machine a etats que `confirmer_rendu` : la clause
-- `where etat = 'reserved'` est le verrou de transition, et elle seule
-- garantit qu'une tentative deja close ne peut pas etre confirmee.
--
-- Aucune ligne de cette fonction ne touche `users.credits` ni
-- `credit_transactions`. C'est verifiable a la lecture, et c'est teste.
-- ----------------------------------------------------------------------------
create or replace function public.confirmer_rendu_sans_debit(
  p_user_id             uuid,
  p_rendu_id            uuid,
  p_taille              bigint,
  p_content_type        text,
  p_partenaire          text,
  p_operation_partenaire text,
  p_cout_partenaire     numeric
)
returns table (ok boolean, etat text, deja_confirme boolean, motif text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_etat text;
begin
  select r.etat into v_etat
    from public.rendus r
   where r.id = p_rendu_id and r.user_id = p_user_id;

  if not found then
    -- Inconnue OU appartenant a autrui : meme reponse. Distinguer les deux
    -- revelerait l'existence d'une tentative d'un tiers.
    return query select false, null::text, false, 'rendu_inconnu'::text;
    return;
  end if;

  if v_etat = 'confirmed' then
    return query select true, 'confirmed'::text, true, null::text;
    return;
  end if;

  if v_etat <> 'reserved' then
    return query select false, v_etat, false, 'rendu_clos'::text;
    return;
  end if;

  update public.rendus r
     set etat                 = 'confirmed',
         taille_octets        = p_taille,
         content_type         = p_content_type,
         politique            = 'partner_cost_only',
         partenaire           = p_partenaire,
         operation_partenaire = p_operation_partenaire,
         cout_partenaire      = p_cout_partenaire,
         updated_at           = now()
   where r.id = p_rendu_id and r.user_id = p_user_id and r.etat = 'reserved';

  if not found then
    -- L'etat a change pendant qu'on attendait le verrou. On RELIT pour savoir
    -- lequel : conclure « deja confirmee » serait faux si une ANNULATION a
    -- gagne la course, et l'ecran livrerait un montage jamais confirme.
    select r.etat into v_etat from public.rendus r where r.id = p_rendu_id;
    if v_etat = 'confirmed' then
      return query select true, 'confirmed'::text, true, null::text;
    else
      return query select false, v_etat, false, 'rendu_clos'::text;
    end if;
    return;
  end if;

  return query select true, 'confirmed'::text, false, null::text;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. DROITS
--
-- Cette fonction ne deplace pas d'argent, mais elle marque un rendu comme
-- livre sans paiement : elle est fermee comme les autres.
-- ----------------------------------------------------------------------------
revoke all on function public.confirmer_rendu_sans_debit(uuid, uuid, bigint, text, text, text, numeric) from public;

-- ============================================================================
-- ⚠️ APRES CETTE MIGRATION -- ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- CONTROLES PREALABLES :
--   select to_regclass('public.rendus');                 -- doit exister
--   select count(*) from public.rendus;                  -- pour information
--
-- CONTROLES POSTERIEURS :
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema='public' and table_name='rendus'
--      and column_name in ('politique','partenaire','operation_partenaire','cout_partenaire');
--   select conname from pg_constraint where conname = 'rendus_politique_connue';
--   select has_function_privilege('public',
--     'public.confirmer_rendu_sans_debit(uuid,uuid,bigint,text,text,text,numeric)','EXECUTE');
--     -- attendu : false
-- ============================================================================
