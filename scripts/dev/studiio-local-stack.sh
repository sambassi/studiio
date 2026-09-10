#!/usr/bin/env bash
#
# STUDIIO — LE BACKEND LOCAL, REPRODUCTIBLE ET PERSISTANT.
#
# ═════════════════════════════════════════════════════════════════════════════
# POURQUOI CE SCRIPT EXISTE
# ═════════════════════════════════════════════════════════════════════════════
#
# L'environnement local (PostgreSQL + PostgREST + MinIO) avait deja ete monte
# une fois, a la main, dans un repertoire temporaire. Un redemarrage l'a efface
# entierement : cluster, donnees MinIO, configuration PostgREST, secret JWT. Il
# n'en restait qu'un `.env.local` pointant vers un port ou plus rien n'ecoutait,
# et une journee de travail pour tout redecouvrir.
#
# ⚠️ D'OU LA REGLE QUE CE FICHIER EXISTE POUR TENIR : LES DONNEES NE VONT
# JAMAIS DANS /tmp. Ni PGDATA, ni le stockage MinIO, ni les configurations.
# Tout vit sous $STUDIIO_LOCAL_ROOT (par defaut ~/.studiio-local), qui survit
# aux redemarrages.
#
# ⚠️ ET CE SCRIPT NE POINTE JAMAIS VERS LA PRODUCTION. Il ne lit aucun secret
# distant, ne contacte ni Hetzner, ni Supabase cloud, ni aucun fournisseur. Il
# refuse de demarrer si on lui designe autre chose que la boucle locale. Ce
# n'est pas une precaution decorative : un script d'amorcage qui accepte une
# URL distante finit un jour par rejouer des migrations en production.
#
# ═════════════════════════════════════════════════════════════════════════════
# CE QU'IL NE FAIT PAS
# ═════════════════════════════════════════════════════════════════════════════
#
# Il n'efface rien. `bootstrap` sur un cluster deja initialise le RECONNAIT et
# passe son chemin ; il n'existe aucune commande `reset` destructive, parce
# qu'une commande qui detruit des donnees finit toujours par etre tapee par
# reflexe a la place de `start`.
#
# Il n'installe rien non plus : si un binaire manque, il le dit et s'arrete.
#
# ═════════════════════════════════════════════════════════════════════════════
# USAGE
# ═════════════════════════════════════════════════════════════════════════════
#
#   scripts/dev/studiio-local-stack.sh bootstrap   # cree ce qui manque, puis demarre
#   scripts/dev/studiio-local-stack.sh start       # demarre les services arretes
#   scripts/dev/studiio-local-stack.sh stop        # arrete les services (garde les donnees)
#   scripts/dev/studiio-local-stack.sh status      # etat de chaque service
#   scripts/dev/studiio-local-stack.sh psql [...]  # ouvre un psql sur la base locale
#   scripts/dev/studiio-local-stack.sh help
#
# Les trois premieres sont idempotentes : les relancer ne casse rien.
#
set -euo pipefail

