cat > /tmp/valide-e1.sh <<'SCRIPT'
#!/usr/bin/env bash
# VALIDATION ETAPE 1 #533 — LECTURE SEULE.
# Toute erreur (psql, reseau, fichier) = NON_VALIDE.
set -uo pipefail
EMP_V3=42b0cfe09ca64a2b
KO=""
ko() { KO="$KO $1"; echo "KO $1"; }
DB=$(docker ps --filter name=qhhaglete0jnw1ixrjer3ho8 \
  --format '{{.Names}}' | head -1)
APP=$(docker ps --filter name=l142u3oa8w38xz1zcu6t5lnl \
  --format '{{.Names}}' | head -1)
PG=$(docker ps --format '{{.Names}} {{.Image}}' \
  | awk '$1 ~ /studiio-postgrest/ && $2 ~ /postgrest/' \
  | awk '{print $1}' | head -1)
[ -n "$DB" ] && [ -n "$APP" ] && [ -n "$PG" ] || {
  echo "VERDICT_FINAL=NON_VALIDE conteneurs"; exit 1; }
sqlw() {
  docker exec -i "$DB" psql -U studiio -d studiio \
    -At -F ' ' -v ON_ERROR_STOP=1 "$@"
}
W=$(ls -d /root/backups/prod-533-etape1-* 2>/dev/null \
  | sort | tail -1)
echo "DOSSIER_ETAPE1=$W"
echo "=== 1. FICHIERS DE L'ETAPE 1 (integrite) ==="
while read -r f h; do
  a=$(sha256sum "$W/$f" 2>/dev/null | cut -c1-16)
  if [ "$a" = "$h" ]; then echo "FICHIER $f intact"
  else ko "fichier_${f}_altere"; fi
done <<'H'
mig.sql e1fa9ccef20d2aef
rb.sql a4939c4f638260ee
snap.sql c7bf70fb6be5077c
verdict.sql 1ae47a98f20e10eb
H
if [ -s "$W/restaurer-droits.sql" ]; then
  echo "RESTAURATION_LIGNES=$(wc -l \
    < "$W/restaurer-droits.sql")"
else ko "restauration_absente"; fi
echo "=== 2. CONTROLES Z (les 13) ==="
cat > /tmp/valide-z.sql <<'SQL'
select 'Z roles_presents', (select count(*) from pg_roles
  where rolname in ('authenticator','web_anon',
  'service_role')) = 3;
select 'Z aucun_superuser', not exists (select 1
  from pg_roles where rolsuper and rolname in
  ('authenticator','web_anon','service_role'));
select 'Z authenticator_noinherit', coalesce((select
  not rolinherit from pg_roles
  where rolname = 'authenticator'), false);
select 'Z authenticator_deux_roles', not exists (
  select 1 from pg_auth_members m
  join pg_roles g on g.oid = m.roleid
  join pg_roles u on u.oid = m.member
  where u.rolname = 'authenticator'
    and g.rolname not in ('web_anon','service_role'));
select 'Z web_anon_sans_usage', not has_schema_privilege(
  'web_anon', 'public', 'USAGE');
select 'Z aucun_grant_public_tables', not exists (
  select 1 from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  where n.nspname = 'public' and a.grantee = 0);
select 'Z service_role_dml', not exists (
  select 1 from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r','p')
  and not (has_table_privilege('service_role', c.oid,
    'SELECT') and has_table_privilege('service_role',
    c.oid, 'INSERT') and has_table_privilege(
    'service_role', c.oid, 'UPDATE')
    and has_table_privilege('service_role', c.oid,
    'DELETE')));
select 'Z service_role_execute', not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and not
  has_function_privilege('service_role', p.oid,
  'EXECUTE'));
select 'Z service_role_bypassrls', (select rolbypassrls
  from pg_roles where rolname = 'service_role');
select 'Z service_role_membre_de_rien', not exists (
  select 1 from pg_auth_members m
  join pg_roles u on u.oid = m.member
  where u.rolname = 'service_role');
select 'Z herites_neutralises', not exists (
  select 1 from pg_roles
  where rolname in ('anon','authenticated')
  and (rolcanlogin or rolsuper or rolbypassrls))
  and not exists (select 1 from pg_auth_members m
  join pg_roles u on u.oid = m.member
  where u.rolname in ('anon','authenticated'));
select 'Z secdef_search_path', not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
  and not exists (select 1 from unnest(coalesce(
  p.proconfig, '{}')) c where c like 'search_path=%'));
select 'Z secdef_ferme_a_public', not exists (
  select 1 from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl,
  acldefault('f', p.proowner))) a
  where n.nspname = 'public' and p.prosecdef
  and a.grantee = 0);
SQL
if ! Z=$(sqlw < /tmp/valide-z.sql 2>&1); then
  ko "z_erreur_sql"
fi
printf '%s\n' "$Z"
NZ=$(printf '%s\n' "$Z" | grep -c '^Z .* t$')
echo "Z_EXECUTES_ET_OK=$NZ/13"
[ "$NZ" = 13 ] || ko "z_${NZ}_sur_13"
echo "=== 3. POSTGREST (doit rester studiio) ==="
E=$(docker inspect "$PG" \
  --format '{{range .Config.Env}}{{println .}}{{end}}')
L=$(printf '%s\n' "$E" \
  | sed -nE 's#^PGRST_DB_URI=[a-z]+://([^:@/]+).*#\1#p')
AR=$(printf '%s\n' "$E" \
  | sed -n 's/^PGRST_DB_ANON_ROLE=//p')
