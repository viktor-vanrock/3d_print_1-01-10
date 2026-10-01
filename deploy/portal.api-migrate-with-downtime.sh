#!/usr/bin/env bash
# Incompatible API migration boundary: the old process must not serve while dbmate
# changes a contract it understands. This helper deliberately leaves API stopped if
# migration fails; starting either old or new code against an uncertain schema is unsafe.

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <portal.api|portal.api-dev> <environment-file>" >&2
  exit 64
fi

API_UNIT="$1"
API_ENV_FILE="$2"

case "$API_UNIT" in
  portal.api|portal.api-dev) ;;
  *)
    echo "unsupported API unit: $API_UNIT" >&2
    exit 64
    ;;
esac

if [ ! -r "$API_ENV_FILE" ]; then
  echo "API environment file is not readable: $API_ENV_FILE" >&2
  exit 66
fi

set -a
# shellcheck disable=SC1090
source "$API_ENV_FILE"
set +a

echo "portal API migration: stopping $API_UNIT before incompatible migrations"
sudo /usr/bin/systemctl stop "$API_UNIT"

if ! pnpm --filter @portal/api run db:migrate; then
  echo "portal API migration: migration failed; API remains stopped" >&2
  exit 1
fi

echo "portal API migration: starting $API_UNIT after successful migrations"
sudo /usr/bin/systemctl start "$API_UNIT"
