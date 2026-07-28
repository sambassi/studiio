-- F9.0 — Avatar video (digital twin HeyGen)
-- A executer sur la base Postgres auto-hebergee (studiio-db).
--
-- Ajoute la nature de l'avatar. Le defaut 'photo' garantit que TOUTES les
-- lignes existantes gardent exactement le comportement actuel : la migration
-- ne peut pas casser le flux photo deja en production.

alter table public.user_avatars
  add column if not exists avatar_type text not null default 'photo';

-- Message d'erreur d'entrainement renvoye par HeyGen (statut 'failed'),
-- pour pouvoir l'afficher a l'utilisateur sans refaire un appel API.
alter table public.user_avatars
  add column if not exists training_error text;

-- ─────────────────────────────────────────────────────────────────────────
-- DROITS POSTGREST
-- Sans droits, PostgREST n'inscrit pas la table dans son cache de schema.
-- ─────────────────────────────────────────────────────────────────────────
grant all on table public.user_avatars, public.avatar_generations to public;

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
-- Recharger le cache de schema de PostgREST, sinon la nouvelle colonne reste
-- invisible et les insertions echouent :
--
--     docker kill -s SIGUSR1 studiio-postgrest
--
-- (ne redemarre pas le conteneur, demande juste la relecture du schema)
-- ─────────────────────────────────────────────────────────────────────────
