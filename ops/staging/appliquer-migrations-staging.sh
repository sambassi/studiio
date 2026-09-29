#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# STUDIIO STAGING — lot Stripe/DB : #474 → #470 → #471 (partie A) puis #472 (partie B)
#
#   bash appliquer-migrations-staging.sh A   # #474, #470, #471  (avant deploiement du code)
#   bash appliquer-migrations-staging.sh B   # #472              (APRES deploiement de main consolide)
#
# STAGING UNIQUEMENT : conteneurs trouves par alias sur `staging-net`, arret si
# la base est studiio-db / studiio-db-* (production). Aucun secret affiche.
# NE FAIT PAS la bascule PGRST_DB_ANON_ROLE / PGRST_DB_URI / nouvelle cle
# (etapes Coolify separees, runbook #474) : il se contente d'en montrer l'etat.
# Rejouable : chaque passage refait une sauvegarde ; les migrations sont rejouables.
# ═══════════════════════════════════════════════════════════════════════════
set -Eeuo pipefail
MAINPID=$$
PARTIE="${1:-}"; case "$PARTIE" in A|B) ;; *) echo "usage : $0 A|B   (A = #474 #470 #471 ; B = #472 apres deploiement du code)"; exit 64;; esac

TS="$(date +%Y%m%d-%H%M%S)"
D="${STG_BACKUP_DIR:-/root/studiio-staging-backups}"; mkdir -p "$D"; chmod 700 "$D"
LOG="$D/lot-stripe-$PARTIE-$TS.log"; : > "$LOG"; chmod 600 "$LOG"; exec > >(tee -a "$LOG") 2>&1
W="$D/lot-stripe-$TS"; ( umask 077; mkdir -p "$W" )
NET=staging-net
HEALTH_URL="${STG_HEALTH_URL:-https://staging.studiio.pro/api/health}"
R=(); APPLIQUEES=(); AVERT=0; BK=""
ok(){ R+=("PASS  $1"); echo "  [PASS] $1"; }
info(){ echo "  [INFO] $1"; }
warn(){ R+=("WARN  $1"); AVERT=1; echo "  [WARN] $1"; }

