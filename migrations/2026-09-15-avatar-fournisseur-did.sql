-- ============================================================================
-- AVATAR VIDEO — D-ID COMME SECOND FOURNISSEUR, DANS LES MEMES TABLES
-- ============================================================================
--
-- Depend de `2026-09-15-avatar-schema-foundation.sql` (version, validated_at,
-- deleted_at, intention). Migration ADDITIVE et REJOUABLE : des colonnes
-- nullables, une valeur par defaut, deux CHECK sur le nom du fournisseur.
-- Aucune table, aucune ligne supprimee ni modifiee, aucun backfill.
--
-- ---------------------------------------------------------------------------
-- 1. POURQUOI PAS UNE TABLE D-ID
-- ---------------------------------------------------------------------------
--
-- `user_avatars` sait deja dire : un compte, une source privee, un
-- consentement Studiio, une version, un fournisseur (`provider`, defaut
-- 'heygen') et son identifiant (`provider_avatar_id`), un etat d'entrainement,
-- une validation, une suppression. Un avatar D-ID est exactement cela. Ce
-- qui lui manque, c'est le CONSENTEMENT FOURNISSEUR : D-ID exige, avant de
-- creer un avatar video, une phrase qu'il tire au sort, lue a la camera dans
-- une video qu'il verifie. Quatre colonnes, nullables — NULL pour tout avatar
-- HeyGen, hier comme demain.
--
-- ---------------------------------------------------------------------------
-- 2. CE QUE LA MIGRATION AJOUTE
-- ---------------------------------------------------------------------------
--
--   user_avatars.provider_consent_id      l'identifiant du consentement chez
--                                         D-ID (POST /consents)
--   user_avatars.provider_consent_text    la phrase a lire, telle que D-ID
--                                         l'a rendue — affichee a la personne
--   user_avatars.provider_consent_status  le statut D-ID de la verification,
--                                         brut (created | validating | done |
--                                         error), comme `status` l'est pour
--                                         l'entrainement
--   user_avatars.consent_object_key       la cle PRIVEE de la video de
--                                         consentement dans notre stockage
--                                         (`<compte>/avatar/consent-…`), jamais
--                                         une URL fournisseur
--   avatar_generations.provider           'heygen' | 'did' — le fournisseur qui
--                                         produit CETTE video ; defaut 'heygen'
--                                         pour tout l'existant
--
-- Deux CHECK nomment les seuls fournisseurs cables : 'heygen', 'did'. Le
-- prevol s'arrete si une ligne portait autre chose — aucune n'est corrigee
-- d'office.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_avatars' and column_name = 'version'
  ) then
    raise exception 'user_avatars.version absente : appliquer 2026-09-15-avatar-schema-foundation.sql d''abord';
  end if;
  if exists (select 1 from public.user_avatars where provider not in ('heygen', 'did')) then
    raise exception 'user_avatars.provider porte une valeur inconnue : verifier avant d''ajouter le CHECK';
  end if;
end $$;

alter table public.user_avatars
  add column if not exists provider_consent_id text;
alter table public.user_avatars
  add column if not exists provider_consent_text text;
alter table public.user_avatars
  add column if not exists provider_consent_status text;
alter table public.user_avatars
  add column if not exists consent_object_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'user_avatars_provider_check' and conrelid = 'public.user_avatars'::regclass
  ) then
    alter table public.user_avatars
      add constraint user_avatars_provider_check check (provider in ('heygen', 'did'));
  end if;
end $$;

alter table public.avatar_generations
  add column if not exists provider text not null default 'heygen';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'avatar_generations_provider_check' and conrelid = 'public.avatar_generations'::regclass
  ) then
    alter table public.avatar_generations
      add constraint avatar_generations_provider_check check (provider in ('heygen', 'did'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. APRES APPLICATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Des colonnes nouvelles restent invisibles de PostgREST tant qu'il n'a pas
-- relu son cache de schema.
--
-- CONTROLES (lecture seule) :
--   select column_name, data_type, is_nullable, column_default
--     from information_schema.columns
--    where table_schema = 'public' and table_name in ('user_avatars', 'avatar_generations')
--      and column_name in ('provider', 'provider_consent_id', 'provider_consent_text',
--                          'provider_consent_status', 'consent_object_key')
--    order by table_name, ordinal_position;
-- ---------------------------------------------------------------------------
