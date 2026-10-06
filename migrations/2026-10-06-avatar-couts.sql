-- Coût des générations d'avatar (Mon jumeau) — additif, sans perte.
-- provider_cost_eur : coût externe (vidéo + voix), NULL si non mesurable.
-- studiio_credits / studiio_price_eur : ce que Studiio a facturé (0 pour un admin).
-- margin_eur : prix Studiio − coût externe (négatif pour un usage admin).
-- provider_error : erreur brute du fournisseur — ADMIN uniquement, jamais rendue à l'utilisateur.
alter table public.avatar_generations
  add column if not exists provider_cost_eur numeric(12,4),
  add column if not exists studiio_credits integer,
  add column if not exists studiio_price_eur numeric(12,4),
  add column if not exists margin_eur numeric(12,4),
  add column if not exists admin_usage boolean,
  add column if not exists provider_error text;

-- Table déjà exposée à PostgREST : recharger seulement le cache de schéma.
-- puis : docker kill -s SIGUSR1 studiio-postgrest
