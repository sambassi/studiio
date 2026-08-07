-- Notifications in-app — la cloche du tableau de bord.
--
-- ⚠️ IL N'EN EXISTAIT AUCUNE. La cloche de `Navbar.tsx` était un bouton
-- décoratif : pas de gestionnaire de clic, une pastille rouge écrite en dur,
-- aucune source de données. `/api/admin/notifications` ne règle, lui, que les
-- alertes EMAIL de l'administrateur. Cette table est donc le socle, pas la
-- réutilisation d'un mécanisme existant.
--
-- Une seule table NOUVELLE, aucune modification de table existante : cette
-- migration ne peut pas casser l'existant.
--
-- TANT QU'ELLE N'EST PAS APPLIQUÉE
--
-- Le code dégrade proprement : la cloche reste muette et l'Autopilote retombe
-- sur son seul email, exactement comme aujourd'hui. Rien n'échoue.

create table if not exists user_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- Famille de l'évènement (`autopilote-sans-rush`, `autopilote-rush-introuvable`…).
  -- C'est elle qui porte l'anti-doublon : voir l'index ci-dessous.
  kind text not null,
  title text not null,
  body text,
  -- Où emmener l'utilisateur au clic. NULL = nulle part.
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- ⚠️ CET INDEX EST CE QUI EMPÊCHE LE HARCÈLEMENT. Le déclencheur de
-- l'Autopilote passe TOUTES LES HEURES, et son refus « sans rush » est rendu
-- AVANT le test d'heure : sans anti-doublon, un compte à la banque vide
-- recevrait vingt-quatre notifications — et vingt-quatre emails — par jour.
-- La lecture se fait sur (user_id, kind, created_at), d'où cet ordre.
create index if not exists user_notifications_user_kind_idx
  on user_notifications (user_id, kind, created_at desc);

-- La cloche ne lit que les non-lues, les plus récentes d'abord.
create index if not exists user_notifications_unread_idx
  on user_notifications (user_id, created_at desc)
  where read_at is null;

-- ─────────────────────────────────────────────────────────────────────────
-- DROITS POSTGREST
--
-- Sans ce grant, PostgREST voit bien la table mais répond « table not in
-- schema cache » / 404 : le rôle utilisé par PostgREST n'a aucun droit
-- dessus, donc la table n'entre jamais dans le cache de schéma.
-- ─────────────────────────────────────────────────────────────────────────
grant all on table public.user_notifications to public;

-- ─────────────────────────────────────────────────────────────────────────
-- ⚠️ APRÈS CETTE MIGRATION — ÉTAPE OBLIGATOIRE
--
--     docker kill -s SIGUSR1 studiio-postgrest
--
-- Cette commande ne redémarre PAS le conteneur : elle demande juste à
-- PostgREST de relire le schéma. À refaire après CHAQUE migration qui crée ou
-- modifie une table.
-- ─────────────────────────────────────────────────────────────────────────