# ── Ou vivent les donnees ────────────────────────────────────────────────────
# Surchargeable, mais JAMAIS vers un repertoire ephemere : la garde ci-dessous
# refuse /tmp explicitement.
ROOT="${STUDIIO_LOCAL_ROOT:-$HOME/.studiio-local}"
case "$ROOT" in
  /tmp/*|/private/tmp/*|/var/tmp/*)
    echo "ERREUR: STUDIIO_LOCAL_ROOT ne doit pas etre un repertoire temporaire ($ROOT)." >&2
    echo "        Ces donnees doivent survivre a un redemarrage." >&2
    exit 1;;
esac

PGDATA="$ROOT/postgres"
MINIO_DATA="$ROOT/minio"
PGRST_DIR="$ROOT/postgrest"
LOGS="$ROOT/logs"
RUN="$ROOT/run"
SECRETS="$ROOT/secrets.env"

# ── Adresses : boucle locale uniquement, jamais 0.0.0.0 ──────────────────────
PGHOST=127.0.0.1
PGPORT="${STUDIIO_LOCAL_PGPORT:-5433}"
DB=studiio_local
PGRST_HOST=127.0.0.1
PGRST_PORT=3011          # attendu tel quel par SUPABASE_URL dans .env.local
# ⚠️ POSTGREST N'EST PAS EN FRONT. `supabase-js` prefixe ses appels de
# `/rest/v1` ; PostgREST nu repond « Invalid path specified in request URL ».
# Un proxy minuscule tient le port 3011 et retire le prefixe, exactement comme
# `studiio-pgrst-proxy` le fait en production. PostgREST, lui, ecoute derriere.
PGRST_AMONT_PORT="${STUDIIO_LOCAL_PGRST_AMONT_PORT:-3012}"
MINIO_HOST=127.0.0.1
MINIO_PORT=9010          # attendu tel quel par MINIO_PORT dans .env.local
MINIO_CONSOLE_PORT="${STUDIIO_LOCAL_MINIO_CONSOLE_PORT:-9011}"

# L'identite de developpement est une constante de l'APPLICATION
# (`DEV_SESSION` dans src/lib/auth/config.ts), pas l'identite de quelqu'un.
DEV_USER_ID='00000000-0000-4000-8000-000000000000'
DEV_USER_EMAIL='dev@localhost'

# Les compartiments que l'application utilise reellement.
BUCKETS=(media videos images audio)

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# ── Les binaires PostgreSQL ──────────────────────────────────────────────────
# ⚠️ LA 16 EST CHOISIE EXPRESSEMENT. La production tourne sur `postgres:16` ;
# amorcer en local sur une majeure differente ferait passer des migrations qui
# echoueraient ensuite ailleurs, ou l'inverse. Le PATH pointe souvent vers une
# autre majeure installee a cote, d'ou la resolution explicite.
PGBIN=""
for c in /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin; do
  [ -x "$c/initdb" ] && PGBIN="$c" && break
done
if [ -z "$PGBIN" ] && command -v initdb >/dev/null 2>&1; then
  if initdb --version 2>/dev/null | grep -q ' 16\.'; then
    PGBIN="$(dirname "$(command -v initdb)")"
  fi
fi

info() { printf '  %s\n' "$*"; }
titre() { printf '\n=== %s ===\n' "$*"; }
mort() { printf 'ERREUR: %s\n' "$*" >&2; exit 1; }

exiger_binaires() {
  [ -n "$PGBIN" ] || mort "PostgreSQL 16 introuvable (postgresql@16). Rien n'est installe automatiquement."
  command -v postgrest >/dev/null 2>&1 || mort "postgrest introuvable. Rien n'est installe automatiquement."
  command -v minio >/dev/null 2>&1 || mort "minio introuvable. Rien n'est installe automatiquement."
}

# ── Secrets LOCAUX, generes ici, jamais versionnes ───────────────────────────
# Le depot ne contient aucune valeur : elles naissent sur la machine, dans un
# fichier lisible par son seul proprietaire.
charger_secrets() {
  if [ ! -f "$SECRETS" ]; then
    mkdir -p "$ROOT"
    umask 077
    {
      echo "# Secrets LOCAUX generes par studiio-local-stack.sh — ne jamais versionner."
      echo "PGRST_JWT_SECRET=$(openssl rand -hex 32)"
      echo "AUTHENTICATOR_PASSWORD=$(openssl rand -hex 24)"
    } > "$SECRETS"
    chmod 600 "$SECRETS"
  fi
  # shellcheck disable=SC1090
  . "$SECRETS"
}

# Un jeton HS256 aux memes claims que ceux qu'attend supabase-js.
jeton() {
  local role="$1" secret="$2" h p sig
  h=$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  p=$(printf '{"role":"%s","iss":"studiio-local","iat":1600000000,"exp":4102444800}' "$role" \
      | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  sig=$(printf '%s.%s' "$h" "$p" \
      | openssl dgst -sha256 -hmac "$secret" -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')
  printf '%s.%s.%s' "$h" "$p" "$sig"
}

pg_en_marche() { "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; }
pid_vivant() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

psql_admin() { "$PGBIN/psql" -h "$RUN" -p "$PGPORT" -U studiio -v ON_ERROR_STOP=1 "$@"; }

# ═════════════════════════════════════════════════════════════════════════════
# BOOTSTRAP
# ═════════════════════════════════════════════════════════════════════════════

initialiser_cluster() {
  if [ -f "$PGDATA/PG_VERSION" ]; then
    info "cluster deja initialise ($PGDATA) — laisse tel quel"
    return
  fi
  info "initdb dans $PGDATA"
  "$PGBIN/initdb" -D "$PGDATA" -U studiio --encoding=UTF8 \
    --auth-local=trust --auth-host=scram-sha-256 >/dev/null

  # ⚠️ BOUCLE LOCALE UNIQUEMENT. Un cluster de developpement qui ecoute sur
  # 0.0.0.0 est joignable par tout le reseau du cafe ou l'on travaille.
  {
    echo "listen_addresses = '$PGHOST'"
    echo "port = $PGPORT"
    echo "unix_socket_directories = '$RUN'"
  } >> "$PGDATA/postgresql.conf"
}

demarrer_postgres() {
  pg_en_marche && { info "postgres deja demarre"; return; }
  "$PGBIN/pg_ctl" -D "$PGDATA" -l "$LOGS/postgres.log" -w start >/dev/null
  info "postgres demarre sur $PGHOST:$PGPORT"
}

creer_roles_et_base() {
  # ⚠️ AUCUN SUPERUSER N'EST EXPOSE A POSTGREST. `authenticator` ne peut rien
  # par lui-meme : il ne sait que devenir `anon` ou `service_role`.
  psql_admin -d postgres -q <<SQL
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end \$\$;

-- Le service applicatif traverse RLS, comme chez Supabase : les regles de
-- securite du produit vivent dans les routes, pas dans des policies qui
-- n'existent pas sur cette base.
alter role service_role bypassrls;
alter role authenticator password '${AUTHENTICATOR_PASSWORD}';
grant anon, service_role to authenticator;
SQL

  if ! psql_admin -d postgres -tAc "select 1 from pg_database where datname = '$DB'" | grep -q 1; then
    psql_admin -d postgres -q -c "create database $DB owner studiio"
    info "base $DB creee"
  else
    info "base $DB deja presente — laissee intacte"
  fi
}

# Le schema de base, puis les migrations du depot, dans l'ordre chronologique.
#
# ⚠️ `002_complete_schema.sql` EST JOUE SANS SES POLICIES, ET C'EST DOCUMENTE
# DANS LE DEPOT LUI-MEME : `tests-pg/schema-prealable.sql` explique que ce
# fichier contient `CREATE POLICY IF NOT EXISTS`, une syntaxe qui n'existe dans
# aucune version de PostgreSQL, et des appels a `auth.uid()`, fonction du
# schema `auth` de Supabase absent d'un Postgres nu. Les lignes retirees sont
# affichees a l'ecran : rien n'est saute en silence.
appliquer_schema() {
  local deja
  deja=$(psql_admin -d "$DB" -tAc \
    "select count(*) from information_schema.tables where table_schema='public'")
  if [ "$deja" -gt 0 ]; then
    info "schema deja present ($deja tables) — aucune migration rejouee"
    return
  fi

  info "schema de base : 001_initial_schema.sql"
  psql_admin -d "$DB" -q -f "$REPO/src/lib/db/migrations/001_initial_schema.sql"

  local filtre="$RUN/002-sans-policies.sql"
  grep -viE '^[[:space:]]*CREATE POLICY IF NOT EXISTS' \
    "$REPO/src/lib/db/migrations/002_complete_schema.sql" > "$filtre"
  info "schema de base : 002_complete_schema.sql (policies Supabase ecartees) :"
  grep -niE '^[[:space:]]*CREATE POLICY IF NOT EXISTS' \
    "$REPO/src/lib/db/migrations/002_complete_schema.sql" | sed 's/^/      ecarte /'
  psql_admin -d "$DB" -q -f "$filtre"
  rm -f "$filtre"

  info "schema de base : 004_admin_panel.sql"
  psql_admin -d "$DB" -q -f "$REPO/src/lib/db/migrations/004_admin_panel.sql"

  # ⚠️ ON_ERROR_STOP EST DANS psql_admin : une migration qui echoue arrete la
  # chaine. Une base a moitie migree qu'on presenterait comme prete est pire
  # qu'une base absente — elle ment.
  local f
  for f in $(ordre_migrations); do
    info "migration : $(basename "$f")"
    psql_admin -d "$DB" -q -f "$f"
  done
}

# L'ordre des migrations : le nom de fichier porte la date, donc le tri
# alphabetique donne la chronologie — SAUF entre deux fichiers du MEME JOUR.
#
# ⚠️ `2026-07-28-avatar-type.sql` MODIFIE la table que `2026-07-28-user-avatars.sql`
# CREE, et « avatar » vient avant « user ». En production l'ordre a ete celui
# de la main qui les a jouees ; sur une base vierge, le tri seul echoue avec
# « la relation public.user_avatars n'existe pas ». Les dependances de meme
# date sont donc declarees ici, explicitement, plutot que devinees.
#
# Format : "fichier_dependant:fichier_prealable".
DEPENDANCES_MEME_JOUR=(
  "2026-07-28-avatar-type.sql:2026-07-28-user-avatars.sql"
)

ordre_migrations() {
  local liste couple cheminD cheminP
  liste=$(ls "$REPO"/migrations/*.sql | sort)
  for couple in "${DEPENDANCES_MEME_JOUR[@]}"; do
    cheminD="$REPO/migrations/${couple%%:*}"
    cheminP="$REPO/migrations/${couple##*:}"
    [ -f "$cheminD" ] && [ -f "$cheminP" ] || continue
    # Le prealable est retire de sa place, puis reinsere juste avant son
    # dependant.
    liste=$(printf '%s\n' "$liste" | grep -vxF "$cheminP")
    liste=$(printf '%s\n' "$liste" | awk -v d="$cheminD" -v p="$cheminP" \
      '$0 == d { print p } { print }')
  done
  printf '%s\n' "$liste"
}

# Les droits que le depot pose deja migration par migration (`grant all on
# table ... to public`), etendus a ce qui existe et a ce qui viendra. PostgREST
# ne voit une table qu'a cette condition.
poser_droits() {
  psql_admin -d "$DB" -q <<SQL
grant usage on schema public to anon, service_role;
grant all on all tables in schema public to anon, service_role;
grant all on all sequences in schema public to anon, service_role;
grant execute on all functions in schema public to anon, service_role;
alter default privileges in schema public
  grant all on tables to anon, service_role;
alter default privileges in schema public
  grant execute on functions to anon, service_role;
SQL
}

# L'utilisateur de developpement, celui que sert `DEV_AUTH_BYPASS`.
semer_utilisateur_dev() {
  psql_admin -d "$DB" -q <<SQL
insert into public.users (id, email, name, credits, plan)
values ('$DEV_USER_ID', '$DEV_USER_EMAIL', 'Developpement local', 1000, 'pro')
on conflict (id) do nothing;
SQL
  info "utilisateur de developpement present ($DEV_USER_EMAIL)"
}

ecrire_conf_postgrest() {
  mkdir -p "$PGRST_DIR"
  umask 077
  cat > "$PGRST_DIR/postgrest.conf" <<CONF
db-uri = "postgres://authenticator:${AUTHENTICATOR_PASSWORD}@${PGHOST}:${PGPORT}/${DB}"
db-schemas = "public"
db-anon-role = "anon"
server-host = "${PGRST_HOST}"
server-port = ${PGRST_AMONT_PORT}
jwt-secret = "${PGRST_JWT_SECRET}"
CONF
  chmod 600 "$PGRST_DIR/postgrest.conf"
}

# ⚠️ LES JETONS DE `.env.local` DOIVENT ETRE SIGNES PAR CE SECRET-CI. Le secret
# precedent a disparu avec l'ancien environnement ; les jetons qu'il avait
# signes ne valent plus rien. On les remplace — et seulement eux — apres une
# sauvegarde. `.env.local` est ignore par git : rien de tout ceci n'est
# versionne.
synchroniser_env_local() {
  local env="$REPO/.env.local" attendu
  [ -f "$env" ] || { info ".env.local absent — rien a synchroniser"; return; }
  attendu=$(jeton service_role "$PGRST_JWT_SECRET")
  if grep -qF "SUPABASE_SERVICE_KEY=$attendu" "$env"; then
    info ".env.local deja aligne sur le secret local"
    return
  fi
  # ⚠️ LA SAUVEGARDE SORT DU DEPOT. `.gitignore` ne couvre que `.env.local` :
  # un `.env.local.avant-stack-local` depose a cote resterait non suivi, visible
  # dans chaque `git status`, et finirait un jour dans un `git add -A`.
  local sauvegardes="$ROOT/env-local-sauvegardes"
  mkdir -p "$sauvegardes"
  ( umask 077; cp "$env" "$sauvegardes/env.local-$(date +%Y%m%d-%H%M%S)" )
  local tmp="$RUN/env.tmp"
  sed -e "s|^SUPABASE_SERVICE_KEY=.*|SUPABASE_SERVICE_KEY=$attendu|" \
      -e "s|^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*|NEXT_PUBLIC_SUPABASE_ANON_KEY=$attendu|" \
      "$env" > "$tmp" && mv "$tmp" "$env"
  info "jetons de .env.local resignes (sauvegarde : $sauvegardes)"
  info "⚠️  redemarrer next dev pour qu'il relise .env.local"
}

demarrer_postgrest() {
  local i
  if pid_vivant "$RUN/postgrest.pid"; then
    info "postgrest deja demarre"
  else
    ( postgrest "$PGRST_DIR/postgrest.conf" >> "$LOGS/postgrest.log" 2>&1 & echo $! > "$RUN/postgrest.pid" )
    for i in $(seq 1 40); do
      curl -fsS -o /dev/null "http://$PGRST_HOST:$PGRST_AMONT_PORT/" 2>/dev/null && break
      sleep 0.25
    done
    info "postgrest sur http://$PGRST_HOST:$PGRST_AMONT_PORT (amont)"
  fi

  if pid_vivant "$RUN/pgrst-proxy.pid"; then
    info "proxy /rest/v1 deja demarre"
    return
  fi
  ( node "$REPO/scripts/dev/pgrst-proxy.cjs" "$PGRST_PORT" "$PGRST_AMONT_PORT" \
      >> "$LOGS/pgrst-proxy.log" 2>&1 & echo $! > "$RUN/pgrst-proxy.pid" )
  for i in $(seq 1 40); do
    curl -fsS -o /dev/null "http://$PGRST_HOST:$PGRST_PORT/" 2>/dev/null && break
    sleep 0.25
  done
  info "proxy /rest/v1 sur http://$PGRST_HOST:$PGRST_PORT"
}

# MinIO en mono-disque : un compartiment est un repertoire de premier niveau.
# Les creer avant le demarrage evite d'exiger un client S3 supplementaire.
demarrer_minio() {
  local b
  for b in "${BUCKETS[@]}"; do mkdir -p "$MINIO_DATA/$b"; done
  if pid_vivant "$RUN/minio.pid"; then info "minio deja demarre"; return; fi
  [ -f "$REPO/.env.local" ] || mort ".env.local absent : identifiants MinIO introuvables"
  local u p
  u=$(grep '^MINIO_ROOT_USER=' "$REPO/.env.local" | cut -d= -f2-)
  p=$(grep '^MINIO_ROOT_PASSWORD=' "$REPO/.env.local" | cut -d= -f2-)
  [ -n "$u" ] && [ -n "$p" ] || mort "MINIO_ROOT_USER / MINIO_ROOT_PASSWORD absents de .env.local"
  ( MINIO_ROOT_USER="$u" MINIO_ROOT_PASSWORD="$p" \
    minio server "$MINIO_DATA" \
      --address "$MINIO_HOST:$MINIO_PORT" \
      --console-address "$MINIO_HOST:$MINIO_CONSOLE_PORT" \
      >> "$LOGS/minio.log" 2>&1 & echo $! > "$RUN/minio.pid" )
  local i
  for i in $(seq 1 40); do
    curl -fsS -o /dev/null "http://$MINIO_HOST:$MINIO_PORT/minio/health/live" 2>/dev/null && break
    sleep 0.25
  done
  info "minio sur http://$MINIO_HOST:$MINIO_PORT (compartiments : ${BUCKETS[*]})"
}

# ═════════════════════════════════════════════════════════════════════════════
# COMMANDES
# ═════════════════════════════════════════════════════════════════════════════

cmd_bootstrap() {
  exiger_binaires
  mkdir -p "$ROOT" "$LOGS" "$RUN" "$MINIO_DATA" "$PGRST_DIR"
  charger_secrets
  titre "PostgreSQL"
  initialiser_cluster
  demarrer_postgres
  creer_roles_et_base
  appliquer_schema
  poser_droits
  semer_utilisateur_dev
  titre "PostgREST"
  ecrire_conf_postgrest
  synchroniser_env_local
  demarrer_postgrest
  titre "MinIO"
  demarrer_minio
  titre "Etat"
  cmd_status
}

cmd_start() {
  exiger_binaires
  mkdir -p "$LOGS" "$RUN"
  [ -f "$PGDATA/PG_VERSION" ] || mort "cluster absent — lancer d'abord : $0 bootstrap"
  charger_secrets
  demarrer_postgres
  ecrire_conf_postgrest
  demarrer_postgrest
  demarrer_minio
  cmd_status
}

# Arret propre. Les donnees ne sont JAMAIS touchees ici.
cmd_stop() {
  local f
  for f in pgrst-proxy postgrest minio; do
    if pid_vivant "$RUN/$f.pid"; then
      kill "$(cat "$RUN/$f.pid")" 2>/dev/null || true
      info "$f arrete"
    else
      info "$f deja arrete"
    fi
    rm -f "$RUN/$f.pid"
  done
  if [ -n "$PGBIN" ] && pg_en_marche; then
    "$PGBIN/pg_ctl" -D "$PGDATA" -m fast -w stop >/dev/null
    info "postgres arrete"
  else
    info "postgres deja arrete"
  fi
}

cmd_status() {
  local pg="arrete" pr="arrete" px="arrete" mi="arrete" code
  [ -n "$PGBIN" ] && pg_en_marche && pg="actif"
  pid_vivant "$RUN/postgrest.pid" && pr="actif"
  pid_vivant "$RUN/pgrst-proxy.pid" && px="actif"
  pid_vivant "$RUN/minio.pid" && mi="actif"
  printf '  racine            %s\n' "$ROOT"
  printf '  postgres          %-8s %s:%s  base=%s\n' "$pg" "$PGHOST" "$PGPORT" "$DB"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://$PGRST_HOST:$PGRST_AMONT_PORT/" 2>/dev/null || echo 000)
  printf '  postgrest         %-8s http://%s:%s  http=%s\n' "$pr" "$PGRST_HOST" "$PGRST_AMONT_PORT" "$code"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://$PGRST_HOST:$PGRST_PORT/rest/v1/" 2>/dev/null || echo 000)
  printf '  proxy /rest/v1    %-8s http://%s:%s  http=%s\n' "$px" "$PGRST_HOST" "$PGRST_PORT" "$code"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://$MINIO_HOST:$MINIO_PORT/minio/health/live" 2>/dev/null || echo 000)
  printf '  minio             %-8s http://%s:%s  health=%s\n' "$mi" "$MINIO_HOST" "$MINIO_PORT" "$code"
  if [ "$pg" = "actif" ]; then
    printf '  tables (public)   %s\n' "$(psql_admin -d "$DB" -tAc \
      "select count(*) from information_schema.tables where table_schema='public'" 2>/dev/null || echo '?')"
  fi
}

cmd_psql() { exiger_binaires; psql_admin -d "$DB" "$@"; }

usage() {
  sed -n '2,50p' "${BASH_SOURCE[0]}" | sed 's/^#\{0,1\} \{0,1\}//'
}

case "${1:-help}" in
  bootstrap) cmd_bootstrap;;
  start)     cmd_start;;
  stop)      cmd_stop;;
  status)    exiger_binaires; cmd_status;;
  psql)      shift; cmd_psql "$@";;
  help|-h|--help) usage;;
  *) echo "commande inconnue : $1" >&2; usage; exit 1;;
esac
