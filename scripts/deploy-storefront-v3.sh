#!/usr/bin/env bash
# =============================================================================
# deploy-storefront-v3.sh — deploy the V3 BYOT storefront to the test/dev env
# =============================================================================
# Runs on the DigitalOcean droplet (directly or via SSH from CD).
#
# Usage:
#   NUMU_STOREFRONT_V3_IMAGE=ghcr.io/numu-io/numu-storefront:dev \
#     /opt/numu/deploy-storefront-v3.sh
#
# Single-container deploy (dev convention — bazaar's test storefront is also
# single-container). nginx already proxy_passes to the stable container name
# `numu-storefront-v3-test` via Docker DNS, so there's no upstream to flip:
#   1. Pull the new image.
#   2. Recreate the container with it.
#   3. Poll docker health until `healthy` (or fail loudly, leaving logs).
#   4. Prune dangling images.
#
# A brief blip during recreate is acceptable on dev. For staging/prod, adopt
# the blue/green flip from numu-egyptian-bazaar/scripts/deploy-storefront.sh.
# =============================================================================

set -euo pipefail

: "${NUMU_STOREFRONT_V3_IMAGE:?NUMU_STOREFRONT_V3_IMAGE must be set (e.g. ghcr.io/numu-io/numu-storefront:dev)}"

DOCKER_DIR="/opt/numu/docker"
COMPOSE_FILE="${COMPOSE_FILE:-${DOCKER_DIR}/docker-compose.storefront.v3.test.yml}"
SERVICE="storefront_v3"
CONTAINER="numu-storefront-v3-test"

HEALTH_TIMEOUT_SEC=120
HEALTH_POLL_INTERVAL=3

log()  { printf '==> %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die()  { printf 'FATAL: %s\n' "$*" >&2; exit 1; }

compose() { docker compose -f "${COMPOSE_FILE}" "$@"; }

wait_until_healthy() {
    local container="$1"
    local deadline=$(( SECONDS + HEALTH_TIMEOUT_SEC ))
    log "Waiting for ${container} to become healthy (timeout ${HEALTH_TIMEOUT_SEC}s)..."
    while (( SECONDS < deadline )); do
        local status
        status="$(docker inspect --format='{{.State.Health.Status}}' "${container}" 2>/dev/null || echo missing)"
        case "${status}" in
            healthy)   log "${container} is healthy"; return 0 ;;
            unhealthy) warn "${container} is UNHEALTHY"; docker logs --tail 50 "${container}" >&2 || true; return 1 ;;
        esac
        sleep "${HEALTH_POLL_INTERVAL}"
    done
    warn "${container} did not become healthy within ${HEALTH_TIMEOUT_SEC}s (last: ${status:-unknown})"
    docker logs --tail 50 "${container}" >&2 || true
    return 1
}

[[ -f "${COMPOSE_FILE}" ]] || die "compose file not found: ${COMPOSE_FILE}"
docker network inspect numu-test >/dev/null 2>&1 \
    || die "docker network 'numu-test' missing — bring up the API test stack first"

export NUMU_STOREFRONT_V3_IMAGE
log "Image=${NUMU_STOREFRONT_V3_IMAGE}"

log "Pulling image..."
docker pull "${NUMU_STOREFRONT_V3_IMAGE}"

log "Recreating ${SERVICE}..."
compose up -d --force-recreate "${SERVICE}"

if ! wait_until_healthy "${CONTAINER}"; then
    die "deploy failed — ${CONTAINER} unhealthy (see logs above)"
fi

log "Pruning dangling images..."
docker image prune -f >/dev/null || true

log "Deploy complete — ${CONTAINER} is live on the numu-test network."
log "nginx (numu-nginx-staging) routes v3.test.numueg.app + *.v3.test.numueg.app here."
