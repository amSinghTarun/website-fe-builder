#!/usr/bin/env bash
set -euo pipefail

jwt_secret="${JWT_SECRET_FROM_GITHUB:-}"
if [ -z "$jwt_secret" ]; then
  jwt_secret="$(kubectl get secret sky-secrets --namespace=default \
    -o jsonpath='{.data.JWT_SECRET}' 2>/dev/null | base64 --decode || true)"
fi
if [ -z "$jwt_secret" ]; then
  jwt_secret="$(openssl rand -hex 32)"
fi

kubectl create secret generic sky-secrets --namespace=default \
  --from-literal=DATABASE_URL="${DATABASE_URL_FROM_GITHUB}" \
  --from-literal=JWT_SECRET="$jwt_secret" \
  --from-literal=GCP_PROJECT_ID="${GCP_PROJECT_ID_FROM_GITHUB}" \
  --from-literal=POSTGRES_USER="${POSTGRES_USER_FROM_GITHUB}" \
  --from-literal=POSTGRES_PASSWORD="${POSTGRES_PASSWORD_FROM_GITHUB}" \
  --from-literal=POSTGRES_DB="${POSTGRES_DB_FROM_GITHUB}" \
  --dry-run=client -o yaml | kubectl apply -f -
