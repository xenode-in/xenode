#!/bin/sh
set -eu

: "${APP_URL:?APP_URL is required (for example, https://admin.xenode.in)}"
: "${CRON_SECRET:?CRON_SECRET is required}"

APP_URL="${APP_URL%/}"

cat > /etc/crontabs/root <<EOF
0  0  * * *  curl --fail --silent --show-error --retry 3 -X GET  "$APP_URL/api/cron/expire-plans"             -H "Authorization: Bearer $CRON_SECRET" >> /proc/1/fd/1 2>> /proc/1/fd/2
0  3  * * *  curl --fail --silent --show-error --retry 3 -X GET  "$APP_URL/api/cron/purge-bin"                -H "Authorization: Bearer $CRON_SECRET" >> /proc/1/fd/1 2>> /proc/1/fd/2
0  */6 * * * curl --fail --silent --show-error --retry 3 -X GET  "$APP_URL/api/cron/cleanup-orphans"          -H "Authorization: Bearer $CRON_SECRET" >> /proc/1/fd/1 2>> /proc/1/fd/2
30 9  * * *  curl --fail --silent --show-error --retry 3 -X POST "$APP_URL/api/payment/payu/charge-recurring" -H "Authorization: Bearer $CRON_SECRET" >> /proc/1/fd/1 2>> /proc/1/fd/2
EOF

echo "Xenode cron scheduler started for $APP_URL (UTC schedules)"
exec crond -f -l 6
