#!/bin/sh
# STUDIIO — INVENTAIRE avant nettoyage des anciennes vidéos. LECTURE SEULE.
# À lancer sur le serveur (Coolify > Servers > localhost > Terminal), en root.
# Ne modifie rien (ni MinIO, ni la base, ni les conteneurs) : seules écritures = fichiers texte du rapport
# dans /root/studiio-nettoyage/ sur l'hôte. SQL en transaction READ ONLY. Aucun secret affiché.
# Résultat : dossier /root/studiio-nettoyage/ (fichiers texte), résumé à l'écran.
set -eu

MINIO=studiio-minio
DB=qhhaglete0jnw1ixrjer3ho8          # conteneur studiio-db
OUT=/root/studiio-nettoyage
mkdir -p "$OUT"

for c in "$MINIO" "$DB"; do
  docker ps --format '{{.Names}}' | grep -qx "$c" || { echo "ARRET : conteneur $c introuvable ou arrêté."; exit 1; }
done
docker exec "$MINIO" sh -c 'command -v mc >/dev/null' || { echo "ARRET : mc absent du conteneur $MINIO."; exit 1; }

# mc dans le conteneur MinIO ; les identifiants restent dans le conteneur, jamais affichés.
# Connexion par variable d'environnement MC_HOST_loc : rien n'est écrit dans le conteneur (pas de `mc alias set`).
mcx() { docker exec "$MINIO" sh -c '[ -n "${MINIO_ROOT_USER:-}" ] && [ -n "${MINIO_ROOT_PASSWORD:-}" ] || { echo "ARRET : identifiants MinIO absents du conteneur." >&2; exit 3; }; MC_HOST_loc="http://${MINIO_ROOT_USER}:${MINIO_ROOT_PASSWORD}@127.0.0.1:9000" mc --quiet --config-dir /tmp/.mc-studiio-nettoyage "$@"' mc "$@"; }
sqlx() { docker exec -i "$DB" psql -U studiio -d studiio -X -q -A -t -F '|' -v ON_ERROR_STOP=1; }

echo "== 1. Anciens fichiers converted/<horodatage> (compartiment media, SANS compte)"
# Liste récursive SOUS le seul préfixe racine converted/ : clé|taille|date
mcx ls loc/media/ >/dev/null || { echo "ARRET : compartiment media illisible."; exit 1; }
mcx ls --recursive --json loc/media/converted/ > "$OUT/converted-brut.json" || true
sed -n 's/.*"lastModified":"\([^"]*\)".*"size":\([0-9]*\).*"key":"\([^"]*\)".*/\3|\2|\1/p' "$OUT/converted-brut.json" > "$OUT/converted-objets.txt"
N=$(wc -l < "$OUT/converted-objets.txt" | tr -d ' ')
T=$(awk -F'|' '{s+=$2} END {printf "%.1f Mo", s/1048576}' "$OUT/converted-objets.txt")
echo "   objets : $N   taille : $T   (liste : $OUT/converted-objets.txt)"

echo "== 2. Références en base à un ancien converted/ (aucune URL ni contenu affiché)"
sqlx > "$OUT/converted-references.txt" <<'SQL'
begin transaction read only;
-- type|id|statut|clé référencée
select 'post', sp.id, sp.status, m[1]
  from scheduled_posts sp,
       lateral regexp_matches(to_jsonb(sp)::text,
         '/storage/v1/object/(?:public|sign|authenticated|private)/media/converted/([^/?#"\\]+)', 'gi') m
union
select 'video', v.id, v.status, m[1]
  from videos v,
       lateral regexp_matches(to_jsonb(v)::text,
         '/storage/v1/object/(?:public|sign|authenticated|private)/media/converted/([^/?#"\\]+)', 'gi') m;
rollback;
SQL
awk -F'|' '{print $1" "$3}' "$OUT/converted-references.txt" | sort | uniq -c | sed 's/^/   /'
echo "   (détail : $OUT/converted-references.txt)"

echo "== 3. Hôte des références (une copie sur l'ancien Supabase Cloud échappe à MinIO)"
sqlx <<'SQL' | sed 's/^/   /'
begin transaction read only;
select coalesce(substring(t from 'https?://([^/]+)/storage/v1/object/[a-z]+/media/converted/'), 'relatif') as hote, count(*)
  from (select to_jsonb(sp)::text t from scheduled_posts sp union all select to_jsonb(v)::text from videos v) x
 where t ~* '/storage/v1/object/(public|sign|authenticated|private)/media/converted/'
 group by 1 order by 2 desc;
rollback;
SQL

echo "== 4. Vue d'ensemble du stockage (pour repérer d'éventuels comptes de TEST — rien n'est supprimé ici)"
for b in media audio; do
  echo "   -- compartiment $b : taille par dossier racine"
  mcx du --depth 2 "loc/$b" 2>/dev/null | sed 's/^/   /' | tee "$OUT/du-$b.txt" | head -40
done
sqlx > "$OUT/comptes.txt" <<'SQL'
begin transaction read only;
select id, email, created_at::date,
       (select count(*) from scheduled_posts p where p.user_id = u.id) as posts,
       (select count(*) from videos v where v.user_id = u.id) as videos
  from users u order by created_at;
rollback;
SQL
echo "   comptes (id|email|création|posts|vidéos) : $OUT/comptes.txt  ($(wc -l < "$OUT/comptes.txt" | tr -d ' ') comptes)"

echo "== FIN — rien n'a été modifié. Collez-moi les sections 1 à 4 (pas les fichiers entiers)."
