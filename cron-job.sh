#!/bin/sh
# One scheduled call. The bearer header comes from a root-only file, so the
# secret is never in the crontab or the process list.
exec curl --fail --silent --show-error --retry 3 --max-time 600 \
  -H @/run/xenode-cron/auth-header "$1" >> /proc/1/fd/1 2>> /proc/1/fd/2
