-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK de `migrations/2026-10-10-avatar-identites-versions.sql`
--
-- Rangé dans `migrations/rollback/` : aucun outil qui applique
-- `migrations/*.sql` ne peut le jouer par erreur.
--
-- ORDRE : d'abord redéployer un commit qui n'utilise PAS ces tables /
-- fonctions (main d'avant la PR), PUIS jouer ce fichier, PUIS
--   docker kill -s SIGUSR1 studiio-postgrest
--
-- Le miroir (`user_avatars.version`, `provider_avatar_id`…) n'a jamais cessé
-- d'être la vérité de la version active : l'ancien code repart tel quel.
--
-- ⚠️ PRÉ-CONDITION : un seul avatar VIVANT par compte. L'index d'origine est
-- recréé ; s'il échoue, des identités supplémentaires ont été créées — les
-- archiver (deleted_at) une par une, en connaissance de cause, avant de rejouer.
--
-- Ce qui est PERDU : l'historique des versions (avatar_versions) et le lien
-- version des générations. Ce qui est GARDÉ : toutes les lignes
-- user_avatars, avatar_generations, autopilot_config, et les fichiers.
-- ═══════════════════════════════════════════════════════════════════════════

begin;
drop function if exists public.prendre_verrou_creation_avatar(uuid, uuid, integer);
drop function if exists public.liberer_verrou_creation_avatar(uuid, uuid);
drop table if exists public.avatar_verrous_creation;
drop function if exists public.activer_version_avatar(uuid, uuid, uuid, uuid);
drop function if exists public.definir_avatar_par_defaut(uuid, uuid);
alter table public.autopilot_config drop column if exists avatar_id;
alter table public.avatar_generations drop column if exists avatar_version_id;
alter table public.avatar_generations drop column if exists engine;
drop index if exists public.user_avatars_un_defaut_par_compte_uidx;
alter table public.user_avatars drop column if exists active_version_id;
alter table public.user_avatars drop column if exists is_default;
alter table public.user_avatars drop column if exists updated_at;
drop table if exists public.avatar_versions;
create unique index if not exists user_avatars_one_active_per_user_uidx
  on public.user_avatars (user_id)
  where deleted_at is null;
commit;