rollback_cmds(){
  [ -n "${DB:-}" ] || return 0
  local P="docker exec -i $DB psql -X -v ON_ERROR_STOP=1 -U $DU -d $DN -1 -f -"
  local S="docker kill -s SIGUSR1 $PG"
  echo "── ROLLBACK (ordre inverse de ce qui a ete applique dans CE passage) ──"
  if [ "${#APPLIQUEES[@]}" -eq 0 ]; then echo "  (aucune migration appliquee dans ce passage : rien a defaire)"; fi
  local i
  for (( i=${#APPLIQUEES[@]}-1; i>=0; i-- )); do
    case "${APPLIQUEES[$i]}" in
      472) echo "  # #472 users-contraintes (retire 2 index + 1 contrainte, garde stripe_customer_id)"
           echo "  $P < $W/migrations/472-users-contraintes.rollback.sql && $S";;
      471) echo "  # #471 stripe-events : D'ABORD redeployer un webhook qui n'appelle pas les RPC stripe_event_* / crediter_credits_stripe"
           echo "  $P < $W/migrations/471-stripe-events.rollback.sql && $S";;
      470) echo "  # #470 subscriptions.status (refuse de lui-meme si des lignes portent trialing/unpaid/...)"
           echo "  $P < $W/migrations/470-subscriptions-status.rollback.sql && $S";;
      474) echo "  # #474 moindre privilege : seulement si PostgREST n'a PAS ete bascule sur authenticator (sinon remettre d'abord PGRST_DB_URI/ANON_ROLE/cle)"
           echo "  $P < $W/migrations/474-postgrest-moindre-privilege.rollback.sql && $S";;
    esac
  done
  if [ -n "$BK" ]; then
    echo "  # Dernier recours (a la place des lignes ci-dessus) : base recreee a vide puis rechargee depuis la sauvegarde prise avant ce passage."
    echo "  # (un simple rechargement sans recreer la base NE retire PAS les objets/droits ajoutes depuis). Les roles restent (niveau cluster)."
    echo "  docker exec -i $DB psql -X -v ON_ERROR_STOP=1 -U $DU -d postgres -c 'drop database \"$DN\" with (force)' -c 'create database \"$DN\" owner \"$DU\"' && gunzip -c $BK | docker exec -i $DB psql -X -q -v ON_ERROR_STOP=1 -U $DU -d $DN && $S"
  fi
}
resume(){ echo; echo "════════════════ RESUME (partie $PARTIE) ════════════════"; printf '%s\n' "${R[@]}"; echo "Journal : $LOG"; [ -n "$BK" ] && echo "Sauvegarde : $BK"; return 0; }
fail(){ if [ "${BASHPID:-$MAINPID}" != "$MAINPID" ]; then echo "  [FAIL] $1" >&2; exit 1; fi; trap - ERR; R+=("FAIL  $1"); echo; echo "  [FAIL] $1"; resume; echo "ARRET au premier echec."; rollback_cmds; exit 1; }
trap 'fail "erreur inattendue ligne $LINENO"' ERR
envde(){ docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$2=//p"; }
alias_on(){ local c; for c in $(docker ps --format '{{.Names}}'); do
  if docker inspect "$c" --format "{{with index .NetworkSettings.Networks \"$1\"}}{{range .Aliases}}{{println .}}{{end}}{{end}}" 2>/dev/null | grep -qx "$2"; then echo "$c"; fi; done; return 0; }
un(){ [ "$(printf '%s\n' $2 | grep -c .)" = 1 ] || fail "$1 introuvable ou ambigu [$2]"; }

echo "══ STUDIIO STAGING — lot migrations partie $PARTIE — $TS ══"

# ── 0. Fichiers SQL embarques (identiques aux PR, verifies par sha256) ────────
( umask 077; base64 -d > "$W/lot.tgz" <<'FIN_BLOB'
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
FIN_BLOB
tar -xzf "$W/lot.tgz" -C "$W" )
sha(){ if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
while read -r h f; do [ -n "$f" ] || continue; [ "$(sha "$W/migrations/$f")" = "$h" ] || fail "empreinte $f"; done <<'FIN_SHA'
290d8d7c1cd7488405eb8588b775fc7bdfbe30f63548b26471db354d2407389e 470-subscriptions-status.rollback.sql
2f542247a9e9c9379a104f67f60eb918722dd140b86b7e899614b3f1777fbf52 470-subscriptions-status.sql
3b709b375a5cabdb433f8df3cb58a4b3f495a4ba0b7d3ebdb03f818c5ed5dce8 471-stripe-events.rollback.sql
1a9e4aa971b3a62156b151da381a1b28ddf0ab4684fc0e17a40d4c43ca8fd32e 471-stripe-events.sql
745d04eaf35a5f49657331e79a5c8df6587a63711474edbec1839709ccfd6f5d 472-users-contraintes.diagnostic.sql
45d54affe40b91f107f23f7ffa7a5d400e0372bf7753a458c6aca75d3ed96ace 472-users-contraintes.rollback.sql
0bb9d36402cccb0acde14289db615f7b27507ff1a4b43ab3be598287eedce4b5 472-users-contraintes.sql
e0ae7adabead8c7038bb66c24181e916044062c892b99a54720ad10d9353ddfa 474-postgrest-moindre-privilege.rollback.sql
a22ede96162fd19e2d091e2bd68b20c6ce2b817694e04f6865ba231a4b31140a 474-postgrest-moindre-privilege.sql
e094801fd0bb5b68c2e3aacf0476673ebb407fe94a99b0f0d6deed0648536967 474-postgrest-moindre-privilege.verif.sql
FIN_SHA
ok "10 fichiers SQL extraits dans $W/migrations (sha256 conformes)"

# ── 1. Identification STAGING par alias, garde anti-prod ─────────────────────
docker network inspect "$NET" >/dev/null 2>&1 || fail "reseau $NET absent"
PG="$(alias_on "$NET" studiio-staging-postgrest)";      un "postgrest staging" "$PG"
PROXY="$(alias_on "$NET" studiio-staging-pgrst-proxy)"; un "proxy staging" "$PROXY"
APP=""; for c in $(docker ps --format '{{.Names}}'); do
  if envde "$c" SUPABASE_URL | grep -qE '^http://studiio-staging-pgrst-proxy(:[0-9]+)?/?$'; then APP="${APP:+$APP }$c"; fi; done
un "app staging" "$APP"
U="$(envde "$PG" PGRST_DB_URI)"
H="$(printf '%s' "$U"  | sed -nE 's#^[a-z]+://([^@/]*@)?([^:/?]+).*#\2#p')"
DU="$(printf '%s' "$U" | sed -nE 's#^[a-z]+://([^:@/]+)(:[^@]*)?@.*#\1#p')"
DN="$(printf '%s' "$U" | sed -nE 's#^[a-z]+://[^/]*/([^?]+).*#\1#p')"; unset U
for v in "$H" "$DU" "$DN"; do [[ "$v" =~ ^[A-Za-z0-9._-]+$ ]] || fail "PGRST_DB_URI illisible"; done
DB="$(alias_on "$NET" "$H")"; un "base staging (hote $H)" "$DB"
case "$DB" in studiio-db|studiio-db-*) fail "la base resolue s'appelle $DB = PRODUCTION";; esac
for c in $PG $PROXY $APP; do case "$c" in studiio-postgrest|studiio-pgrst-proxy|studiio-app|studiio-minio) fail "conteneur de PRODUCTION resolu ($c)";; esac; done
SBU="$(envde "$APP" SUPABASE_URL)"; SBU="${SBU%/}"
ok "staging : app=$APP postgrest=$PG proxy=$PROXY db=$DB user=$DU base=$DN"
info "PGRST_DB_ANON_ROLE actuel = $(envde "$PG" PGRST_DB_ANON_ROLE)   (nom de role, pas un secret)"
SC="$(envde "$APP" SOURCE_COMMIT || true)"; info "commit deploye sur l'app staging (SOURCE_COMMIT Coolify) : ${SC:-inconnu}"

