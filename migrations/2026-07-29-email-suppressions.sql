-- Delivrabilite email — liste de suppression locale (desabonnements)
-- A executer sur la base Postgres auto-hebergee (studiio-db).
--
-- Une seule table NOUVELLE, aucune modification de table existante : cette
-- migration ne peut pas casser l'existant.
--
-- POURQUOI CETTE TABLE
-- Gmail exige un desabonnement « un clic » (en-tetes List-Unsubscribe +
-- List-Unsubscribe-Post) dont l'URL doit repondre 200 ET produire un effet
-- reel. La liste opt-in d'afroboost reste la source de verite des envois,
-- mais elle ne fournit pas de jeton par destinataire : on tient donc une
-- liste de suppression locale, relue avant CHAQUE envoi, en plus du
-- transfert best-effort vers afroboost.
--
-- TANT QUE CETTE MIGRATION N'EST PAS APPLIQUEE
-- Le code degrade proprement : la lecture echoue, la liste de suppression est
-- consideree vide et les envois se comportent exactement comme aujourd'hui.
-- Aucune regression, seulement l'absence de la nouvelle protection.

create table if not exists email_suppressions (
  -- Adresse normalisee (minuscules, sans espaces) : clef primaire, donc un
  -- desabonnement repete est idempotent.
  email text primary key,
  -- 'one-click' (en-tete Gmail) | 'link' (lien visible) | 'manual'
  reason text not null default 'one-click',
  created_at timestamptz not null default now()
);

create index if not exists email_suppressions_created_at_idx
  on email_suppressions (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- DROITS POSTGREST
--
-- Sans ce grant, PostgREST voit bien la table mais repond
-- « table not in schema cache » / 404 : le role utilise par PostgREST n'a
-- aucun droit dessus, donc la table n'entre pas dans le cache de schema.
-- ─────────────────────────────────────────────────────────────────────────
grant all on table public.email_suppressions to public;

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ APRES CETTE MIGRATION — ETAPE OBLIGATOIRE
--
-- PostgREST met son schema en cache au demarrage. Tant qu'il n'est pas
-- recharge, toute table fraichement creee reste invisible et l'API renvoie
-- « Could not find the table ... in the schema cache ».
--
-- Recharger le cache (sur le serveur Hetzner) :
--
--     docker kill -s SIGUSR1 studiio-postgrest
--
-- Cette commande ne redemarre PAS le conteneur : elle demande juste a
-- PostgREST de relire le schema. A refaire apres CHAQUE migration qui cree
-- ou modifie une table, sinon le bug se reproduira a l'identique.
-- ─────────────────────────────────────────────────────────────────────────
