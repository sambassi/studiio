-- ============================================================================
-- AVATAR-2A — UN SEUL AVATAR VIVANT PAR COMPTE
-- ============================================================================
--
-- Depend de `2026-09-15-avatar-schema-foundation.sql` (colonne `deleted_at`).
-- Migration ADDITIVE et REJOUABLE : un index unique partiel, rien d'autre.
-- Aucune ligne n'est supprimee ni modifiee.
--
-- ---------------------------------------------------------------------------
-- 1. POURQUOI
-- ---------------------------------------------------------------------------
--
-- Le remplacement d'un avatar est protege par un compare-and-set sur
-- `version` (`commencerNouvelleVersionAvatar`) : deux remplacements
-- simultanes ne fabriquent pas deux « version 4 ». Mais la PREMIERE
-- inscription n'a rien a comparer : deux premieres inscriptions simultanees
-- inseraient deux lignes vivantes, et l'ecran en prendrait une au hasard.
-- Cet index est le garde-fou que la base seule peut tenir : la seconde
-- insertion echoue (23505), l'application la reconnait et nettoie sa source.
--
-- ---------------------------------------------------------------------------
-- 2. SI DES DOUBLONS VIVANTS EXISTENT DEJA — ON S'ARRETE
-- ---------------------------------------------------------------------------
--
-- `/api/avatar/create` supprimait l'ancienne ligne avant d'inserer la
-- nouvelle : en principe, un compte n'a qu'une ligne. Mais rien ne
-- l'interdisait, et une course a pu en laisser deux. Cette migration NE
-- CHOISIT PAS laquelle garder — sur une donnee biometrique, ce n'est pas a
-- une migration d'en decider. Elle echoue avec le nombre de comptes touches ;
-- l'operateur regarde, decide, puis rejoue.
--
-- Prevol (a executer APRES la migration 1A, AVANT celle-ci) :
--
--   select user_id, count(*) as vivants
--     from public.user_avatars
--    where deleted_at is null
--    group by user_id
--   having count(*) > 1;
--
-- ---------------------------------------------------------------------------
-- 3. L'INDEX
-- ---------------------------------------------------------------------------

do $$
declare
  comptes_en_double integer;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_avatars' and column_name = 'deleted_at'
  ) then
    raise exception 'user_avatars.deleted_at absente : appliquer 2026-09-15-avatar-schema-foundation.sql d''abord';
  end if;

  if exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'user_avatars_one_active_per_user_uidx'
  ) then
    return; -- deja appliquee : rejouable
  end if;

  select count(*) into comptes_en_double
    from (
      select user_id from public.user_avatars
       where deleted_at is null
       group by user_id
      having count(*) > 1
    ) d;

  if comptes_en_double > 0 then
    raise exception
      'AVATAR-2A : % compte(s) ont plusieurs avatars vivants ; aucune ligne n''est supprimee automatiquement. Executer le prevol (section 2), decider, puis rejouer.',
      comptes_en_double;
  end if;
end $$;

create unique index if not exists user_avatars_one_active_per_user_uidx
  on public.user_avatars (user_id)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 4. APRES APPLICATION
-- ---------------------------------------------------------------------------
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- (un index ne change pas le cache de schema, mais l'ordre de deploiement
-- Avatar le prevoit apres la migration 1A ; le geste est le meme.)
