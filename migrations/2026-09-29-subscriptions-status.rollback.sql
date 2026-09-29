-- ============================================================================
-- ROLLBACK de 2026-09-29-subscriptions-status.sql
-- ============================================================================
--
-- Remet la contrainte d'origine de `002_complete_schema.sql:71` :
--
--   status in ('active', 'canceled', 'expired', 'past_due')
--
-- STRATEGIE : REFUSER plutot que DETRUIRE.
--
-- Une fois la migration appliquee, le webhook Stripe a pu ecrire `trialing`,
-- `incomplete`, `incomplete_expired`, `unpaid` ou `paused`. Reposer la liste
-- etroite sur ces lignes echouerait a la validation — et les « corriger »
-- (trialing -> active, unpaid -> past_due…) reviendrait a mentir sur l'etat
-- reel de l'abonnement chez Stripe. Ce n'est pas a un rollback d'en decider.
--
-- Ce script s'arrete donc, SANS RIEN CHANGER, si une seule ligne porte un
-- statut hors de l'ancienne liste, et affiche le decompte. L'operateur
-- choisit alors : resynchroniser ces lignes depuis Stripe, les requalifier
-- a la main, ou renoncer au rollback.
--
-- A savoir avant de rejouer ce rollback : tant que le code du webhook recopie
-- `sub.status` tel quel, l'ancienne contrainte fera de nouveau echouer les
-- mises a jour d'abonnements portant un statut Stripe hors liste.
--
-- Rejouable : si la contrainte etroite est deja en place, rien ne change.
-- ============================================================================

do $$
declare
  hors_liste text;
  statut_num smallint;
  c          record;
begin
  if to_regclass('public.subscriptions') is null then
    raise exception 'public.subscriptions absente : rien a restaurer.';
  end if;

  select string_agg(format('%s=%s', status, n), ', ' order by status) into hors_liste
    from (
      select status, count(*) as n
        from public.subscriptions
       where status not in ('active', 'canceled', 'expired', 'past_due')
       group by status
    ) t;

  if hors_liste is not null then
    raise exception 'Rollback refuse : des abonnements portent un statut hors de l''ancienne liste (%). Les requalifier d''abord.', hors_liste;
  end if;

  select attnum into statut_num
    from pg_attribute
   where attrelid = 'public.subscriptions'::regclass and attname = 'status';

  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.subscriptions'::regclass
       and contype = 'c'
       and conkey = array[statut_num]
  loop
    execute format('alter table public.subscriptions drop constraint %I', c.conname);
  end loop;

  alter table public.subscriptions
    add constraint subscriptions_status_check
    check (status in ('active', 'canceled', 'expired', 'past_due')) not valid;

  alter table public.subscriptions validate constraint subscriptions_status_check;
end
$$;

-- Puis : docker kill -s SIGUSR1 studiio-postgrest