echo "PGRST_LOGIN=$L"
echo "PGRST_ANON_ROLE=$AR"
[ "$L" = studiio ] || ko "login_$L"
[ "$AR" = studiio ] || ko "anon_$AR"
echo "=== 4. BACKEND PAR LE CHEMIN DE L'APP ==="
R=$(docker exec "$APP" node -e '
const k = process.env.SUPABASE_SERVICE_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const u = (process.env.SUPABASE_URL || "")
  .replace(/\/$/, "") + "/rest/v1";
let role = "illisible";
try {
  role = JSON.parse(Buffer.from(k.split(".")[1],
    "base64url")).role;
} catch {}
const T = ["users","scheduled_posts","videos",
  "user_avatars","avatar_generations",
  "social_accounts","app_settings",
  "credit_transactions","autopilot_config",
  "autopilot_jumeau_attente","plans","credit_packs",
  "subscriptions","user_settings",
  "user_voices","rendus","render_jobs",
  "publishing_history","zernio_accounts"];
const H = { apikey: k, Authorization: "Bearer " + k };
(async () => {
  console.log("ROLE_CLE " + role);
  const a = await fetch(u + "/users?select=id&limit=0");
  console.log("ANONYME " + a.status);
  for (const t of T) {
    const r = await fetch(u + "/" + t
      + "?select=*&limit=0", { headers: H });
    console.log("TABLE " + t + " " + r.status);
  }
})().catch((e) => console.log("ERREUR " + e.message));
' 2>&1) || ko "sonde_node"
RC=$(printf '%s\n' "$R" | sed -n 's/^ROLE_CLE //p')
AN=$(printf '%s\n' "$R" | sed -n 's/^ANONYME //p')
echo "SERVICE_KEY_ROLE=$RC"
echo "ANONYME=$AN (200 attendu a cette etape)"
[ "$RC" = studiio ] || ko "cle_$RC"
[ "$AN" = 200 ] || ko "anonyme_$AN"
printf '%s\n' "$R" | grep -q '^ERREUR' \
  && ko "erreur_reseau"
NT=$(printf '%s\n' "$R" | grep -c '^TABLE .* 200$')
echo "TABLES_200=$NT/19"
[ "$NT" = 19 ] || { ko "tables_${NT}_sur_19"
  printf '%s\n' "$R" | grep '^TABLE' | grep -v ' 200$'; }
echo "=== 5. RPC SERVEUR (10) ==="
if ! RP=$(sqlw <<'SQL' 2>&1
select r, count(*) filter (where
  has_function_privilege(r, p.oid, 'execute')),
  count(*)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace,
unnest(array['studiio','service_role']) r
where n.nspname = 'public'
  and p.proname in ('debiter_credits',
   'debiter_credits_operation','confirmer_rendu',
   'confirmer_rendu_sans_debit','clore_rendu',
   'lut_assets_ajouter','crediter_credits_stripe',
   'stripe_event_claim','stripe_event_complete',
   'stripe_event_fail')
group by r order by r;
SQL
); then ko "rpc_erreur_sql"; fi
printf '%s\n' "$RP" | sed 's/^/RPC /'
printf '%s\n' "$RP" | while read -r r x t; do
  [ "$x" = "$t" ] && [ "${t:-0}" -ge 10 ] || echo NOK
done | grep -q NOK && ko "rpc_incomplet"
[ "$(printf '%s\n' "$RP" | grep -c .)" = 2 ] \
  || ko "rpc_illisible"
echo "=== 6. JUMEAU V3 ==="
if ! V=$(sqlw <<'SQL' 2>&1
select a.version || ' ' || a.status || ' '
  || coalesce(a.provider_avatar_id, '')
from user_avatars a join users u on u.id = a.user_id
where u.email = 'contact.artboost@gmail.com'
  and a.deleted_at is null
order by a.created_at limit 1;
SQL
); then ko "v3_erreur_sql"; V=""; fi
VV=${V%% *}; RE=${V#* }; VS=${RE%% *}; VP=${RE#* }
EMP=$(printf '%s' "$VP" | sha256sum | cut -c1-16)
echo "V3 version=$VV statut=$VS empreinte=$EMP"
[ "$VV" = 3 ] && [ "$VS" = completed ] \
  && [ "$EMP" = "$EMP_V3" ] || ko "v3_change"
echo "=== 7. COMPTES (vs fin de l'etape 1) ==="
if ! C=$(sqlw <<'SQL' 2>&1
select 'users', count(*) from users;
select 'credits', coalesce(sum(credits),0) from users;
select 'credit_transactions', count(*)
 from credit_transactions;
select 'scheduled_posts', count(*) from scheduled_posts;
select 'videos', count(*) from videos;
select 'user_avatars', count(*) from user_avatars;
select 'avatar_generations', count(*)
 from avatar_generations;
select 'social_accounts', count(*) from social_accounts;
select 'autopilot_config', count(*) from autopilot_config;
SQL
); then ko "comptes_erreur_sql"; fi
if [ "$C" = "$(cat "$W/comptes-apres.txt" 2>/dev/null)" ]
then echo "BASELINE_UNCHANGED=oui"
else
  echo "BASELINE_UNCHANGED=non (activite du site ?)"
  diff <(printf '%s\n' "$C") "$W/comptes-apres.txt"
fi
echo "SCRIPT_SHA=$(sha256sum "$0" | cut -c1-16)"
if [ -z "$KO" ]; then echo "VERDICT_FINAL=VALIDE"
else echo "VERDICT_FINAL=NON_VALIDE$KO"; exit 1; fi
SCRIPT
bash -n /tmp/valide-e1.sh && echo SYNTAXE_OK
bash /tmp/valide-e1.sh
