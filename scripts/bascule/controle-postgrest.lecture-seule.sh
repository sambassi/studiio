#!/usr/bin/env bash
# CONTROLE DE BASCULE POSTGREST — LECTURE SEULE.
# Usage : ETAPE=<avant|anon_ferme|cle_service|authenticator>
#         bash controle-postgrest.lecture-seule.sh
# Aucune ecriture, aucune donnee lue (limit=0),
# aucun secret affiche. Verdict final :
#   VERDICT=CONTINUER  ou  VERDICT=ROLLBACK (motifs)
set -uo pipefail
ETAPE=${ETAPE:-}
case "$ETAPE" in
  avant) ANON=200; ROLE=studiio ;;
  anon_ferme) ANON=401; ROLE=studiio ;;
  cle_service|authenticator) ANON=401; ROLE=service_role ;;
  *) echo "ETAPE inconnue"; exit 2 ;;
esac
EMPREINTE_V3=42b0cfe09ca64a2b
DB=$(docker ps --filter name=qhhaglete0jnw1ixrjer3ho8 \
  --format '{{.Names}}' | head -1)
APP=$(docker ps --filter name=l142u3oa8w38xz1zcu6t5lnl \
  --format '{{.Names}}' | head -1)
[ -n "$DB" ] && [ -n "$APP" ] || {
  echo "VERDICT=ROLLBACK conteneurs introuvables"; exit 1; }
MOTIFS=""
ko() { MOTIFS="$MOTIFS $1"; echo "KO $1"; }
# 1. Depuis l'application, par SON chemin (proxy /rest/v1)
R=$(docker exec -e ANON="$ANON" "$APP" node -e '
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
  "subscriptions","media","user_settings",
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
' 2>&1)
printf '%s\n' "$R"
RC=$(printf '%s\n' "$R" | sed -n 's/^ROLE_CLE //p')
[ "$RC" = "$ROLE" ] || ko "role_cle=$RC(attendu_$ROLE)"
A=$(printf '%s\n' "$R" | sed -n 's/^ANONYME //p')
[ "$A" = "$ANON" ] || ko "anonyme=$A(attendu_$ANON)"
printf '%s\n' "$R" | grep -q '^ERREUR' && ko "erreur_reseau"
while read -r _ t c; do
  case "$c" in
    200) ;;
    404) echo "ATTENTION table absente : $t" ;;
    *) ko "table_${t}=$c" ;;
  esac
done < <(printf '%s\n' "$R" | grep '^TABLE ')
# 2. EXECUTE des RPC serveur pour le role de la cle
sql() {
  docker exec -i "$DB" psql -U studiio -d studiio \
    -At -v ON_ERROR_STOP=1 "$@"
}
F=$(sql -v r="$RC" <<'SQL'
select p.proname
from pg_proc p join pg_namespace n
  on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('debiter_credits',
   'debiter_credits_operation','confirmer_rendu',
   'confirmer_rendu_sans_debit','clore_rendu',
   'lut_assets_ajouter','crediter_credits_stripe',
   'stripe_event_claim','stripe_event_complete',
   'stripe_event_fail')
  and exists (select 1 from pg_roles
              where rolname = :'r')
  and not has_function_privilege(:'r', p.oid,
                                 'execute');
SQL
)
[ -z "$F" ] || ko "rpc_sans_execute:$(echo $F | tr ' ' ,)"
# 3. Avatar v3 intact (empreinte, jamais l'identifiant)
V=$(sql <<'SQL'
select a.version || ' ' || a.status || ' '
  || coalesce(a.provider_avatar_id, '')
from user_avatars a join users u on u.id = a.user_id
where u.email = 'contact.artboost@gmail.com'
  and a.deleted_at is null
order by a.created_at limit 1;
SQL
)
VV=${V%% *}; RESTE=${V#* }; VS=${RESTE%% *}
VP=${RESTE#* }
EMP=$(printf '%s' "$VP" | sha256sum | cut -c1-16)
echo "AVATAR_V3 version=$VV statut=$VS empreinte=$EMP"
[ "$VV" = 3 ] && [ "$VS" = completed ] \
  && [ "$EMP" = "$EMPREINTE_V3" ] || ko "avatar_v3"
# Verdict
if [ -z "$MOTIFS" ]; then echo "VERDICT=CONTINUER"
else echo "VERDICT=ROLLBACK$MOTIFS"; exit 1; fi
