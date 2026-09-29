-- ============================================================================
-- SUBSCRIPTIONS.STATUS — ACCEPTER TOUS LES STATUTS STRIPE
-- ============================================================================
--
-- Migration REJOUABLE. Aucune ligne n'est modifiee ni supprimee : seule la
-- contrainte CHECK de `subscriptions.status` est remplacee par une contrainte
-- plus large. Rollback : `2026-09-29-subscriptions-status.rollback.sql`.
--
-- ---------------------------------------------------------------------------
-- 1. POURQUOI
-- ---------------------------------------------------------------------------
--
-- `src/lib/db/migrations/002_complete_schema.sql:71` declare :
--
--   status VARCHAR(20) NOT NULL DEFAULT 'active'
--     CHECK (status IN ('active', 'canceled', 'expired', 'past_due'))
--
-- Or le webhook Stripe (`src/app/api/stripe/webhook/route.ts`, evenement
-- `customer.subscription.updated`) recopie `sub.status` TEL QUEL. Stripe
-- (types `Stripe.Subscription.Status` du SDK installe) peut renvoyer :
--
--   active, canceled, incomplete, incomplete_expired, past_due, paused,
--   trialing, unpaid
--
-- Cinq de ces huit valeurs violent l'ancienne contrainte : l'upsert echoue
-- (23514), le webhook avale l'erreur, et la ligne d'abonnement reste figee
-- sur son ancien statut — alors que `users.plan` a deja ete mis a jour.
--
-- ---------------------------------------------------------------------------
-- 2. L'ENSEMBLE RETENU (9 valeurs)
-- ---------------------------------------------------------------------------
--
--   * les 8 statuts Stripe ci-dessus ;
--   * `expired`, qui n'est PAS un statut Stripe mais figure dans l'ancienne
--     contrainte et dans `src/lib/types/database.ts` : des lignes existantes
--     peuvent le porter, et la route admin PATCH peut l'ecrire. Le retirer
--     casserait la validation de la nouvelle contrainte.
--
-- `incomplete_expired` fait 18 caracteres : il tient dans VARCHAR(20), le
-- type de la colonne n'a pas a changer.
--
-- ---------------------------------------------------------------------------
-- 3. LE NOM DE LA CONTRAINTE N'EST PAS CONNU AVEC CERTITUDE
-- ---------------------------------------------------------------------------
--
-- `tests-pg/schema-production.sql` ne reconstitue PAS la table
-- `subscriptions` : son schema reel en production n'a pas ete releve. Une
-- contrainte inline recoit de PostgreSQL le nom `subscriptions_status_check`,
-- mais rien ne garantit que la table ait ete creee par ce fichier (editeur
-- Supabase, tableau de bord…). La migration ne suppose donc aucun nom : elle
-- supprime TOUTE contrainte CHECK de la table qui porte sur la seule colonne
-- `status`, quel que soit son nom, puis pose `subscriptions_status_check`.
--
-- Prevol en lecture seule (a lancer avant, pour savoir ce qui sera remplace) :
--
--   select c.conname, pg_get_constraintdef(c.oid)
--     from pg_constraint c
--    where c.conrelid = 'public.subscriptions'::regclass and c.contype = 'c';
--
--   select status, count(*) from public.subscriptions group by status;
--
-- ---------------------------------------------------------------------------
-- 4. SURETE
-- ---------------------------------------------------------------------------
--
-- Tout se joue dans un seul bloc `do` : un echec annule l'ensemble, la table
-- ne reste jamais sans contrainte. La contrainte est posee `not valid` (verrou
-- bref, pas de balayage) puis validee (`validate constraint`, verrou SHARE
-- UPDATE EXCLUSIVE qui laisse passer lectures et ecritures). Si une ligne
-- porte un statut hors liste, la validation echoue et RIEN n'est change.
--
-- Rejouable : si `subscriptions_status_check` existe deja avec exactement la
-- liste attendue, la migration ne fait rien.
-- ============================================================================

do $$
declare
  attendus constant text[] := array[
    'active', 'canceled', 'expired', 'past_due',
    'trialing', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'
  ];
  col_type   text;
  col_len    integer;
  statut_num smallint;
  existante  text;
  c          record;
begin
  if to_regclass('public.subscriptions') is null then
    raise exception 'public.subscriptions absente : rien a elargir. Verifier le schema avant de rejouer.';
  end if;

  select data_type, character_maximum_length into col_type, col_len
    from information_schema.columns
   where table_schema = 'public' and table_name = 'subscriptions' and column_name = 'status';

  if col_type is null then
    raise exception 'public.subscriptions.status absente.';
  end if;
  if col_type not in ('character varying', 'text') then
    raise exception 'public.subscriptions.status est de type % : cette migration ne traite que varchar/text.', col_type;
  end if;
  if col_len is not null and col_len < 18 then
    raise exception 'public.subscriptions.status est varchar(%) : trop court pour incomplete_expired (18).', col_len;
  end if;

  select attnum into statut_num
    from pg_attribute
   where attrelid = 'public.subscriptions'::regclass and attname = 'status';

  -- Deja appliquee ? On compare la liste reelle, pas seulement le nom.
  select pg_get_constraintdef(oid) into existante
    from pg_constraint
   where conrelid = 'public.subscriptions'::regclass
     and conname = 'subscriptions_status_check'
     and contype = 'c'
     and convalidated;

  if existante is not null
     and (select bool_and(existante like '%''' || s || '''%') from unnest(attendus) s)
     and (select count(*) from regexp_matches(existante, '''[a-z_]+''', 'g')) = array_length(attendus, 1)
  then
    raise notice 'subscriptions_status_check deja a jour : rien a faire.';
    return;
  end if;

  -- Toute contrainte CHECK portant sur la seule colonne `status`, quel que
  -- soit son nom. Les CHECK multi-colonnes ne sont pas touches.
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.subscriptions'::regclass
       and contype = 'c'
       and conkey = array[statut_num]
  loop
    raise notice 'Suppression de la contrainte %', c.conname;
    execute format('alter table public.subscriptions drop constraint %I', c.conname);
  end loop;

  alter table public.subscriptions
    add constraint subscriptions_status_check
    check (status in (
      'active', 'canceled', 'expired', 'past_due',
      'trialing', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'
    )) not valid;

  alter table public.subscriptions validate constraint subscriptions_status_check;
end
$$;

-- PostgREST ne relit pas le schema tout seul (cf. CLAUDE.md) :
--   docker kill -s SIGUSR1 studiio-postgrest
-- Aucun `grant` n'est necessaire : la table existe deja, seule une
-- contrainte change.
