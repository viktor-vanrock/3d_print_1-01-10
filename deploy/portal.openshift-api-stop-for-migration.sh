#!/usr/bin/env bash
# Operator precondition for a Helm release containing an incompatible API migration.
# It never runs helm itself: after this guard succeeds, the normal manual deploy job
# may execute the pre-upgrade migration hook while no old API pod is serving.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <d-rndml-aiportal|p-rndml-aiportal>" >&2
  exit 64
fi

API_NAMESPACE="$1"
case "$API_NAMESPACE" in
  d-rndml-aiportal|p-rndml-aiportal) ;;
  *)
    echo "unsupported API namespace: $API_NAMESPACE" >&2
    exit 64
    ;;
esac

oc whoami >/dev/null
oc scale deployment/api --replicas=0 -n "$API_NAMESPACE"

for attempt in $(seq 1 60); do
  ready="$(oc get deployment/api -n "$API_NAMESPACE" -o jsonpath='{.status.readyReplicas}')"
  if [ -z "$ready" ] || [ "$ready" = "0" ]; then
    echo "OpenShift API is stopped in $API_NAMESPACE; incompatible Helm migration may proceed"
    exit 0
  fi
  sleep 1
done

echo "API still has ready replicas in $API_NAMESPACE; Helm migration is blocked" >&2
exit 1
