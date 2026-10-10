#!/usr/bin/env bash
# Regroupe @supabase/supabase-js en un seul module ES pour le site (site/js/vendor/supabase.js).
# La version est figée : pour la changer, modifier VERSION et relancer ce script.
set -euo pipefail
VERSION=2.117.2
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
npm init -y >/dev/null
npm install --silent "@supabase/supabase-js@$VERSION" esbuild@0.24.2
echo 'export { createClient } from "@supabase/supabase-js";' > entry.js
npx esbuild entry.js --bundle --format=esm --minify --target=es2020 --platform=browser --legal-comments=none --outfile=bundle.js
{
  echo "/*! @supabase/supabase-js $VERSION, regroupé avec esbuild (scripts/build-supabase.sh)."
  echo " * Licence MIT. Copyright (c) 2020 Supabase ; phoenix : Copyright (c) 2014 Chris McCord."
  echo " * iceberg-js, tslib : voir leurs licences (MIT, 0BSD). */"
  cat bundle.js
} > "$root/site/js/vendor/supabase.js"
echo "site/js/vendor/supabase.js : $(wc -c < "$root/site/js/vendor/supabase.js") octets"
