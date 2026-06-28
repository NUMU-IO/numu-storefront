#!/usr/bin/env bash
# =============================================================================
# deploy-storefront-ec2.sh — deploy the V3 storefront on the dedicated prod EC2
# =============================================================================
# Runs ON the EC2 box. PULLS the prebuilt image from GHCR (built in CI), then
# recreates the storefront + nginx and health-gates the storefront. The box
# never builds, so it can't OOM on `next build`.
#
# Pre-reqs on the box (one-time):
#   - docker logged in to ghcr.io  (the CD does this with the run's token; for a
#     manual run: echo $GHCR_PAT | docker login ghcr.io -u <user> --password-stdin)
#   - deploy/.env.prod present (chmod 600) — server-side runtime env
#
# Usage:
#   NUMU_STOREFRONT_IMAGE=ghcr.io/numu-io/numu-storefront:prod \
#     ./scripts/deploy-storefront-ec2.sh
# =============================================================================

set -euo pipefail

: "${NUMU_STOREFRONT_IMAGE:?NUMU_STOREFRONT_IMAGE must be set (e.g. ghcr.io/numu-io/numu-storefront:prod)}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

COMPOSE_FILE="deploy/docker-compose.storefront.ec2.yml"
ENV_FILE="deploy/.env.prod"
STOREFRONT="numu-storefront-prod"

HEALTH_TIMEOUT_SEC=150
HEALTH_POLL_INTERVAL=3

log()  { printf '==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die()  { printf 'FATAL: %s\n' "$*" >&2; exit 1; }

compose() { docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"; }

[[ -f "${COMPOSE_FILE}" ]] || die "compose file not found: ${COMPOSE_FILE}"
[[ -f "${ENV_FILE}" ]]     || die "env file not found: ${ENV_FILE} (cp deploy/.env.prod.example and fill it)"

wait_until_healthy() {
    local container="$1"
    local deadline=$(( SECONDS + HEALTH_TIMEOUT_SEC ))
    log "Waiting for ${container} to become healthy (timeout ${HEALTH_TIMEOUT_SEC}s)..."
    while (( SECONDS < deadline )); do
        local status
        status="$(docker inspect --format='{{.State.Health.Status}}' "${container}" 2>/dev/null || echo missing)"
        case "${status}" in
            healthy)   log "${container} is healthy"; return 0 ;;
            unhealthy) warn "${container} is UNHEALTHY"; docker logs --tail 60 "${container}" >&2 || true; return 1 ;;
        esac
        sleep "${HEALTH_POLL_INTERVAL}"
    done
    warn "${container} did not become healthy in ${HEALTH_TIMEOUT_SEC}s (last: ${status:-unknown})"
    docker logs --tail 60 "${container}" >&2 || true
    return 1
}

export NUMU_STOREFRONT_IMAGE
log "Image=${NUMU_STOREFRONT_IMAGE}"

log "Pulling storefront image..."
docker pull "${NUMU_STOREFRONT_IMAGE}"

# Clear any stale/orphaned named container so --force-recreate can't collide.
log "Clearing stale ${STOREFRONT} container(s)..."
docker ps -aq --filter "name=${STOREFRONT}" | xargs -r docker rm -f >/dev/null 2>&1 || true

log "Recreating storefront + nginx..."
compose up -d --force-recreate

if ! wait_until_healthy "${STOREFRONT}"; then
    die "deploy failed — ${STOREFRONT} unhealthy (see logs above)."
fi

log "Pruning dangling images..."
docker image prune -f >/dev/null || true

log "Deploy complete. Smoke-test with a real store subdomain:"
log "  curl -s -H 'Host: <store>.numueg.app' http://127.0.0.1/__numu-runtime/manifest.json | head -c 80"
