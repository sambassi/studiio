-- ═══════════════════════════════════════════════════════════════════════════
-- STRIPE : IDEMPOTENCE DES EVENEMENTS WEBHOOK + OCTROI DE CREDITS IDEMPOTENT
--
-- ⚠️ NE RIEN APPLIQUER SANS LE RUNBOOK DE LA PR (staging, puis production).
--
-- Depend de `2026-08-27-credits-atomiques.sql` (colonne
-- `credit_transactions.reference_id` + index unique partiel
-- `credit_transactions_reference_unique (user_id, reference_id)`).
-- Rollback : `migrations/rollback/2026-09-29-stripe-events.rollback.sql`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CE QU'ELLE CORRIGE
-- ─────────────────────────────────────────────────────────────────────────
--
-- `src/app/api/stripe/webhook/route.ts` (`alreadyProcessed`) faisait :
--
--   SELECT event_id  ->  s'il manque, INSERT  ->  traitement
--
-- 1. Deux livraisons simultanees du meme evenement lisaient toutes deux
--    « absent » et traitaient toutes deux : credits octroyes deux fois.
-- 2. L'evenement etait marque AVANT le traitement : un crash au milieu le
--    laissait « deja vu » pour toujours. Stripe le relivrait, on repondait
--    `idempotent: true`, et l'achat etait perdu.
-- 3. La table `stripe_events` n'est creee par AUCUNE migration du depot :
--    le code avale l'erreur et traite chaque livraison, sans idempotence.
-- 4. L'octroi de credits (`checkout.session.completed`,
--    `invoice.payment_succeeded`) lisait le solde, l'augmentait en
--    JavaScript et reecrivait une valeur ABSOLUE, sans `reference_id` : ni
--    atomique, ni idempotent au niveau de la base.
--
-- ─────────────────────────────────────────────────────────────────────────
-- CONTRAT (l'agent A code le webhook contre lui)
-- ─────────────────────────────────────────────────────────────────────────
--
--   stripe_event_claim(p_event_id text, p_type text, p_lease_seconds int default 300)
--     returns text :
--       'claimed'           -> a toi de traiter, puis complete() ou fail()
--       'already_processed' -> repondre 200 sans rien faire
--       'in_progress'       -> un autre worker tient le bail : repondre une
--                              erreur (5xx) pour que Stripe relivre plus tard
--   stripe_event_complete(p_event_id text) returns void
--   stripe_event_fail(p_event_id text, p_error text) returns void
--
--   crediter_credits_stripe(p_user_id uuid, p_montant int, p_type text,
--                           p_reference text, p_description text default null,
--                           p_mode text default 'ajouter')
--     returns table (ok boolean, solde integer, deja_credite boolean, motif text)
--
-- Additive et rejouable : aucune donnee existante n'est supprimee.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- 0. PRECONDITION — l'index unique du 27 aout doit exister
--
-- `crediter_credits_stripe` tire son idempotence de cet index. Sans lui elle
-- s'installerait et paraitrait idempotente alors que deux octrois simultanes
-- passeraient tous les deux.
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
-- 1. LA TABLE
--
-- Elle a pu etre creee a la main en production (le code l'utilise depuis
-- longtemps, sans migration). D'ou `if not exists` PUIS chaque colonne en
-- `add column if not exists` : la migration sait s'appliquer sur une base
-- sans table, et sur une table ancienne a trois colonnes
-- (`event_id`, `type`, `received_at`).
-- ---------------------------------------------------------------------------
create table if not exists public.stripe_events (
  event_id     text primary key,
  type         text not null,
  status       text not null default 'processed',
  attempts     int  not null default 1,
  last_error   text,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  lease_until  timestamptz
);

alter table public.stripe_events add column if not exists type         text;
alter table public.stripe_events add column if not exists status       text;
alter table public.stripe_events add column if not exists attempts     int;
alter table public.stripe_events add column if not exists last_error   text;
alter table public.stripe_events add column if not exists received_at  timestamptz;
alter table public.stripe_events add column if not exists processed_at timestamptz;
alter table public.stripe_events add column if not exists lease_until  timestamptz;

-- Lignes anciennes : l'ancien code inserait AVANT de traiter et repondait
-- « idempotent » a toute relivraison. Les marquer `processed` conserve
-- EXACTEMENT ce comportement pour elles — on ne rejoue pas, en silence, des
-- evenements vieux de plusieurs semaines.
update public.stripe_events set status = 'processed' where status is null;
update public.stripe_events set attempts = 1 where attempts is null;
update public.stripe_events set received_at = now() where received_at is null;
update public.stripe_events set type = 'inconnu' where type is null;

-- DEFAUT `processed` sur `status` — hors contrat, et delibere (« default
-- safe ») : pendant la fenetre entre cette migration et le deploiement du
-- nouveau webhook, l'ANCIEN code insere `{event_id, type, received_at}`
-- sans statut. Sans defaut, son insert echouerait et il retraiterait chaque
-- relivraison. Avec lui, il garde son comportement d'aujourd'hui. Les
-- fonctions ci-dessous posent toujours le statut explicitement.
alter table public.stripe_events alter column status      set default 'processed';
alter table public.stripe_events alter column attempts    set default 1;
alter table public.stripe_events alter column received_at set default now();

alter table public.stripe_events alter column type        set not null;
alter table public.stripe_events alter column status      set not null;
alter table public.stripe_events alter column attempts    set not null;
alter table public.stripe_events alter column received_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'stripe_events_status_check'
       and conrelid = 'public.stripe_events'::regclass
  ) then
    alter table public.stripe_events
      add constraint stripe_events_status_check
      check (status in ('processing', 'processed', 'failed'));
  end if;