PS=(docker exec -i "$DB" psql -X -q -v ON_ERROR_STOP=1 -U "$DU" -d "$DN")
q(){ "${PS[@]}" -At -c "$1" </dev/null; }
runf(){ "${PS[@]}" -1 -f - < "$1"; }
[ "$(q "select rolsuper from pg_roles where rolname = current_user")" = t ] || fail "$DU n'est pas superuser (requis par #474)"
ok "$DU est superuser ; PostgreSQL $(q "show server_version")"

# ── 2. Sauvegarde complete avant tout changement ─────────────────────────────
BK="$D/avant-lot-stripe-$PARTIE-$TS.sql.gz"
( umask 077; docker exec "$DB" pg_dump -U "$DU" -d "$DN" --clean --if-exists --no-password | gzip -9 > "$BK" )
chmod 600 "$BK"
[ -s "$BK" ] && gzip -t "$BK" || fail "sauvegarde vide ou corrompue"
gunzip -c "$BK" | tail -n 5 | grep -q 'PostgreSQL database dump complete' || fail "sauvegarde incomplete"
ok "pg_dump complet : $BK ($(du -h "$BK" | cut -f1), chmod 600)"

# ── Controles communs ─────────────────────────────────────────────────────────
reload(){ docker kill -s SIGUSR1 "$PG" >/dev/null; sleep "${STG_RELOAD_WAIT:-3}"; ok "SIGUSR1 -> $PG (rechargement du cache de schema)"; }
sante(){
  local c; c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$HEALTH_URL" || echo 000)"
  [ "$c" = 200 ] || fail "sante app $HEALTH_URL -> $c (apres $1)"
  # App -> PostgREST avec SA cle serveur (lue dans le conteneur, jamais affichee) : code HTTP seul.
  c="$(docker exec "$APP" node -e '
    const k=process.env.SUPABASE_SERVICE_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY||"";
    const u=(process.env.SUPABASE_URL||"").replace(/\/$/,"")+"/users?select=id&limit=1";
    fetch(u,{headers:{apikey:k,Authorization:"Bearer "+k}}).then(r=>console.log(r.status)).catch(()=>console.log("000"));' 2>/dev/null || echo 000)"
  [ "$c" = 200 ] || fail "app -> PostgREST (cle serveur) /users -> $c (apres $1)"
  ok "sante apres $1 : $HEALTH_URL 200, app->PostgREST cle serveur 200"
}
verdict474(){
  local out ko
  out="$("${PS[@]}" -f - < "$W/migrations/474-postgrest-moindre-privilege.verif.sql" 2>&1)" || { echo "$out" > "$W/verif-474-$1.txt"; fail "verif.sql #474 en erreur (voir $W/verif-474-$1.txt)"; }
  ( umask 077; printf '%s\n' "$out" > "$W/verif-474-$1.txt" )
  ko="$(printf '%s\n' "$out" | sed -n '/== Z. VERDICT/,$p' | grep -E '\|[[:space:]]*KO[[:space:]]*$' || true)"
  [ -z "$ko" ] || { printf '%s\n' "$ko"; fail "verif #474 apres $1 : controle(s) KO"; }
  ok "verif #474 apres $1 : 9/9 OK (detail : $W/verif-474-$1.txt)"
}

