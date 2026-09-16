-- ============================================================================
-- D-ID — LE NOM DE LA PERSONNE QUI CONSENT, ET L'HEURE DE LA PHRASE
-- ============================================================================
--
-- Depend de `2026-09-15-avatar-fournisseur-did.sql`. Migration ADDITIVE et
-- REJOUABLE : deux colonnes nullables sur `user_avatars`, rien d'autre.
-- Aucune ligne modifiee, aucun backfill.
--
-- ---------------------------------------------------------------------------
-- 1. POURQUOI
-- ---------------------------------------------------------------------------
--
-- Le premier essai reel du consentement D-ID a echoue (HTTP 400, « audio-text
-- mismatch »). Cause : le code envoyait a `POST /consents/{id}` le NOM DE
-- L'AVATAR (`user_avatars.name` = « Mon avatar video ») comme `name`, et
-- affichait la phrase de D-ID telle quelle, avec son marqueur `[user name]`
-- non remplace. D-ID attend : la phrase ou `[user name]` est remplace par le
-- nom REELLEMENT PRONONCE, et ce meme nom dans `name`.
--
-- Le nom d'affichage d'un avatar et le nom de la personne qui consent sont
-- deux choses. La seconde a sa colonne.
--
-- ---------------------------------------------------------------------------
-- 2. CE QUE LA MIGRATION AJOUTE
-- ---------------------------------------------------------------------------
--
--   user_avatars.consent_name                 le nom que la personne
--                                             prononce et que D-ID recoit
--                                             (`name`), tel qu'elle l'a saisi
--   user_avatars.provider_consent_created_at  l'heure de la phrase : D-ID
--                                             fait expirer un consentement
--                                             30 minutes apres sa creation ;
--                                             sans cette heure, on ne peut ni
--                                             prevenir ni proposer une
--                                             nouvelle phrase a temps
--
-- NULL pour tout avatar HeyGen, et pour les lignes D-ID anterieures — dont
-- le consentement refuse est a refaire avec une nouvelle phrase.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'user_avatars' and column_name = 'provider_consent_id'
  ) then
    raise exception 'user_avatars.provider_consent_id absente : appliquer 2026-09-15-avatar-fournisseur-did.sql d''abord';
  end if;
end $$;

alter table public.user_avatars
  add column if not exists consent_name text;
alter table public.user_avatars
  add column if not exists provider_consent_created_at timestamptz;

-- ---------------------------------------------------------------------------
-- 3. APRES APPLICATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- CONTROLE (lecture seule) :
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'user_avatars'
--      and column_name in ('consent_name', 'provider_consent_created_at');
-- ---------------------------------------------------------------------------
