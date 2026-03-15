#!/bin/bash

# Simple helper script to trigger Xenode's cron jobs locally
# Usage: ./run-cron.sh <job>

PORT=3000
HOST="http://localhost:$PORT"

# The secret must match CRON_SECRET in your .env.local file
SECRET="development_secret_123"

if [ -z "$1" ]; then
    echo "Usage: ./run-cron.sh <job>"
    echo "Available jobs:"
    echo "  expire-plans      - Sweeps the database to downgrade expired plans and grant grace periods"
    echo "  charge-recurring  - Triggers PayU auto-renewals for active mandates"
    exit 1
fi

JOB=$1

echo "Triggering cron job: $JOB at $HOST/api/cron/$JOB"
echo "---"

if [ "$JOB" == "expire-plans" ]; then
    curl -s -X GET "$HOST/api/cron/expire-plans" \
         -H "Authorization: Bearer $SECRET" \
         | jq . || echo "Failed to reach server. Is Next.js running on port $PORT?"
elif [ "$JOB" == "charge-recurring" ]; then
    curl -s -X POST "$HOST/api/payment/payu/charge-recurring" \
         -H "Authorization: Bearer $SECRET" \
         | jq . || echo "Failed to reach server. Is Next.js running on port $PORT?"
else
    echo "Unknown job: $JOB"
    exit 1
fi

echo -e "\n---"
echo "Done!"