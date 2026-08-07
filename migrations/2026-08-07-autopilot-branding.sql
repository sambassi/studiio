-- Autopilote — l'identité CONSTANTE d'un compte.
--
-- Ce que l'Autopilote fait VARIER d'une vidéo à l'autre (affiche, textes,
-- rush) n'a rien à faire en base : c'est produit à chaque cycle. Ces colonnes
-- portent l'inverse — ce que l'utilisateur règle UNE fois et que TOUTES les
-- vidéos suivantes héritent : couleurs, musique, voix clonée, fond des cartes,
-- son du rush et niveaux du mixeur.
--
-- ⚠️ DEUX DÉFAUTS CHANGENT LE COMPORTEMENT, ET C'EST VOULU.
--
--   `cards_show_poster = false` — les cartes s'affichent sur les couleurs
--   choisies, plus derrière la photo d'affiche. L'affiche variée reste sur la
--   séquence titre.
--
--   `keep_rush_audio = false` — le son du rush est coupé. L'Autopilote pose
--   une musique et, en option, une voix off : garder en plus l'ambiance du
--   rush donnait trois pistes concurrentes que personne n'avait demandées.
--
-- Les autres défauts reprennent EXACTEMENT les valeurs actuellement en dur
-- dans `buildAutopilotDesign` (`DEFAULT_COLORS` de `designSpec`) : une
-- configuration existante ne change donc pas de couleurs.

alter table public.autopilot_config
  add column if not exists card_gradient_start text    not null default '#7C3AED',
  add column if not exists card_gradient_end   text    not null default '#EC4899',
  add column if not exists title_color         text    not null default '#FFFFFF',
  -- Cartes SANS photo d'affiche par défaut.
  add column if not exists cards_show_poster   boolean not null default false,
  -- Musique de fond, commune à toutes les vidéos. NULL = aucune.
  add column if not exists music_url           text,
  -- Voix clonée choisie (`user_voices`), identifiant préfixé `elevenlabs-…`.
  -- NULL = la voix par défaut du serveur (`ELEVENLABS_VOICE_ID`).
  add column if not exists voice_id            text,
  -- Garder le son du rush ? Non par défaut.
  add column if not exists keep_rush_audio     boolean not null default false,
  -- Mixeur — trois niveaux indépendants, 0 à 1.
  add column if not exists music_volume        real    not null default 0.8,
  add column if not exists voice_volume        real    not null default 1.0,
  add column if not exists rush_volume         real    not null default 0.5;

-- Les niveaux sont bornés en base AUSSI, pas seulement dans `sanitizeConfig` :
-- une écriture directe (script de migration, correction à la main) ne doit pas
-- pouvoir poser un gain de 40 qui saturerait le montage.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'autopilot_config_volumes_bornes'
  ) then
    alter table public.autopilot_config
      add constraint autopilot_config_volumes_bornes check (
        music_volume between 0 and 1
        and voice_volume between 0 and 1
        and rush_volume  between 0 and 1
      );
  end if;
end $$;

-- Sans ces deux étapes, PostgREST répond « Could not find the table ... in the
-- schema cache » (cf. CLAUDE.md) : les colonnes existent en base mais restent
-- invisibles à l'application.
grant all on table public.autopilot_config to public;

-- Puis, sur le serveur :
--   docker kill -s SIGUSR1 studiio-postgrest
