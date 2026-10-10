#!/usr/bin/env bash
# Applique les migrations de supabase/migrations/ qui ne l'ont pas encore été, dans l'ordre,
# chacune dans sa propre transaction. Le suivi est gardé dans duckdle_meta.migrations,
# un schéma que l'API du site n'expose pas.
#
# Usage : DATABASE_URL=postgresql://… scripts/migrate.sh
set -euo pipefail

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL manquant : rien n'est appliqué." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "
  set client_min_messages = warning;
  create schema if not exists duckdle_meta;
  revoke all on schema duckdle_meta from public;
  create table if not exists duckdle_meta.migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  );"

applied=0
for file in supabase/migrations/*.sql; do
  name=$(basename "$file")
  done_already=$(echo "select 1 from duckdle_meta.migrations where name = :'name'" | psql "$DATABASE_URL" -tA -v name="$name")
  if [ "$done_already" = "1" ]; then
    echo "Déjà appliquée : $name"
    continue
  fi
  echo "Application de $name"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q --single-transaction \
    -f "$file" \
    -c "insert into duckdle_meta.migrations (name) values ('${name//\'/}')"
  applied=$((applied + 1))
done
echo "Migrations appliquées : $applied"
