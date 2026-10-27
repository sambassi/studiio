-- ============================================================================
-- CINEMA IA — PLAFOND DE DEPENSE REELLE, PAR COMPTE ET GLOBAL
--
-- ⚠️ NON APPLIQUEE EN PRODUCTION. A appliquer puis recharger PostgREST
--    (SIGUSR1) avant toute activation de CINEMA_GENERATION_REELLE a grande
--    echelle — exactement la meme discipline que les migrations credits et
--    remboursement qui precedent.
--
-- ---------------------------------------------------------------------------
-- CE QUE CA CORRIGE
-- ---------------------------------------------------------------------------
--
-- Le SEUL garde-fou de depense existant (`generation/couts.ts`,
-- `verifierPlafond`) vit sur le FILM : `film.coutGenerationUsd`, un champ du
-- document JSON. Supprimer puis recreer un film remet ce compteur a zero —
-- documente des l'origine comme « un garde-fou local, pas un budget »
-- (`generation/credits.ts`, en-tete).
--
-- Ce fichier ajoute un DEUXIEME niveau, durable, qui ne vit PAS sur le film :
--
--   * un compteur PAR COMPTE (`cinema_depenses_comptes`), qui survit a la
--     creation et a la suppression de n'importe quel film ;
--   * un compteur GLOBAL (`cinema_depenses_globales`, ligne unique), filet de
--     securite tous comptes confondus ;
--   * un JOURNAL (`cinema_depenses_journal`) avec une reference UNIQUE par
--     tentative, pour la tracabilite et l'idempotence — meme garantie que
--     `credit_transactions.reference_id`.
--
-- ---------------------------------------------------------------------------
-- TROIS PHASES, COMME LE DEBIT/REMBOURSEMENT DE CREDITS
-- ---------------------------------------------------------------------------
--
--   1. RESERVER (`reserver_depense_cinema`) — AVANT l'appel fournisseur :
--      verifie ET incremente ATOMIQUEMENT les deux compteurs (compte et
--      global) dans la MEME transaction ; refuse si l'un des deux plafonds
--      serait depasse, SANS rien ecrire dans ce cas.
--   2. CONFIRMER (`confirmer_depense_cinema`) — APRES l'appel, avec l'issue
--      REELLE :
--        - 'confirmee' : l'appel a eu lieu (succes ou echec APRES reponse du
--          fournisseur) — la depense reste comptee, montant inchange ;
--        - 'incertaine' : le delai a expire pendant l'appel — on NE SAIT PAS
--          si le fournisseur a quand meme demarre et facture. Reste comptee
--          (jamais sous-compter) jusqu'a reconciliation ;
--        - 'liberee' : la preuve existe qu'aucun appel n'est jamais parti
--          (ex. validation locale refusee avant tout reseau) — les deux
--          compteurs sont DECREMENTES du montant reserve.
--   3. RECONCILIER — une 'incertaine' peut etre reclassee plus tard
--      ('confirmee' ou 'liberee') via un second appel a
--      `confirmer_depense_cinema` : aucune fonction separee, meme garde
--      d'idempotence.
--
-- Idempotence : une MEME reference ne reserve, ni ne confirme, qu'une fois —
-- index unique `(user_id, reference)` sur le journal, meme principe que
-- `credit_transactions_reference_unique`.
--
-- ---------------------------------------------------------------------------
-- CE QUI RESTE HORS PERIMETRE (assume, a traiter avant ouverture large)
-- ---------------------------------------------------------------------------
--
--   * Aucune reconciliation AUTOMATIQUE contre l'API Replicate (verifier
--     l'etat reel d'une prediction incertaine) : ce fichier fournit la
--     fonction qui ACCUEILLE un resultat reconcilié, pas le job qui irait le
--     chercher. A construire separement, sans appel payant.
--   * Aucun ecran d'administration pour lire ou ajuster ces compteurs : les
--     valeurs sont lisibles par requete SQL directe en attendant.
--   * Le plafond global est UNE ligne : toute reservation, de tout compte,
--     se serialise brievement dessus. Acceptable tant que le volume reste
--     faible (le module est ferme par defaut) ; a revisiter si Cinema IA
--     s'ouvre a grande echelle.
-- ============================================================================

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'users') then
    raise exception 'table public.users absente : socle credits non applique sur ce serveur';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. LES TROIS TABLES
-- ---------------------------------------------------------------------------

create table if not exists public.cinema_depenses_comptes (
  user_id          uuid primary key references public.users(id) on delete cascade,
  total_engage_usd numeric(10,4) not null default 0 check (total_engage_usd >= 0),
  maj_le           timestamptz not null default now()
);

-- Ligne UNIQUE, posee ici : aucune reservation ne doit pouvoir en creer une
-- seconde (la fonction verrouille par id, jamais par un `insert` concurrent).
create table if not exists public.cinema_depenses_globales (
  id               text primary key default 'global',
  total_engage_usd numeric(10,4) not null default 0 check (total_engage_usd >= 0),
  maj_le           timestamptz not null default now()
);
insert into public.cinema_depenses_globales (id, total_engage_usd)
  values ('global', 0) on conflict (id) do nothing;