end $$;

-- `on conflict (event_id)` exige un index unique sur EXACTEMENT cette
-- colonne. Une table creee a la main peut ne pas en avoir, ou avoir une
-- autre cle primaire (un `id uuid`, par exemple).
do $$
declare
  v_a_pk boolean;
  v_unique_event boolean;
begin
  select exists (
    select 1 from pg_constraint
     where conrelid = 'public.stripe_events'::regclass and contype = 'p'
  ) into v_a_pk;

  select exists (
    select 1
      from pg_index i
      join pg_attribute a
        on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
     where i.indrelid = 'public.stripe_events'::regclass
       and i.indisunique
       and i.indnkeyatts = 1
       and i.indpred is null
       and a.attname = 'event_id'
  ) into v_unique_event;

  if not v_unique_event then
    if v_a_pk then
      create unique index stripe_events_event_id_unique on public.stripe_events (event_id);
    else
      alter table public.stripe_events alter column event_id set not null;
      alter table public.stripe_events add primary key (event_id);
    end if;
  end if;
end $$;

-- Surveillance : les evenements bloques en echec.
create index if not exists stripe_events_non_traites
  on public.stripe_events (received_at)
  where status <> 'processed';

-- ---------------------------------------------------------------------------
-- 2. RESERVER UN EVENEMENT — stripe_event_claim
--
-- Une ligne par evenement, et c'est la base qui tranche :
--
--   * absent                         -> insert `processing` + bail  -> 'claimed'
--   * `failed`                       -> reprise, attempts+1         -> 'claimed'
--   * `processing`, bail expire      -> reprise, attempts+1         -> 'claimed'
--   * `processing`, bail valide      ->                               'in_progress'
--   * `processed`                    ->                               'already_processed'
--
-- CONCURRENCE. `insert ... on conflict do nothing` : deux inserts simultanes
-- de la meme cle, le second ATTEND la fin du premier puis ne fait rien. Il
-- tombe alors sur le `select ... for update`, qui verrouille la ligne et lit
-- sa DERNIERE version (READ COMMITTED relit apres le verrou) : il voit
-- `processing` avec un bail valide et rend 'in_progress'. Deux reprises
-- simultanees d'une ligne `failed` se serialisent de la meme facon sur le
-- verrou : une seule la reprend.
--
-- Le BAIL rend une ligne `processing` recuperable si le worker meurt sans
-- appeler complete() ni fail() : une fois `lease_until` depasse, la
-- livraison suivante de Stripe la reprend. Il doit donc etre plus long que
-- le traitement le plus long (300 s par defaut ; le webhook a 30 s chez
-- Stripe avant de conclure a un echec).
-- ---------------------------------------------------------------------------
create or replace function public.stripe_event_claim(
  p_event_id      text,
  p_type          text,
  p_lease_seconds int default 300
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_bail    interval;
  v_status  text;
  v_lease   timestamptz;
begin
  if p_event_id is null or length(btrim(p_event_id, E' \t\n\r')) = 0 then
    raise exception 'stripe_event_claim : event_id absent' using errcode = '22023';
  end if;
  if p_type is null or length(btrim(p_type, E' \t\n\r')) = 0 then
    raise exception 'stripe_event_claim : type absent' using errcode = '22023';
  end if;
  -- Un bail nul, negatif ou demesure est une erreur de code, pas un choix.
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 86400 then
    raise exception 'stripe_event_claim : p_lease_seconds hors de [1, 86400]' using errcode = '22023';
  end if;
  v_bail := make_interval(secs => p_lease_seconds);

  insert into public.stripe_events (event_id, type, status, attempts, received_at, lease_until)
  values (p_event_id, p_type, 'processing', 1, now(), clock_timestamp() + v_bail)
  on conflict (event_id) do nothing;

  if found then
    return 'claimed';
  end if;

  select status, lease_until into v_status, v_lease
    from public.stripe_events
   where event_id = p_event_id
   for update;

  -- La ligne a disparu entre le conflit et le verrou (purge manuelle) : on
  -- recommence, l'insert passera.
  if not found then
    return public.stripe_event_claim(p_event_id, p_type, p_lease_seconds);
  end if;

  if v_status = 'processed' then
    return 'already_processed';
  end if;

  -- `clock_timestamp()` et non `now()` : `now()` est fige au debut de la
  -- transaction, et un bail se juge a l'heure reelle.
  if v_status = 'processing' and v_lease is not null and v_lease > clock_timestamp() then
    return 'in_progress';
  end if;

  -- `failed`, ou `processing` dont le bail est expire (ou absent) : reprise.
  -- `last_error` est garde : c'est l'historique de la tentative precedente,
  -- utile tant que la reprise n'a pas abouti.
  update public.stripe_events
     set status      = 'processing',
         attempts    = attempts + 1,
         lease_until = clock_timestamp() + v_bail
   where event_id = p_event_id;

  return 'claimed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. CONCLURE — stripe_event_complete
--
-- Une ligne absente est un bug de l'appelant (complete sans claim) : on le
-- dit (SQLSTATE P0002) plutot que de reussir en silence.
-- ---------------------------------------------------------------------------
create or replace function public.stripe_event_complete(p_event_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.stripe_events
     set status       = 'processed',
         processed_at = clock_timestamp(),
         lease_until  = null
   where event_id = p_event_id;

  if not found then
    raise exception 'stripe_event_complete : evenement % inconnu', p_event_id
      using errcode = 'P0002';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. ECHEC — stripe_event_fail
--
-- `failed` + erreur tronquee a 2000 caracteres + bail libere : la
-- relivraison suivante de Stripe reprend l'evenement sans attendre.
--
-- Ne retrograde JAMAIS une ligne `processed` : un worker attarde dont le
-- bail a expire, pendant qu'un autre a abouti, ne doit pas rouvrir un
-- evenement deja applique. Appelee dans un chemin d'erreur, elle ne leve
-- pas non plus sur une ligne absente — elle n'a alors rien a faire.
-- ---------------------------------------------------------------------------
create or replace function public.stripe_event_fail(p_event_id text, p_error text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.stripe_events
     set status      = 'failed',
         last_error  = left(coalesce(p_error, 'erreur inconnue'), 2000),
         lease_until = null
   where event_id = p_event_id
     and status <> 'processed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. OCTROI DE CREDITS IDEMPOTENT — crediter_credits_stripe
--
-- Le miroir de `debiter_credits_operation` pour l'argent qui ENTRE. Meme
-- index, meme forme :
--
--   * increment RELATIF sous verrou de ligne, jamais une valeur lue puis
--     reecrite en JavaScript ;
--   * journal ecrit dans la MEME transaction, avec `reference_id` ;
--   * une reference ne peut crediter qu'une fois par utilisateur : l'index
--     unique `(user_id, reference_id)` le tient, meme sous concurrence.
--
-- La reference DOIT commencer par `stripe:` : elle partage l'index avec les
-- debits (`rendu:...`, `op:...`), et l'espace de noms empeche qu'un debit
-- et un credit se bloquent l'un l'autre. References attendues :
--   achat de pack   -> 'stripe:cs:'  || checkout_session.id
--   renouvellement  -> 'stripe:in:'  || invoice.id
--
-- `p_mode` :
--   'ajouter' (defaut) -> credits = credits + p_montant  (pack, bonus)
--   'fixer'            -> credits = p_montant           (remise a zero
--                         mensuelle, comportement actuel de
--                         `invoice.payment_succeeded`). Le journal porte
--                         p_montant, comme aujourd'hui ; le solde precedent
--                         va dans la description.
--
-- Motifs de refus (ok=false, rien n'est ecrit) : reference_invalide,
-- montant_invalide, type_invalide, mode_invalide, utilisateur_inconnu.
-- Rejeu : ok=true, deja_credite=true, solde courant, rien n'est ecrit.
-- ---------------------------------------------------------------------------
create or replace function public.crediter_credits_stripe(
  p_user_id     uuid,
  p_montant     integer,
  p_type        text,
  p_reference   text,
  p_description text default null,
  p_mode        text default 'ajouter'
)
returns table (ok boolean, solde integer, deja_credite boolean, motif text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_solde     integer;
  v_precedent integer;
  v_desc      text;
begin
  if p_reference is null
     or length(btrim(p_reference, E' \t\n\r')) = 0
     or p_reference not like 'stripe:_%'
     or length(p_reference) > 255 then
    return query select false, 0, false, 'reference_invalide'::text;
    return;
  end if;

  -- Plafond de securite : le plus gros octroi connu est l'abonnement
  -- Enterprise (5000). Il borne ce qu'une erreur de code peut donner.
  if p_montant is null or p_montant <= 0 or p_montant > 100000 then
    return query select false, 0, false, 'montant_invalide'::text;
    return;
  end if;

  if p_type is null or p_type not in ('purchase', 'subscription', 'bonus', 'refund') then
    return query select false, 0, false, 'type_invalide'::text;
    return;
  end if;

  if p_mode is null or p_mode not in ('ajouter', 'fixer') then
    return query select false, 0, false, 'mode_invalide'::text;
    return;
  end if;

  select credits into v_solde from public.users where id = p_user_id;
  if not found then
    return query select false, 0, false, 'utilisateur_inconnu'::text;
    return;
  end if;

  -- Rejeu sequentiel : le cas courant (Stripe relivre APRES un 200 perdu).
  if exists (
    select 1 from public.credit_transactions
     where user_id = p_user_id and reference_id = p_reference
  ) then
    return query select true, coalesce(v_solde, 0), true, null::text;
    return;
  end if;

  -- Increment ET journal dans le MEME bloc a EXCEPTION : le savepoint
  -- implicite annule l'increment du perdant d'une course.
  begin
    select credits into v_precedent from public.users where id = p_user_id for update;

    if p_mode = 'ajouter' then
      update public.users set credits = coalesce(credits, 0) + p_montant
       where id = p_user_id returning credits into v_solde;
    else
      update public.users set credits = p_montant
       where id = p_user_id returning credits into v_solde;
    end if;

    v_desc := coalesce(p_description, 'stripe ' || p_type);
    if p_mode = 'fixer' then
      v_desc := v_desc || ' (solde fixe a ' || p_montant
                || ', precedent ' || coalesce(v_precedent, 0) || ')';
    end if;

    insert into public.credit_transactions (user_id, amount, type, reference_id, description)
    values (p_user_id, p_montant, p_type, p_reference, v_desc);

  exception when unique_violation then
    select credits into v_solde from public.users where id = p_user_id;
    return query select true, coalesce(v_solde, 0), true, null::text;
    return;
  end;

  return query select true, v_solde, false, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. DROITS — minimaux, pour un role SERVEUR
--
-- Rien pour `public`, `anon`, `authenticated` : ni la table, ni les
-- fonctions. Le webhook appelle les fonctions par RPC avec la cle de
-- service ; la table n'a pas besoin d'etre lisible directement.
--
-- Le role serveur : si `service_role` existe (convention de la cle
-- SUPABASE_SERVICE_KEY), il recoit EXECUTE, et rien d'autre. Sinon, aucun
-- grant n'est fait ici — voir le runbook : identifier le role porte par la
-- cle de service (claim `role` du JWT) et lui accorder EXECUTE NOMMEMENT,
-- jamais a `public`.
--
-- RLS activee sans politique : un role non proprietaire qui obtiendrait un
-- jour un droit de table ne lirait quand meme rien. Les fonctions, SECURITY
-- DEFINER et possedees par le proprietaire de la table, n'en sont pas
-- genees.
-- ---------------------------------------------------------------------------
alter table public.stripe_events enable row level security;

revoke all on table public.stripe_events from public;
revoke all on function public.stripe_event_claim(text, text, int)                           from public;
revoke all on function public.stripe_event_complete(text)                                   from public;
revoke all on function public.stripe_event_fail(text, text)                                 from public;
revoke all on function public.crediter_credits_stripe(uuid, integer, text, text, text, text) from public;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on table public.stripe_events from %I', r);
      execute format('revoke all on function public.stripe_event_claim(text, text, int) from %I', r);
      execute format('revoke all on function public.stripe_event_complete(text) from %I', r);
      execute format('revoke all on function public.stripe_event_fail(text, text) from %I', r);
      execute format('revoke all on function public.crediter_credits_stripe(uuid, integer, text, text, text, text) from %I', r);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.stripe_event_claim(text, text, int)                           to service_role;
    grant execute on function public.stripe_event_complete(text)                                   to service_role;
    grant execute on function public.stripe_event_fail(text, text)                                 to service_role;
    grant execute on function public.crediter_credits_stripe(uuid, integer, text, text, text, text) to service_role;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Sans ce signal, PostgREST ignore les nouvelles fonctions et repond 404
-- sur /rpc/stripe_event_claim.
--
-- CONTROLES PREALABLES (lecture seule) :
--   select to_regclass('public.stripe_events');
--     -- NULL : la table sera creee. Sinon :
--   select column_name, data_type from information_schema.columns
--    where table_schema='public' and table_name='stripe_events';
--   select event_id, count(*) from public.stripe_events group by 1 having count(*) > 1;
--     -- attendu : aucune ligne, sinon la cle unique echouera.
--   select count(*) from public.stripe_events where event_id is null;
--     -- attendu : 0.
--   select indexname from pg_indexes where indexname = 'credit_transactions_reference_unique';
--     -- attendu : une ligne (sinon la migration s'arrete d'elle-meme).
--
-- CONTROLES POSTERIEURS :
--   select public.stripe_event_claim('evt_controle_migration', 'controle', 1);  -- 'claimed'
--   select public.stripe_event_complete('evt_controle_migration');
--   select public.stripe_event_claim('evt_controle_migration', 'controle', 1);  -- 'already_processed'
--   delete from public.stripe_events where event_id = 'evt_controle_migration';
--   select has_function_privilege('public', 'public.stripe_event_claim(text,text,int)', 'EXECUTE');
--     -- attendu : false
-- ═══════════════════════════════════════════════════════════════════════════
