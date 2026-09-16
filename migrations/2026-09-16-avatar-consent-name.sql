-- ============================================================================
-- D-ID — LE NOM DE LA PERSONNE QUI CONSENT, ET L'HEURE DE LA PHRASE
-- ============================================================================
--
-- Depend de `2026-09-15-avatar-fournisseur-did.sql`. Migration ADDITIVE et
-- REJOUABLE : trois colonnes nullables sur `user_avatars`, rien d'autre.
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
--                                             nouvelle phrase a temps.
--                                             ⚠️ Cette expiration ne concerne
--                                             que le DEFI (avant validation) :
--                                             un consentement `done` ne
--                                             perime pas.
--   user_avatars.provider_consent_version     la VERSION de l'avatar a laquelle
--                                             ce consentement est rattache.
--                                             D-ID confirme qu'un consentement
--                                             VALIDE (`done`) sert a tous les
--                                             futurs avatars de la meme
--                                             personne : au changement de
--                                             source (version + 1), un
--                                             consentement `done` est CONSERVE
--                                             sur la ligne, et cette colonne
--                                             garde l'ancienne version — la
--                                             personne confirme explicitement
--                                             sa reutilisation (meme nom),
--                                             le serveur la rattache alors a
--                                             la version courante.
--
-- NULL pour tout avatar HeyGen, et pour les lignes D-ID anterieures — dont
-- le consentement refuse est a refaire avec une nouvelle phrase.
--
-- L'HISTORIQUE des consentements valides vit dans `user_avatars` meme : les
-- lignes supprimees (soft delete) gardent leurs colonnes de consentement, et
-- une ligne remplacee (version + 1) garde un consentement `done`. Aucune
-- table parallele.
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
alter table public.user_avatars
  add column if not exists provider_consent_version integer;

-- ---------------------------------------------------------------------------
-- 3. APRES APPLICATION — ETAPE OBLIGATOIRE
--
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- CONTROLE (lecture seule) :
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'user_avatars'
--      and column_name in ('consent_name', 'provider_consent_created_at', 'provider_consent_version');
-- ---------------------------------------------------------------------------