create table if not exists public.cinema_depenses_journal (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  reference   text not null,
  operation   text not null check (operation in ('image','video')),
  montant_usd numeric(10,4) not null check (montant_usd > 0),
  statut      text not null check (statut in ('engagee','confirmee','incertaine','liberee')),
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now()
);

-- Idempotence : une reference ne reserve qu'UNE fois pour un compte donne.
-- Deux comptes peuvent partager la meme reference sans se bloquer (comme
-- `credit_transactions_reference_unique`).
create unique index if not exists cinema_depenses_journal_reference_unique
  on public.cinema_depenses_journal (user_id, reference);
create index if not exists cinema_depenses_journal_user_id_idx
  on public.cinema_depenses_journal (user_id);
create index if not exists cinema_depenses_journal_statut_idx
  on public.cinema_depenses_journal (statut) where statut = 'incertaine';

-- ---------------------------------------------------------------------------
-- 2. RESERVER — verifie ET incremente, atomiquement, les deux compteurs
-- ---------------------------------------------------------------------------
create or replace function public.reserver_depense_cinema(
  p_user_id        uuid,
  p_montant_usd    numeric,
  p_reference      text,
  p_operation      text,
  p_plafond_compte numeric,
  p_plafond_global numeric
)
returns table (
  ok boolean, motif text, deja_engagee boolean,
  total_compte numeric, total_global numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_total_compte numeric;
  v_total_global numeric;
  v_existant     record;
begin
  if p_reference is null or length(btrim(p_reference, E' \t\n\r')) = 0 then
    return query select false, 'reference_absente'::text, false, 0::numeric, 0::numeric;
    return;
  end if;
  if p_montant_usd is null or p_montant_usd <= 0 then
    return query select false, 'montant_invalide'::text, false, 0::numeric, 0::numeric;
    return;
  end if;
  -- Plafond de securite sur le MONTANT lui-meme : une seule operation connue
  -- coute au pire 0,45 $ (video Replicate, 5 s a 0,09 $/s) ; une erreur de
  -- code ne doit jamais proposer une reservation de plusieurs dollars d'un
  -- coup.
  if p_montant_usd > 5 then
    return query select false, 'montant_invalide'::text, false, 0::numeric, 0::numeric;
    return;
  end if;
  if p_operation is null or p_operation not in ('image', 'video') then
    return query select false, 'operation_invalide'::text, false, 0::numeric, 0::numeric;
    return;
  end if;
  if p_plafond_compte is null or p_plafond_compte < 0 or p_plafond_global is null or p_plafond_global < 0 then
    return query select false, 'plafond_invalide'::text, false, 0::numeric, 0::numeric;
    return;
  end if;

  -- Idempotence sequentielle : un rejeu de la MEME reference ne reserve pas
  -- une seconde fois — rend l'etat courant des compteurs, inchange.
  select * into v_existant from public.cinema_depenses_journal
   where user_id = p_user_id and reference = p_reference;
  if found then
    select total_engage_usd into v_total_compte from public.cinema_depenses_comptes where user_id = p_user_id;
    select total_engage_usd into v_total_global from public.cinema_depenses_globales where id = 'global';
    return query select true, null::text, true, coalesce(v_total_compte, 0), coalesce(v_total_global, 0);
    return;
  end if;

  -- Le bloc a EXCEPTION pose un savepoint : si l'insertion du journal heurte
  -- l'index unique (course concurrente gagnee par un autre appel), les deux
  -- increments ci-dessous sont annules — le compte n'a jamais ete touche
  -- deux fois pour la meme reference.
  begin
    -- Verrou + plafond COMPTE. `insert ... on conflict do update` cree la
    -- ligne si absente ET la verrouille dans tous les cas (meme sans
    -- changement reel), ce qui serialise les reservations concurrentes du
    -- MEME compte sur cette ligne.
    insert into public.cinema_depenses_comptes (user_id, total_engage_usd)
      values (p_user_id, 0)
    on conflict (user_id) do update
      set total_engage_usd = public.cinema_depenses_comptes.total_engage_usd
    returning total_engage_usd into v_total_compte;

    if v_total_compte + p_montant_usd > p_plafond_compte then
      select total_engage_usd into v_total_global from public.cinema_depenses_globales where id = 'global';
      return query select false, 'plafond_compte_depasse'::text, false, v_total_compte, coalesce(v_total_global, 0);
      return;
    end if;

    -- Verrou + plafond GLOBAL, meme idiome. Toute reservation de tout
    -- compte se serialise ici : assume (voir en-tete), le module est ferme
    -- par defaut.
    update public.cinema_depenses_globales
       set total_engage_usd = total_engage_usd
     where id = 'global'
    returning total_engage_usd into v_total_global;

    if v_total_global + p_montant_usd > p_plafond_global then
      return query select false, 'plafond_global_depasse'::text, false, v_total_compte, v_total_global;
      return;
    end if;

    -- Les deux plafonds passent : on ecrit, dans l'ORDRE compte -> global ->
    -- journal, toujours dans la MEME transaction.
    update public.cinema_depenses_comptes
       set total_engage_usd = total_engage_usd + p_montant_usd, maj_le = now()
     where user_id = p_user_id
    returning total_engage_usd into v_total_compte;

    update public.cinema_depenses_globales
       set total_engage_usd = total_engage_usd + p_montant_usd, maj_le = now()
     where id = 'global'
    returning total_engage_usd into v_total_global;

    insert into public.cinema_depenses_journal (user_id, reference, operation, montant_usd, statut)
    values (p_user_id, p_reference, p_operation, p_montant_usd, 'engagee');

  exception when unique_violation then
    select total_engage_usd into v_total_compte from public.cinema_depenses_comptes where user_id = p_user_id;
    select total_engage_usd into v_total_global from public.cinema_depenses_globales where id = 'global';
    return query select true, null::text, true, coalesce(v_total_compte, 0), coalesce(v_total_global, 0);
    return;
  end;

  return query select true, null::text, false, v_total_compte, v_total_global;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. CONFIRMER — statut final + ajustement des compteurs par la DIFFERENCE
-- ---------------------------------------------------------------------------
create or replace function public.confirmer_depense_cinema(
  p_user_id       uuid,
  p_reference     text,
  p_statut        text,
  p_montant_final numeric default null
)
returns table (ok boolean, motif text, total_compte numeric, total_global numeric)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ligne  record;
  v_nouveau_montant numeric;
  v_delta  numeric;
  v_total_compte numeric;
  v_total_global numeric;
begin
  if p_statut not in ('confirmee', 'incertaine', 'liberee') then
    return query select false, 'statut_invalide'::text, 0::numeric, 0::numeric;
    return;
  end if;

  select * into v_ligne from public.cinema_depenses_journal
   where user_id = p_user_id and reference = p_reference
   for update;
  if not found then
    return query select false, 'reference_absente'::text, 0::numeric, 0::numeric;
    return;
  end if;

  -- Idempotent SEULEMENT si le rejeu demande exactement le meme statut :
  -- deux statuts finaux differents pour la meme reference sont un bug
  -- appelant, pas un rejeu legitime — refuse plutot que d'ecraser en silence.
  if v_ligne.statut = p_statut then
    select total_engage_usd into v_total_compte from public.cinema_depenses_comptes where user_id = p_user_id;
    select total_engage_usd into v_total_global from public.cinema_depenses_globales where id = 'global';
    return query select true, null::text, coalesce(v_total_compte, 0), coalesce(v_total_global, 0);
    return;
  end if;
  if v_ligne.statut in ('confirmee', 'liberee') then
    -- Deja finalisee a un AUTRE statut que celui demande : refus net.
    return query select false, 'deja_finalisee'::text, 0::numeric, 0::numeric;
    return;
  end if;

  v_nouveau_montant := coalesce(p_montant_final, v_ligne.montant_usd);
  if v_nouveau_montant <= 0 or v_nouveau_montant > 5 then
    return query select false, 'montant_invalide'::text, 0::numeric, 0::numeric;
    return;
  end if;

  -- Delta applique aux compteurs : une 'liberee' retire tout le montant
  -- reserve ; une 'confirmee' ou 'incertaine' ne retire rien par defaut,
  -- et ajuste seulement si `p_montant_final` differe de ce qui avait ete
  -- reserve (cas rare : cout final different de l'estimation).
  if p_statut = 'liberee' then
    v_delta := -v_ligne.montant_usd;
  else
    v_delta := v_nouveau_montant - v_ligne.montant_usd;
  end if;

  update public.cinema_depenses_comptes
     set total_engage_usd = greatest(0, total_engage_usd + v_delta), maj_le = now()
   where user_id = p_user_id
  returning total_engage_usd into v_total_compte;

  update public.cinema_depenses_globales
     set total_engage_usd = greatest(0, total_engage_usd + v_delta), maj_le = now()
   where id = 'global'
  returning total_engage_usd into v_total_global;

  update public.cinema_depenses_journal
     set statut = p_statut,
         montant_usd = case when p_statut = 'liberee' then montant_usd else v_nouveau_montant end,
         maj_le = now()
   where user_id = p_user_id and reference = p_reference;

  return query select true, null::text, v_total_compte, v_total_global;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. DROITS — retires a `public`, comme les fonctions de credits
-- ---------------------------------------------------------------------------
revoke all on function
  public.reserver_depense_cinema(uuid, numeric, text, text, numeric, numeric) from public;
revoke all on function
  public.confirmer_depense_cinema(uuid, text, text, numeric) from public;

-- ---------------------------------------------------------------------------
-- 5. APRES APPLICATION — recharger le cache de schema de PostgREST
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- CONTROLES DE BON FONCTIONNEMENT (lecture seule) :
--   select proname, prosecdef from pg_proc
--    where proname in ('reserver_depense_cinema','confirmer_depense_cinema');
--   select has_function_privilege('public',
--     'public.reserver_depense_cinema(uuid,numeric,text,text,numeric,numeric)',
--     'EXECUTE');  -- attendu : false
--   select * from public.cinema_depenses_globales;  -- une seule ligne, 'global', 0
-- ---------------------------------------------------------------------------
