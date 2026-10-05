#!/bin/sh
# Xenode scheduler. The schedule contract is each product's vercel.json, baked
# in at /etc/xenode/<product>.json; every job calls that product's origin. The
# secret never enters the crontab, a command line or the logs.
set -eu

: "${DRIVE_URL:?DRIVE_URL is required (for example, http://drive:3000)}"
: "${PHOTOS_URL:?PHOTOS_URL is required (for example, http://photos:3000)}"
: "${CRON_SECRET:?CRON_SECRET is required}"

umask 077
mkdir -p /run/xenode-cron
printf 'Authorization: Bearer %s\n' "$CRON_SECRET" > /run/xenode-cron/auth-header
unset CRON_SECRET

: > /etc/crontabs/root
for product in drive photos; do
  if [ "$product" = drive ]; then base="${DRIVE_URL%/}"; else base="${PHOTOS_URL%/}"; fi
  jq -r --arg base "$base" \
    '.crons[] | "\(.schedule) /usr/local/bin/xenode-cron-job \($base)\(.path)"' \
    "/etc/xenode/$product.json" >> /etc/crontabs/root
done

echo "Xenode scheduler (UTC):"
sed 's#/usr/local/bin/xenode-cron-job ##' /etc/crontabs/root
exec crond -f -l 6
