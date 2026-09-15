-- ============================================================================
-- JUMEAU NUMERIQUE — UNE SEULE GENERATION EN VOL PAR INTENTION
-- ============================================================================
--
-- Depend de `2026-09-15-avatar-schema-foundation.sql` (colonnes
-- `avatar_version` et `intention` de `avatar_generations`).
-- Migration ADDITIVE et REJOUABLE : un index unique partiel, rien d'autre.
-- Aucune table, aucune colonne, aucune autre contrainte, aucune ligne
-- supprimee ni modifiee.
--
-- ---------------------------------------------------------------------------
-- 1. POURQUOI
-- ---------------------------------------------------------------------------
--
-- Le moteur du jumeau (`genererVideoJumeau`) reserve une ligne de
-- `avatar_generations` AVANT de payer et d'appeler les fournisseurs
-- (ElevenLabs sur la voix personnelle, HeyGen sur l'avatar). Une lecture
-- « existe-t-il deja une generation en cours ? » suivie d'une insertion ne
-- tient pas sous deux requetes strictement simultanees : mesure sur le
-- moteur, deux appels donnaient deux syntheses, deux depots, deux videos,
-- deux debits. Seule la base peut trancher : la seconde insertion echoue
-- (23505), le moteur la reconnait, ne paie rien, n'appelle personne, et
-- rend la generation deja en vol.
--
-- Meme famille que `avatar_generations_apercu_unique` (un apercu vivant par
-- version) : un index unique partiel, l'application gere le conflit.
--
-- ---------------------------------------------------------------------------
-- 2. L'IDENTITE D'UNE GENERATION DE JUMEAU
-- ---------------------------------------------------------------------------
--
--   user_id          le compte
--   user_avatar_id   l'avatar
--   avatar_version   la version du clone (epinglee a la generation)
--   voice_id         la voix INTERNE, sous la forme `jumeau:<user_voices.id>`
--                    — c'est ce prefixe qui distingue une generation de
--                    jumeau d'une generation avatar ordinaire
--   aspect_ratio     le format de sortie (un 9:16 et un 16:9 du meme texte
--                    sont deux videos)
--   md5(script)      le SPOKEN_SCRIPT, celui qui est reellement dit ;
--                    `md5(text)` est immuable, donc admis dans un index, et
--                    borne la taille de la cle (un script peut etre long)
--
-- ... UNIQUEMENT tant qu'elle est EN VOL (`pending`, `processing`) et de
-- l'intention `normale`. Une generation terminee ou echouee libere la place :
-- refaire la meme video plus tard reste possible, et un echec ne bloque
-- jamais la relance.
--
-- ---------------------------------------------------------------------------
-- 3. SI DES DOUBLONS EN VOL EXISTENT DEJA — ON S'ARRETE
-- ---------------------------------------------------------------------------
--
-- Le moteur n'a encore rien produit en production (`JUMEAU_MOTEUR_ACTIVE`
-- absent) : aucune ligne `jumeau:%` n'existe. Si, contre toute attente, deux
-- lignes en vol se partagent la meme identite, cette migration NE CHOISIT
-- PAS laquelle garder : elle echoue avec leur nombre. L'operateur regarde,
-- decide, puis rejoue.
--
-- Prevol (lecture seule) :
--
--   select user_id, user_avatar_id, avatar_version, voice_id, aspect_ratio,
--          md5(script), count(*)
--     from public.avatar_generations
--    where intention = 'normale' and voice_id like 'jumeau:%'
--      and status in ('pending', 'processing')
--    group by 1, 2, 3, 4, 5, 6
--   having count(*) > 1;
--
-- ---------------------------------------------------------------------------
-- 4. L'INDEX
-- ---------------------------------------------------------------------------

do $$
declare
  identites_en_double integer;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'avatar_generations' and column_name = 'avatar_version'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'avatar_generations' and column_name = 'intention'
  ) then
    raise exception 'avatar_generations.avatar_version / intention absentes : appliquer 2026-09-15-avatar-schema-foundation.sql d''abord';
  end if;

  if exists (
    select 1 from pg_indexes
     where schemaname = 'public' and indexname = 'avatar_generations_jumeau_en_vol_uidx'
  ) then
    return; -- deja appliquee : rejouable
  end if;

  select count(*) into identites_en_double
    from (
      select 1
        from public.avatar_generations
       where intention = 'normale'
         and voice_id like 'jumeau:%'
         and status in ('pending', 'processing')
       group by user_id, user_avatar_id, avatar_version, voice_id, aspect_ratio, md5(script)
      having count(*) > 1
    ) d;

  if identites_en_double > 0 then
    raise exception
      'JUMEAU : % identite(s) de generation ont plusieurs lignes en vol ; aucune ligne n''est supprimee automatiquement. Executer le prevol (section 3), decider, puis rejouer.',
      identites_en_double;
  end if;
end $$;

create unique index if not exists avatar_generations_jumeau_en_vol_uidx
  on public.avatar_generations (user_id, user_avatar_id, avatar_version, voice_id, aspect_ratio, md5(script))
  where intention = 'normale'
    and voice_id like 'jumeau:%'
    and status in ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- 5. APRES APPLICATION
-- ---------------------------------------------------------------------------
--
-- Un index ne change pas le cache de schema de PostgREST : aucun
-- rechargement n'est requis. Controle (lecture seule) :
--
--   select indexdef from pg_indexes
--    where schemaname = 'public' and indexname = 'avatar_generations_jumeau_en_vol_uidx';