# ═══ #474 — PostgREST moindre privilege ═══════════════════════════════════════
m474(){
  echo; echo "── #474 postgrest-moindre-privilege ──"
  info "roles avant : $(q "select coalesce(string_agg(rolname||'(super='||rolsuper||',login='||rolcanlogin||')', ' ' order by rolname),'-') from pg_roles where rolname in ('web_anon','service_role','authenticator','anon','authenticated') or (rolcanlogin and rolname !~ '^pg_')")"
  ( umask 077; "${PS[@]}" -f - < "$W/migrations/474-postgrest-moindre-privilege.verif.sql" > "$W/verif-474-instantane-avant.txt" 2>&1 || true )
  info "instantane avant (grants a PUBLIC a conserver) : $W/verif-474-instantane-avant.txt"
  info "attendu : 2 WARNING « already a transaction / no transaction in progress » (le fichier a son propre begin/commit sous psql -1)"
  runf "$W/migrations/474-postgrest-moindre-privilege.sql" || fail "migration #474"
  APPLIQUEES+=(474); ok "migration #474 appliquee"
  reload; verdict474 474; sante 474
}

# ═══ #470 — subscriptions.status ═════════════════════════════════════════════
m470(){
  echo; echo "── #470 subscriptions-status ──"
  [ "$(q "select to_regclass('public.subscriptions') is not null")" = t ] || fail "public.subscriptions absente : #470 ne s'applique pas"
  info "contraintes CHECK avant : $(q "select coalesce(string_agg(conname||'='||pg_get_constraintdef(oid), ' | '),'aucune') from pg_constraint where conrelid='public.subscriptions'::regclass and contype='c'")"
  info "statuts avant : $(q "select coalesce(string_agg(status||'='||n, ', ' order by status),'(table vide)') from (select status, count(*) n from public.subscriptions group by 1) t")"
  runf "$W/migrations/470-subscriptions-status.sql" || fail "migration #470"
  APPLIQUEES+=(470); ok "migration #470 appliquee"
  reload
  local n; n="$(q "select count(*) from pg_constraint where conrelid='public.subscriptions'::regclass and conname='subscriptions_status_check' and contype='c' and convalidated and (select count(*) from regexp_matches(pg_get_constraintdef(oid), '''[a-z_]+''', 'g')) = 9 and pg_get_constraintdef(oid) like '%''incomplete_expired''%' and pg_get_constraintdef(oid) like '%''paused''%'")"
  [ "$n" = 1 ] || fail "subscriptions_status_check absente, non validee ou incomplete"
  ok "subscriptions_status_check validee, 9 statuts"
  verdict474 470; sante 470
}

