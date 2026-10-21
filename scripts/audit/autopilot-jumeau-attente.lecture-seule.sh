#!/usr/bin/env bash
# VÉRIFICATION LECTURE SEULE — table public.autopilot_jumeau_attente (PR #613).
#
# Avant de déployer #613 : les productions Autopilote SANS avatar posent un
# verrou persistant dans cette table (slot_key 'manuel-direct', statuts
# direct_en_cours / direct_rendu / direct_echec, generation_id = UUID nul).
# Ce script vérifie, sans RIEN écrire, que la base Studiio le permet.
#
# Usage, sur le serveur Studiio (Hetzner, via le terminal Coolify ou SSH) :
#   bash autopilot-jumeau-attente.lecture-seule.sh
# Toute la session est en lecture seule (default_transaction_read_only=on).
# Aucun secret ni aucune donnée personnelle n'est affiché (comptes agrégés).
# Ne concerne QUE la base Studiio : aucune autre base, aucun service partagé.
set -uo pipefail
DB=$(docker ps --filter name=qhhaglete0jnw1ixrjer3ho8 --format '{{.Names}}' | head -1)
if [ -z "$DB" ]; then echo "ECHEC conteneur base Studiio introuvable"; exit 2; fi
q() {
  docker exec -e PGOPTIONS='-c default_transaction_read_only=on' "$DB" \
    psql -U studiio -d studiio -At -v ON_ERROR_STOP=1 -c "$1"
}
T="'public.autopilot_jumeau_attente'"

echo "--- 1. Table présente"
EXISTE=$(q "select to_regclass($T) is not null")
[ "$EXISTE" = "t" ] && echo "OK table présente" || { echo "ECHEC table absente"; exit 1; }

echo "--- 2. Colonnes attendues (nom:type:nullable)"
q "select column_name||':'||data_type||':'||is_nullable from information_schema.columns
   where table_schema='public' and table_name='autopilot_jumeau_attente' order by ordinal_position"
for c in user_id slot_key job_id statut snapshot post_id motif generation_id updated_at created_at; do
  N=$(q "select count(*) from information_schema.columns where table_schema='public'
         and table_name='autopilot_jumeau_attente' and column_name='$c'")
  [ "$N" = "1" ] && echo "OK colonne $c" || echo "ECHEC colonne $c absente"
done

echo "--- 3. Contraintes"
q "select contype||' '||pg_get_constraintdef(oid) from pg_constraint where conrelid=$T::regclass order by contype"
UNIQ=$(q "select count(*) from pg_constraint where conrelid=$T::regclass and contype='u'
          and pg_get_constraintdef(oid) ilike 'UNIQUE (user_id, slot_key)%'")
[ "$UNIQ" -ge 1 ] && echo "OK unique (user_id, slot_key)" || echo "ECHEC unique (user_id, slot_key) absente : le verrou ne serait pas garanti"
CHK=$(q "select count(*) from pg_constraint where conrelid=$T::regclass and contype='c'
         and pg_get_constraintdef(oid) ilike '%statut%'")
[ "$CHK" = "0" ] && echo "OK aucune contrainte CHECK sur statut" || echo "ECHEC contrainte CHECK sur statut : les statuts direct_* seraient refusés"
FK=$(q "select count(*) from pg_constraint where conrelid=$T::regclass and contype='f'
        and pg_get_constraintdef(oid) ilike '%generation_id%'")
[ "$FK" = "0" ] && echo "OK aucune clé étrangère sur generation_id (UUID nul accepté)" || echo "ECHEC clé étrangère sur generation_id : l'UUID nul serait refusé"

echo "--- 4. Droits des rôles PostgREST"
for r in authenticator web_anon service_role; do
  EX=$(q "select count(*) from pg_roles where rolname='$r'")
  if [ "$EX" = "1" ]; then
    echo "role $r : $(q "select has_table_privilege('$r',$T,'SELECT')::text||' select / '||has_table_privilege('$r',$T,'INSERT')::text||' insert / '||has_table_privilege('$r',$T,'UPDATE')::text||' update'")"
  fi
done

echo "--- 5. Lignes par statut (comptes uniquement)"
q "select statut||' '||count(*) from public.autopilot_jumeau_attente group by statut order by statut"
echo "--- fin (aucune écriture effectuée)"
