-- ═══════════════════════════════════════════════════════════════════════════
-- RENDUS : LA PREUVE SERVEUR QU'UN MONTAGE A ETE PRODUIT
--
-- ⚠️ TANT QU'ELLE N'EST PAS APPLIQUEE
--
-- `POST /api/render/jobs` repond 503 et les quatre parcours factures
-- (apercu, telechargement, et les deux exports de l'editeur avance) refusent
-- de composer. Rien n'est facture a tort — mais rien n'est produit non plus.
-- A appliquer AVANT de deployer le code qui l'utilise.
--
-- Depend de `2026-08-27-credits-atomiques.sql` (table `tarifs_rendu`).
--
-- ─────────────────────────────────────────────────────────────────────────
-- POURQUOI CETTE TABLE EXISTE
-- ─────────────────────────────────────────────────────────────────────────
--
-- Le debit etait devenu atomique et idempotent, mais il restait suspendu dans
-- le vide : rien ne reliait un credit retire a un travail reellement produit.
-- Le montage est compose DANS le navigateur et televerse directement dans
-- MinIO — l'application n'est jamais dans le chemin de la requete. Le serveur
-- ne voyait donc passer qu'une autorisation d'ecriture, une chaine d'URL et
-- un nombre. Un `curl` pouvait enchainer les trois.
--
-- Une ligne de cette table EST la tentative de rendu. Elle porte tout ce que
-- le navigateur n'a plus le droit de choisir : l'utilisateur, le format, le
-- cout, et surtout la CLE DE STOCKAGE. Le serveur n'ira verifier que cette
-- cle-la, celle qu'il a lui-meme attribuee — jamais une URL soufflee par le
-- client.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LES ETATS
-- ─────────────────────────────────────────────────────────────────────────
--
--   reserved  -> la tentative est ouverte, rien n'est facture
--   confirmed -> l'objet a ete VU par le serveur, et les credits retires
--   cancelled -> abandon propre (composition ou televersement echoue)
--   failed    -> l'objet attendu etait absent ou invalide
--
-- Seul `reserved -> confirmed` debite, et il ne peut se produire qu'une fois :
-- c'est la clause `where etat = 'reserved'` qui l'y oblige, pas une garde
-- applicative.
--
-- Additive : aucune table existante n'est modifiee, aucune donnee touchee.
-- `render_jobs` (2026, ere Supabase) n'est PAS reutilisee — son `check` de
-- statut porte d'autres valeurs et deux routes mortes l'ecrivent encore.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.rendus (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,

  -- Quel parcours a ouvert la tentative. Sert au diagnostic et laisse la
  -- porte ouverte a une tarification par operation.
  operation     text not null check (operation in (
                  'apercu', 'bureau', 'calendrier', 'avance-brouillon', 'avance-bureau'
                )),

  -- Le format decide du prix. La FK garantit qu'aucun format hors tarif
  -- n'entre : un format inconnu ne peut pas creer une tentative gratuite.
  format        text not null references public.tarifs_rendu(format),

  -- Cout FIGE a la reservation, depuis `tarifs_rendu`. Le releve ici rend le
  -- prix verifiable apres coup, meme si le tarif change entre-temps.
  cout          integer not null check (cout >= 0),

  -- Cle attribuee par le SERVEUR. Unique : deux tentatives ne peuvent pas
  -- viser le meme objet, donc pas se confirmer l'une avec le fichier de
  -- l'autre.
  bucket        text not null,
  cle_objet     text not null unique,

  etat          text not null default 'reserved'
                  check (etat in ('reserved', 'confirmed', 'cancelled', 'failed')),

  -- Renseignes a la confirmation, depuis ce que le serveur a REELLEMENT vu.
  taille_octets bigint,
  content_type  text,
  motif_echec   text,

  transaction_id uuid references public.credit_transactions(id) on delete set null,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists rendus_user_idx on public.rendus (user_id, created_at desc);
create index if not exists rendus_etat_idx on public.rendus (etat);

-- ─────────────────────────────────────────────────────────────────────────
-- CONFIRMER : l'unique porte par laquelle un credit peut partir
--
-- Tout tient dans une transaction. Trois choses doivent reussir ou echouer
-- ENSEMBLE : le passage a `confirmed`, le retrait du solde, la ligne de
-- journal. Aucun etat intermediaire n'est observable.
--
-- La serialisation ne vient pas d'un verrou pris a la main mais de la clause
-- `where etat = 'reserved'` : deux transitions concurrentes se disputent la
-- meme ligne, la seconde attend, puis relit une ligne qui ne correspond plus.
--
-- Cette clause est le VERROU DE TRANSITION, et pas une optimisation : c'est
-- elle, et elle seule, qui empeche de confirmer une tentative qu'une
-- annulation concurrente vient de fermer. L'index unique sur
-- `credit_transactions`, lui, empeche un SECOND debit d'une meme reference —
-- il ne dit rien du PREMIER debit d'un travail deja clos. Les deux protections
-- sont distinctes et aucune ne remplace l'autre.
--
-- Le solde insuffisant leve une exception VOLONTAIRE : c'est le seul moyen,
-- en plpgsql, de defaire le passage a `confirmed` deja ecrit plus haut dans
-- le meme bloc. Sans elle, la tentative resterait confirmee sans avoir ete
-- payee — exactement l'inverse de ce qu'on cherche.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.confirmer_rendu(
  p_user_id      uuid,
  p_rendu_id     uuid,
  p_taille       bigint,
  p_content_type text
)
returns table (ok boolean, etat text, solde integer, deja_confirme boolean, motif text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_etat  text;
  v_cout  integer;
  v_solde integer;
  v_tx    uuid;
begin
  select r.etat into v_etat
    from public.rendus r
   where r.id = p_rendu_id and r.user_id = p_user_id;

  if not found then
    -- Tentative inconnue OU appartenant a quelqu'un d'autre : meme reponse.
    -- Distinguer les deux revelerait l'existence d'une ligne d'autrui.
    return query select false, null::text, 0, false, 'rendu_inconnu'::text;
    return;
  end if;

  if v_etat = 'confirmed' then
    select u.credits into v_solde from public.users u where u.id = p_user_id;
    return query select true, 'confirmed'::text, v_solde, true, null::text;
    return;
  end if;

  if v_etat <> 'reserved' then
    select u.credits into v_solde from public.users u where u.id = p_user_id;
    return query select false, v_etat, v_solde, false, 'rendu_clos'::text;
    return;
  end if;

  begin
    update public.rendus r
       set etat = 'confirmed',
           taille_octets = p_taille,
           content_type = p_content_type,
           updated_at = now()
     where r.id = p_rendu_id and r.user_id = p_user_id and r.etat = 'reserved'
     returning r.cout into v_cout;

    if not found then
      -- La ligne a change d'etat pendant qu'on attendait le verrou. On RELIT
      -- pour savoir lequel : conclure « quelqu'un d'autre l'a confirmee »
      -- serait faux si c'est une ANNULATION qui a gagne la course — on
      -- repondrait « confirme » sur une tentative jamais payee, et l'ecran
      -- livrerait le montage gratuitement.
      select r.etat into v_etat from public.rendus r where r.id = p_rendu_id;
      select u.credits into v_solde from public.users u where u.id = p_user_id;
      if v_etat = 'confirmed' then
        return query select true, 'confirmed'::text, v_solde, true, null::text;
      else
        return query select false, v_etat, v_solde, false, 'rendu_clos'::text;
      end if;
      return;
    end if;

    update public.users u
       set credits = u.credits - v_cout
     where u.id = p_user_id and u.credits >= v_cout
     returning u.credits into v_solde;

    if not found then
      -- Volontaire : defait le passage a `confirmed` en remontant au
      -- savepoint de ce bloc.
      raise exception 'solde insuffisant' using errcode = 'P0001';
    end if;

    insert into public.credit_transactions (user_id, amount, type, reference_id, description)
    values (p_user_id, -v_cout, 'render', 'rendu:job:' || p_rendu_id::text,
            'rendu confirme ' || p_rendu_id::text)
    returning id into v_tx;

    update public.rendus r set transaction_id = v_tx where r.id = p_rendu_id;

  exception
    when sqlstate 'P0001' then
      select u.credits into v_solde from public.users u where u.id = p_user_id;
      return query select false, 'reserved'::text, v_solde, false, 'solde_insuffisant'::text;
      return;
    when unique_violation then
      -- Le journal portait deja cette reference : le debit a eu lieu.
      select u.credits into v_solde from public.users u where u.id = p_user_id;
      return query select true, 'confirmed'::text, v_solde, true, null::text;
      return;
  end;

  return query select true, 'confirmed'::text, v_solde, false, null::text;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- CLORE : abandon propre, sans le moindre debit
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.clore_rendu(
  p_user_id  uuid,
  p_rendu_id uuid,
  p_etat     text,
  p_motif    text
)
returns table (ok boolean, etat text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_etat text;
begin
  if p_etat not in ('cancelled', 'failed') then
    return query select false, null::text;
    return;
  end if;

  -- `where etat = 'reserved'` : une tentative confirmee ne se referme pas.
  -- Sans cette clause, on pourrait annuler apres coup un rendu deja paye et
  -- livre.
  update public.rendus r
     set etat = p_etat, motif_echec = p_motif, updated_at = now()
   where r.id = p_rendu_id and r.user_id = p_user_id and r.etat = 'reserved'
   returning r.etat into v_etat;

  if not found then
    select r.etat into v_etat from public.rendus r
     where r.id = p_rendu_id and r.user_id = p_user_id;
    return query select false, v_etat;
    return;
  end if;

  return query select true, v_etat;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- DROITS
--
-- Ces deux fonctions deplacent de l'argent : l'execution est retiree a tous.
-- La table, elle, suit la convention du depot pour que PostgREST la voie.
-- ─────────────────────────────────────────────────────────────────────────
revoke all on function public.confirmer_rendu(uuid, uuid, bigint, text) from public;
revoke all on function public.clore_rendu(uuid, uuid, text, text) from public;

grant all on table public.rendus to public;

-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- CONTROLES PREALABLES :
--   select to_regclass('public.tarifs_rendu');   -- doit exister (migration du 27)
--   select to_regclass('public.rendus');         -- attendu : null
--
-- CONTROLES POSTERIEURS :
--   select format, credits from public.tarifs_rendu order by format;  -- reel|10, tv|15
--   select count(*) from public.rendus;                               -- 0
--   select has_function_privilege('public','public.confirmer_rendu(uuid,uuid,bigint,text)','EXECUTE');
--     -- attendu : false
-- ═══════════════════════════════════════════════════════════════════════════
