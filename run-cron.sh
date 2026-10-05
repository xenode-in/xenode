#!/bin/bash
# Trigger one Drive cron job against a local dev server: ./run-cron.sh <job>
# Jobs are the paths in vercel.json, e.g. ./run-cron.sh purge-bin

HOST="http://localhost:${PORT:-3000}"
SECRET="${CRON_SECRET:-$(grep '^CRON_SECRET=' .env.local 2>/dev/null | cut -d'=' -f2-)}"

if [ -z "$SECRET" ]; then
    echo "CRON_SECRET is not set. Add it to .env.local or export it."
    exit 1
fi

if [ -z "$1" ]; then
    echo "Usage: ./run-cron.sh <job>"
    jq -r '.crons[].path | sub("^/api/cron/"; "  ")' vercel.json
    exit 1
fi

curl --fail --silent --show-error "$HOST/api/cron/$1" \
    -H @<(printf 'Authorization: Bearer %s\n' "$SECRET") | jq .
