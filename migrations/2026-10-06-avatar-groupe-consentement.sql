-- Jumeau vidéo (digital twin) : identifiant de GROUPE chez le fournisseur et
-- statut de son consentement filmé. Additif, sans perte, nullable.
-- provider_group_id      : groupe d'avatar (sert au consentement et à son suivi)
-- provider_group_consent : 'pending' | 'accepted' | 'rejected' | NULL (non demandé)
alter table public.user_avatars
  add column if not exists provider_group_id text,
  add column if not exists provider_group_consent text;
-- Table déjà exposée à PostgREST : recharger seulement le cache de schéma.
-- puis : docker kill -s SIGUSR1 studiio-postgrest