# ═══ #471 — stripe_events + crediter_credits_stripe ══════════════════════════
m471(){
  echo; echo "── #471 stripe-events ──"
  [ "$(q "select count(*) from pg_indexes where schemaname='public' and indexname='credit_transactions_reference_unique'")" = 1 ] \
    || fail "credit_transactions_reference_unique absent : appliquer d'abord 2026-08-27-credits-atomiques.sql"
  local reg; reg="$(q "select coalesce(to_regclass('public.stripe_events')::text,'')")"
  if [ -n "$reg" ]; then
    info "stripe_events existe deja : $(q "select string_agg(column_name||':'||data_type, ', ' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='stripe_events'")"
    [ "$(q "select count(*) from (select event_id from public.stripe_events group by 1 having count(*)>1) d")" = 0 ] || fail "stripe_events : event_id en double"
    [ "$(q "select count(*) from public.stripe_events where event_id is null")" = 0 ] || fail "stripe_events : event_id NULL"
  else info "stripe_events absente : sera creee (rollback sans drop table => garder en tete)"; fi
  [ "$(q "select count(*) from (select reference_id from public.credit_transactions where reference_id like 'stripe:%' group by 1 having count(*)>1) d")" = 0 ] || fail "credit_transactions : reference stripe en double"
  ok "pre-vol #471 : index 27 aout present, aucun doublon"
  runf "$W/migrations/471-stripe-events.sql" || fail "migration #471"
  APPLIQUEES+=(471); ok "migration #471 appliquee"
  reload
  # Controles posterieurs de la PR, dans une transaction ANNULEE (aucune trace laissee)
  local r; r="$("${PS[@]}" -At <<'SQL'
begin;
select 'c1='||public.stripe_event_claim('evt_controle_migration_staging','controle',1);
select 'c2='||coalesce(public.stripe_event_complete('evt_controle_migration_staging')::text,'void');
select 'c3='||public.stripe_event_claim('evt_controle_migration_staging','controle',1);
rollback;
SQL
)" || fail "controle claim/complete #471"
  printf '%s\n' "$r" | grep -qx 'c1=claimed' && printf '%s\n' "$r" | grep -qx 'c3=already_processed' || fail "claim/complete/claim : $(echo $r)"
  ok "stripe_event_claim/complete : claimed puis already_processed (transaction annulee)"
  [ "$(q "select has_function_privilege('public','public.stripe_event_claim(text,text,int)','EXECUTE') or has_function_privilege('public','public.crediter_credits_stripe(uuid,integer,text,text,text,text)','EXECUTE')")" = f ] || fail "EXECUTE ouvert a PUBLIC"
  [ "$(q "select bool_and(has_function_privilege('service_role',f,'EXECUTE')) from unnest(array['public.stripe_event_claim(text,text,int)','public.stripe_event_complete(text)','public.stripe_event_fail(text,text)','public.crediter_credits_stripe(uuid,integer,text,text,text,text)']::regprocedure[]) f")" = t ] || fail "service_role sans EXECUTE sur les 4 fonctions"
  ok "4 fonctions : PUBLIC refuse, service_role EXECUTE (compatibilite #474)"
  [ "$(q "select count(*) from pg_indexes where indexname='credit_transactions_stripe_reference_unique' and indexdef like '%WHERE%stripe:%'")" = 1 ] || fail "index credit_transactions_stripe_reference_unique"
  ok "index global credit_transactions_stripe_reference_unique present"
  local u; u="$(q "
select count(*) from (
  select 1 from pg_constraint c where c.conrelid='public.subscriptions'::regclass and c.contype in ('u','p')
     and c.conkey = array[(select attnum from pg_attribute where attrelid='public.subscriptions'::regclass and attname='stripe_subscription_id')]::int2[]
  union all
  select 1 from pg_index i where i.indrelid='public.subscriptions'::regclass and i.indisunique and i.indpred is null and i.indnkeyatts=1
     and i.indkey[0]=(select attnum from pg_attribute where attrelid='public.subscriptions'::regclass and attname='stripe_subscription_id')) t")"
  if [ "${u:-0}" -ge 1 ]; then ok "subscriptions.stripe_subscription_id : unicite non partielle presente (upsert onConflict OK)"
  else warn "subscriptions.stripe_subscription_id SANS unicite : NE PAS deployer le webhook #471 (42P10) — lot subscriptions a traiter"; fi
  verdict474 471; sante 471
}

