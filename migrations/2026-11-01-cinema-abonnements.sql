-- ============================================================================
-- CINEMA IA — FORMULES D'ABONNEMENT ET QUOTAS MENSUELS
--
-- ⚠️ NON APPLIQUEE EN PRODUCTION. Preparee localement, testee sur un vrai
--    PostgreSQL 16 (`tests-pg/cinema-abonnements.pg.test.ts`). Rien ne s'en
--    sert tant que le branchement dans la generation n'est pas active.
--
-- CE QUE CA AJOUTE
--   * `cinema_formules` : ce que chaque formule (`plans.key`) inclut. AUCUN prix
--     ici — le prix CHF reste dans `plans`, edite depuis Administration > Tarifs.
--     Aucune ligne n'est inseree : sans ligne, Cinema n'est PAS inclus, et le
--     comportement actuel (generation payee en credits) ne change pas.
--   * `cinema_quota_consommation` : compteurs d'un compte pour UNE periode.
--   * `cinema_quota_journal` : une ligne par reservation, reference UNIQUE par
--     compte (idempotence, meme garantie que `credit_transactions`).
--
-- TROIS PHASES, COMME LE PLAFOND DE DEPENSE (`2026-10-31-cinema-plafond-compte.sql`)
--   1. RESERVER (`reserver_quota_cinema`) AVANT l'appel payant : verrouille la
--      ligne de consommation, verifie films / secondes / budget USD et incremente
--      dans la MEME transaction. Deux generations simultanees ne peuvent pas
--      depasser le quota : la seconde attend le verrou, relit, et est refusee.
--   2. CONFIRMER (`confirmer_quota_cinema`) avec l'issue reelle :
--      'confirmee' (appel parti), 'incertaine' (on ne sait pas : reste comptee),
--      'liberee' (preuve qu'aucun appel facture n'a eu lieu : tout est rendu).
--   3. RECONCILIER : une 'incertaine' peut etre reclassee plus tard.
--
-- DROITS : aucune ouverture a `public`. La migration de moindre privilege
-- (`2026-09-29-postgrest-moindre-privilege.sql`) ouvre les objets FUTURS au seul
-- `service_role` ; les fonctions sont en plus retirees a `public` ci-dessous.
-- (La consigne historique « grant all ... to public » est anterieure a ce
-- durcissement et ne s'applique plus.)
-- ============================================================================

do $$
begin
  if to_regclass('public.users') is null then
    raise exception 'table public.users absente : socle non applique sur ce serveur';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------
create table if not exists public.cinema_formules (
  plan_key            text primary key check (plan_key ~ '^[a-z][a-z0-9_-]{0,31}$'),
  inclus              boolean not null,
  films_par_mois      integer not null check (films_par_mois between 0 and 1000),
  secondes_par_mois   integer not null check (secondes_par_mois between 0 and 360000),
  duree_max_film_s    integer not null check (duree_max_film_s between 0 and 10800),
  qualites            text[]  not null default '{}'
                        check (qualites <@ array['brouillon','standard','cinema']::text[]),
  fonctionnalites     text[]  not null default '{}'
                        check (fonctionnalites <@ array['image_ia','animation_video','voix']::text[]),
  budget_usd_par_mois numeric(10,4) not null check (budget_usd_par_mois between 0 and 1000),
  renouvellement      text not null check (renouvellement in ('periode_abonnement','mois_civil')),
  maj_le              timestamptz not null default now(),
  maj_par             text,
  check (not inclus or (films_par_mois > 0 and secondes_par_mois > 0
                        and duree_max_film_s > 0 and duree_max_film_s <= secondes_par_mois))
);

create table if not exists public.cinema_quota_consommation (
  user_id       uuid not null references public.users(id) on delete cascade,
  periode_debut timestamptz not null,
  periode_fin   timestamptz not null check (periode_fin > periode_debut),
  films         integer not null default 0 check (films >= 0),
  secondes      integer not null default 0 check (secondes >= 0),
  usd_engages   numeric(10,4) not null default 0 check (usd_engages >= 0),
  tentatives    integer not null default 0 check (tentatives >= 0),
  maj_le        timestamptz not null default now(),
  primary key (user_id, periode_debut)
);

create table if not exists public.cinema_quota_journal (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  reference     text not null,
  periode_debut timestamptz not null,
  film_id       text not null,
  -- 'generation' : un appel fournisseur payant (budget USD, eventuellement un film et
  --                des minutes PREVUES) ;
  -- 'production' : le rendu du film final, gratuit, qui REGLE les minutes sur la duree
  --                reellement produite (ajustement signe : negatif si plus court).
  type          text not null default 'generation' check (type in ('generation','production')),
  nouveau_film  boolean not null,
  secondes      integer not null,
  usd           numeric(10,4) not null,
  duree_produite integer check (duree_produite is null or duree_produite >= 0),
  statut        text not null check (statut in ('engagee','confirmee','incertaine','liberee')),
  cree_le       timestamptz not null default now(),
  maj_le        timestamptz not null default now(),
  check ((type = 'generation' and usd > 0 and secondes >= 0)
      or (type = 'production' and usd = 0 and not nouveau_film))
);

create unique index if not exists cinema_quota_journal_reference_unique
  on public.cinema_quota_journal (user_id, reference);
create index if not exists cinema_quota_journal_film_idx
  on public.cinema_quota_journal (user_id, periode_debut, film_id);
create index if not exists cinema_quota_journal_incertaine_idx
  on public.cinema_quota_journal (statut) where statut = 'incertaine';

-- ---------------------------------------------------------------------------
-- 2. RESERVER — verrouille, verifie, incremente
-- ---------------------------------------------------------------------------
create or replace function public.reserver_quota_cinema(
  p_user_id       uuid,
  p_periode_debut timestamptz,
  p_periode_fin   timestamptz,
  p_reference     text,
  p_film_id       text,
  -- Duree TOTALE du film apres l'operation. La fonction en deduit elle-meme, sous le
  -- verrou, les secondes a AJOUTER (allongement d'un film deja compte) : jamais l'appelant.
  p_duree_film_s  integer,
  p_usd           numeric,
  p_max_films     integer,
  p_max_secondes  integer,
  p_max_usd       numeric
)
returns table (ok boolean, motif text, deja_reservee boolean, films integer, secondes integer, usd_engages numeric)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  c          public.cinema_quota_consommation%rowtype;
  v_nouveau  boolean;
  v_secondes integer;
begin
  if p_reference is null or length(btrim(p_reference)) = 0 then
    return query select false, 'reference_absente'::text, false, 0, 0, 0::numeric; return;
  end if;
  if p_film_id is null or length(btrim(p_film_id)) = 0 then
    return query select false, 'film_absent'::text, false, 0, 0, 0::numeric; return;
  end if;
  if p_duree_film_s is null or p_duree_film_s <= 0 then
    return query select false, 'secondes_invalides'::text, false, 0, 0, 0::numeric; return;
  end if;
  -- Une operation connue coute au pire quelques dixiemes de dollar : un montant
  -- superieur a 5 $ est une erreur de code, jamais une reservation legitime.
  if p_usd is null or p_usd <= 0 or p_usd > 5 then
    return query select false, 'montant_invalide'::text, false, 0, 0, 0::numeric; return;
  end if;
  if p_periode_debut is null or p_periode_fin is null or p_periode_fin <= p_periode_debut
     or now() < p_periode_debut or now() >= p_periode_fin then
    return query select false, 'periode_invalide'::text, false, 0, 0, 0::numeric; return;
  end if;
  if p_max_films is null or p_max_films < 0 or p_max_secondes is null or p_max_secondes < 0
     or p_max_usd is null or p_max_usd < 0 then
    return query select false, 'limites_invalides'::text, false, 0, 0, 0::numeric; return;
  end if;

  insert into public.cinema_quota_consommation (user_id, periode_debut, periode_fin)
    values (p_user_id, p_periode_debut, p_periode_fin)
    on conflict (user_id, periode_debut) do nothing;

  -- LE VERROU D'ABORD, toutes les lectures ensuite : une reservation concurrente du
  -- meme compte attend ici, puis relit des compteurs a jour.
  select * into c from public.cinema_quota_consommation
   where user_id = p_user_id and periode_debut = p_periode_debut
   for update;

  -- Idempotence : la MEME reference ne reserve jamais deux fois. Une reference deja
  -- liberee n'est pas « reservee » : la rejouer est refuse, jamais confirme a tort.
  if exists (select 1 from public.cinema_quota_journal j
              where j.user_id = p_user_id and j.reference = p_reference) then
    if exists (select 1 from public.cinema_quota_journal j
                where j.user_id = p_user_id and j.reference = p_reference and j.statut = 'liberee') then
      return query select false, 'reference_liberee'::text, true, c.films, c.secondes, c.usd_engages; return;
    end if;
    return query select true, null::text, true, c.films, c.secondes, c.usd_engages; return;
  end if;

  -- Un film est « compte » tant qu'une de ses reservations non liberees le porte.
  v_nouveau := not exists (
    select 1 from public.cinema_quota_journal j
     where j.user_id = p_user_id and j.periode_debut = p_periode_debut and j.type = 'generation'
       and j.film_id = p_film_id and j.nouveau_film and j.statut <> 'liberee');

  -- Secondes deja comptees pour CE film dans la periode (generations ET ajustements de
  -- production) : seule la difference compte. Un film raccourci ne rend rien ICI — c'est
  -- la production, sur la duree reellement produite, qui rend l'excedent.
  v_secondes := greatest(0, p_duree_film_s - coalesce((
    select sum(j.secondes) from public.cinema_quota_journal j
     where j.user_id = p_user_id and j.periode_debut = p_periode_debut
       and j.film_id = p_film_id and j.statut <> 'liberee'), 0))::integer;

  if c.films + (case when v_nouveau then 1 else 0 end) > p_max_films then
    return query select false, 'films_epuises'::text, false, c.films, c.secondes, c.usd_engages; return;
  end if;
  if c.secondes + v_secondes > p_max_secondes then
    return query select false, 'minutes_epuisees'::text, false, c.films, c.secondes, c.usd_engages; return;
  end if;
  if c.usd_engages + p_usd > p_max_usd then
    return query select false, 'budget_fournisseur_atteint'::text, false, c.films, c.secondes, c.usd_engages; return;
  end if;

  insert into public.cinema_quota_journal
    (user_id, reference, periode_debut, film_id, nouveau_film, secondes, usd, statut)
    values (p_user_id, p_reference, p_periode_debut, p_film_id, v_nouveau, v_secondes, p_usd, 'engagee');

  update public.cinema_quota_consommation q
     set films       = q.films + (case when v_nouveau then 1 else 0 end),
         secondes    = q.secondes + v_secondes,
         usd_engages = q.usd_engages + p_usd,
         tentatives  = q.tentatives + 1,
         maj_le      = now()
   where q.user_id = p_user_id and q.periode_debut = p_periode_debut
  returning * into c;

  return query select true, null::text, false, c.films, c.secondes, c.usd_engages;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. CONFIRMER / LIBERER / RECONCILIER
-- ---------------------------------------------------------------------------
create or replace function public.confirmer_quota_cinema(
  p_user_id   uuid,
  p_reference text,
  p_statut    text
)
returns table (ok boolean, motif text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  j        public.cinema_quota_journal%rowtype;
  v_heir   uuid;
begin
  if p_statut is null or p_statut not in ('confirmee','incertaine','liberee') then
    return query select false, 'statut_invalide'::text; return;
  end if;

  select * into j from public.cinema_quota_journal
   where user_id = p_user_id and reference = p_reference;
  if not found then
    return query select false, 'reference_absente'::text; return;
  end if;

  -- Meme verrou que la reservation : une liberation ne croise jamais une reservation.
  perform 1 from public.cinema_quota_consommation
   where user_id = p_user_id and periode_debut = j.periode_debut for update;

  -- Relue SOUS le verrou : deux confirmations simultanees ne liberent pas deux fois.
  select * into j from public.cinema_quota_journal
   where user_id = p_user_id and reference = p_reference;

  if j.statut in ('confirmee','liberee') then
    -- Finalisee : un rejeu identique est sans effet, un changement est refuse.
    if j.statut = p_statut then return query select true, null::text; return; end if;
    return query select false, 'deja_finalisee'::text; return;
  end if;

  if p_statut <> 'liberee' then
    update public.cinema_quota_journal set statut = p_statut, maj_le = now() where id = j.id;
    return query select true, null::text; return;
  end if;

  -- LIBERATION D'UNE PRODUCTION (rendu non abouti, gratuit) : l'ajustement signe est
  -- annule, rien d'autre.
  if j.type = 'production' then
    update public.cinema_quota_consommation q
       set secondes = greatest(0, q.secondes - j.secondes), maj_le = now()
     where q.user_id = p_user_id and q.periode_debut = j.periode_debut;
    update public.cinema_quota_journal set statut = 'liberee', secondes = 0, maj_le = now() where id = j.id;
    return query select true, null::text; return;
  end if;

  -- LIBERATION D'UNE GENERATION : on rend ce que CETTE reservation a ajoute. Si elle
  -- portait le film (nouveau_film) et qu'une autre generation active du meme film existe,
  -- le film et ses secondes lui sont TRANSMIS : le film reste compte tant qu'il est utilise.
  v_heir := null;
  if j.nouveau_film then
    select id into v_heir from public.cinema_quota_journal
     where user_id = p_user_id and periode_debut = j.periode_debut and film_id = j.film_id
       and id <> j.id and statut <> 'liberee' and type = 'generation'
     order by cree_le, id limit 1;
  end if;

  if v_heir is not null then
    update public.cinema_quota_journal
       set nouveau_film = true, secondes = secondes + j.secondes, maj_le = now()
     where id = v_heir;
    update public.cinema_quota_consommation q
       set usd_engages = greatest(0, q.usd_engages - j.usd),
           tentatives  = greatest(0, q.tentatives - 1),
           maj_le = now()
     where q.user_id = p_user_id and q.periode_debut = j.periode_debut;
  else
    update public.cinema_quota_consommation q
       set films       = greatest(0, q.films - (case when j.nouveau_film then 1 else 0 end)),
           secondes    = greatest(0, q.secondes - j.secondes),
           usd_engages = greatest(0, q.usd_engages - j.usd),
           tentatives  = greatest(0, q.tentatives - 1),
           maj_le = now()
     where q.user_id = p_user_id and q.periode_debut = j.periode_debut;
  end if;

  update public.cinema_quota_journal
     set statut = 'liberee', nouveau_film = false, secondes = 0, maj_le = now()
   where id = j.id;

  return query select true, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3 bis. PRODUCTION — les minutes REELLEMENT produites
--
-- Les generations reservent des minutes PREVUES (duree du projet au moment de
-- l'appel). Le rendu du film final, lui, connait la duree REELLE. Il :
--   1. RESERVE avant de rendre : la cible est max(duree prevue du rendu, plus longue
--      duree deja produite de ce film dans la periode) — un film deja livre ne
--      « rend » jamais des minutes en etant raccourci. L'ajustement est SIGNE :
--      positif (refuse s'il depasse le quota), negatif (excedent prevu rendu) ;
--   2. FINALISE a la duree reellement mesuree, SANS jamais depasser ce qu'il a
--      reserve ;
--   3. est LIBERE si le rendu n'aboutit pas (rien n'a ete produit ni facture).
-- Un film qui n'a consomme AUCUNE generation dans la periode n'est pas concerne :
-- le rendu local reste libre, comme hors abonnement.
-- ---------------------------------------------------------------------------
create or replace function public.reserver_production_cinema(
  p_user_id       uuid,
  p_periode_debut timestamptz,
  p_reference     text,
  p_film_id       text,
  p_duree_s       integer,
  p_max_secondes  integer
)
returns table (ok boolean, motif text, concerne boolean, ajustement integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  c         public.cinema_quota_consommation%rowtype;
  v_base    integer;
  v_max     integer;
  v_cible   integer;
  v_delta   integer;
  v_exist   public.cinema_quota_journal%rowtype;
begin
  if p_reference is null or length(btrim(p_reference)) = 0 or p_film_id is null
     or p_duree_s is null or p_duree_s < 0 or p_max_secondes is null or p_max_secondes < 0 then
    return query select false, 'demande_invalide'::text, false, 0; return;
  end if;

  select * into c from public.cinema_quota_consommation
   where user_id = p_user_id and periode_debut = p_periode_debut for update;
  if not found then
    -- Aucune generation dans la periode : rien a regler.
    return query select true, null::text, false, 0; return;
  end if;

  select * into v_exist from public.cinema_quota_journal
   where user_id = p_user_id and reference = p_reference;
  if found then
    if v_exist.statut = 'liberee' then return query select false, 'reference_liberee'::text, true, 0; return; end if;
    return query select true, null::text, true, v_exist.secondes; return;
  end if;

  if not exists (select 1 from public.cinema_quota_journal j
                  where j.user_id = p_user_id and j.periode_debut = p_periode_debut
                    and j.film_id = p_film_id and j.type = 'generation' and j.statut <> 'liberee') then
    return query select true, null::text, false, 0; return;
  end if;

  select coalesce(sum(j.secondes), 0) into v_base from public.cinema_quota_journal j
   where j.user_id = p_user_id and j.periode_debut = p_periode_debut
     and j.film_id = p_film_id and j.statut <> 'liberee';
  select coalesce(max(j.duree_produite), 0) into v_max from public.cinema_quota_journal j
   where j.user_id = p_user_id and j.periode_debut = p_periode_debut
     and j.film_id = p_film_id and j.type = 'production' and j.statut = 'confirmee';

  v_cible := greatest(p_duree_s, v_max);
  v_delta := v_cible - v_base;
  if v_delta > 0 and c.secondes + v_delta > p_max_secondes then
    return query select false, 'minutes_epuisees'::text, true, 0; return;
  end if;

  insert into public.cinema_quota_journal
    (user_id, reference, periode_debut, film_id, type, nouveau_film, secondes, usd, statut)
    values (p_user_id, p_reference, p_periode_debut, p_film_id, 'production', false, v_delta, 0, 'engagee');
  update public.cinema_quota_consommation q
     set secondes = greatest(0, q.secondes + v_delta), maj_le = now()
   where q.user_id = p_user_id and q.periode_debut = p_periode_debut;

  return query select true, null::text, true, v_delta;
end;
$$;

create or replace function public.finaliser_production_cinema(
  p_user_id       uuid,
  p_reference     text,
  p_duree_reelle  integer
)
returns table (ok boolean, motif text, ajustement integer)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  j        public.cinema_quota_journal%rowtype;
  v_base   integer;
  v_max    integer;
  v_delta  integer;
begin
  if p_duree_reelle is null or p_duree_reelle < 0 then
    return query select false, 'demande_invalide'::text, 0; return;
  end if;
  select * into j from public.cinema_quota_journal where user_id = p_user_id and reference = p_reference;
  if not found or j.type <> 'production' then
    return query select false, 'reference_absente'::text, 0; return;
  end if;
  perform 1 from public.cinema_quota_consommation
   where user_id = p_user_id and periode_debut = j.periode_debut for update;
  select * into j from public.cinema_quota_journal where id = j.id;
  if j.statut = 'confirmee' then return query select true, null::text, j.secondes; return; end if;
  if j.statut = 'liberee' then return query select false, 'deja_finalisee'::text, 0; return; end if;

  select coalesce(sum(x.secondes), 0) into v_base from public.cinema_quota_journal x
   where x.user_id = p_user_id and x.periode_debut = j.periode_debut
     and x.film_id = j.film_id and x.statut <> 'liberee' and x.id <> j.id;
  select coalesce(max(x.duree_produite), 0) into v_max from public.cinema_quota_journal x
   where x.user_id = p_user_id and x.periode_debut = j.periode_debut and x.film_id = j.film_id
     and x.type = 'production' and x.statut = 'confirmee' and x.id <> j.id;

  -- Jamais plus que reserve avant le rendu : la finalisation ne peut que RENDRE.
  v_delta := least(j.secondes, greatest(p_duree_reelle, v_max) - v_base);

  update public.cinema_quota_consommation q
     set secondes = greatest(0, q.secondes + (v_delta - j.secondes)), maj_le = now()
   where q.user_id = p_user_id and q.periode_debut = j.periode_debut;
  update public.cinema_quota_journal
     set secondes = v_delta, duree_produite = p_duree_reelle, statut = 'confirmee', maj_le = now()
   where id = j.id;
  return query select true, null::text, v_delta;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. DROITS
-- ---------------------------------------------------------------------------
revoke all on function public.reserver_production_cinema(uuid, timestamptz, text, text, integer, integer) from public;
revoke all on function public.finaliser_production_cinema(uuid, text, integer) from public;
revoke all on function public.reserver_quota_cinema(
  uuid, timestamptz, timestamptz, text, text, integer, numeric, integer, integer, numeric) from public;
revoke all on function public.confirmer_quota_cinema(uuid, text, text) from public;

-- ---------------------------------------------------------------------------
-- 5. APRES APPLICATION
--   docker kill -s SIGUSR1 studiio-postgrest
-- CONTROLES (lecture seule) :
--   select count(*) from public.cinema_formules;   -- attendu : 0 (rien d'inclus)
--   select has_function_privilege('public',
--     'public.reserver_quota_cinema(uuid,timestamptz,timestamptz,text,text,integer,numeric,integer,integer,numeric)',
--     'EXECUTE');                                   -- attendu : false
-- ---------------------------------------------------------------------------