# ═══ #472 — users contraintes (APRES deploiement du code) ════════════════════
m472(){
  echo; echo "── #472 users-contraintes ──"
  if [ "${STG_CODE_472_DEPLOYE:-}" != oui ]; then
    fail "#472 exige que le code consolide (src/lib/auth/config.ts de #472) soit DEPLOYE sur l'app staging avant. Relancer avec STG_CODE_472_DEPLOYE=oui une fois le redeploiement Coolify termine (commit actuel : ${SC:-inconnu})"
  fi
  ( umask 077; "${PS[@]}" -v ON_ERROR_STOP=0 -f - < "$W/migrations/472-users-contraintes.diagnostic.sql" > "$W/diagnostic-472.txt" 2>&1 || true )
  info "diagnostic complet (contient des e-mails, chmod 600) : $W/diagnostic-472.txt"
  local col d1 d2 d3=0 d4=0
  col="$(q "select count(*) from information_schema.columns where table_schema='public' and table_name='users' and column_name='stripe_customer_id'")"
  d1="$(q "select count(*) from (select 1 from public.users group by lower(btrim(email)) having count(*)>1) d")"
  d2="$(q "select count(*) from public.users where btrim(email)=''")"
  if [ "$col" = 1 ]; then
    d3="$(q "select count(*) from (select 1 from public.users where stripe_customer_id is not null group by stripe_customer_id having count(*)>1) d")"
    d4="$(q "select count(*) from public.users where stripe_customer_id is not null and btrim(stripe_customer_id)=''")"
  fi
  info "diagnostic : doublons e-mail=$d1, e-mails vides=$d2, doublons stripe_customer_id=$d3, stripe_customer_id vides=$d4 (colonne presente=$col)"
  [ "$d1$d2$d3$d4" = 0000 ] || fail "diagnostic #472 : lignes bloquantes (procedure manuelle en tete de la migration ; rien n'a ete modifie)"
  ok "diagnostic #472 : 0 ligne bloquante"
  runf "$W/migrations/472-users-contraintes.sql" || fail "migration #472"
  APPLIQUEES+=(472); ok "migration #472 appliquee"
  reload
  [ "$(q "select count(*) from pg_index i join pg_class c on c.oid=i.indexrelid where c.relname in ('users_email_lower_unique','users_stripe_customer_id_unique') and i.indisunique and i.indisvalid")" = 2 ] || fail "index users manquants ou invalides"
  [ "$(q "select count(*) from pg_constraint where conrelid='public.users'::regclass and conname='users_email_non_vide' and convalidated")" = 1 ] || fail "contrainte users_email_non_vide"
  ok "users : users_email_lower_unique, users_stripe_customer_id_unique (valides), users_email_non_vide"
  verdict474 472; sante 472
}

if [ "$PARTIE" = A ]; then m474; m470; m471; else
  [ "$(q "select count(*) from pg_roles where rolname='service_role'")" = 1 ] || fail "partie A non appliquee (service_role absent) : lancer d'abord la partie A"
  m472; fi

# ── Etat final : roles et exposition anonyme (bascule NON faite par ce script) ─
echo; echo "── Etat des roles et de l'acces anonyme ──"
info "roles : $(q "select string_agg(n||'='||coalesce((select case when rolsuper then 'SUPERUSER' else 'non-super' end||',login='||rolcanlogin||',bypassrls='||rolbypassrls from pg_roles where rolname=n),'ABSENT'), '  ' order by n) from unnest(array['authenticator','service_role','web_anon','$DU']) n")"
info "PostgREST staging : utilisateur de connexion=$DU, PGRST_DB_ANON_ROLE=$(envde "$PG" PGRST_DB_ANON_ROLE)"
AN="$(docker exec -e B="$SBU" "$APP" node -e '
  const b=process.env.B;
  const g=fetch(b+"/users?select=id&limit=0").then(r=>r.status).catch(()=>"000");
  // Sonde SANS effet : reference invalide => la fonction sort avant toute lecture/ecriture.
  const p=fetch(b+"/rpc/crediter_credits_stripe",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({p_user_id:"00000000-0000-0000-0000-000000000000",p_montant:1,p_type:"bonus",p_reference:"sonde-anonyme-invalide"})}).then(r=>r.status).catch(()=>"000");
  Promise.all([g,p]).then(([a,c])=>console.log(a+" "+c));' 2>/dev/null || echo "000 000")"
read -r AU AR <<<"$AN"
info "anonyme via $SBU (reseau staging) : GET /users -> $AU ; POST /rpc/crediter_credits_stripe -> $AR"
if [ "$AU" = 200 ] || [ "$AR" = 200 ]; then
  warn "acces ANONYME encore OUVERT (attendu tant que la bascule Coolify #474 n'est pas faite : PGRST_DB_ANON_ROLE=web_anon, PGRST_DB_URI=authenticator, nouvelle cle service_role)"
elif [ "$AU" = 401 ] || [ "$AU" = 403 ]; then ok "acces anonyme ferme ($AU/$AR)"
else warn "acces anonyme : codes inattendus ($AU/$AR), a regarder"; fi

trap - ERR
resume
if [ "$PARTIE" = A ]; then
  echo "SUITE : 1) deployer main consolide sur l'app staging (Coolify) ; 2) STG_CODE_472_DEPLOYE=oui bash $0 B ; 3) bascule Coolify #474 (runbook, etapes 4 a 7)."
fi
rollback_cmds
[ "$AVERT" = 0 ] && exit 0 || exit 2
