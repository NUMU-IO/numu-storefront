# Deploying the V3 BYOT storefront to the dev env (`v3.test.numueg.app`)

This deploys `numu-storefront` as a **parallel host** on the existing dev/test
stack so the whole V3 theme engine can be tested end-to-end without touching
the live bazaar storefront. When bazaar is retired, this same container can take
over its hostnames/slot (it already speaks the droplet's nginx + network model).

```
browser ── CF (TLS, Flexible) ──► droplet :80 nginx (numu-nginx-staging)
                                      │  Host: <store>.v3.test.numueg.app
                                      ▼
                         numu-storefront-v3-test  (this app, port 3000)
                                      │  NUMU_API_URL
                                      ▼
                         test API  (test.numueg.app/api/v1)
```

## Repo artifacts (in this repo)
| File | Purpose |
|------|---------|
| `Dockerfile` | Standalone Next image (lean runtime, BYOT runtime baked in) |
| `.dockerignore` | Keeps the build context lean |
| `deploy/docker-compose.storefront.v3.test.yml` | Single-container service on the `numu-test` network |
| `scripts/deploy-storefront-v3.sh` | Pull → recreate → health-gate deploy |
| `deploy/nginx/v3.test.conf` | nginx server block for `v3.test` + `*.v3.test` |

---

## One-time setup (per droplet)

**1. Cloudflare DNS** — add two **proxied** A records → `188.166.156.151`:
```
v3.test     A  188.166.156.151   (proxied)
*.v3.test   A  188.166.156.151   (proxied)
```

**2. TLS** — CF SSL/TLS mode is *Flexible*, so the browser↔CF leg uses CF's
edge cert. CF Universal SSL only covers `numueg.app` + `*.numueg.app` (one
label), so the 2-/3-label `v3.test` names need either:
- Cloudflare **Total TLS / Advanced Certificate Manager** for `*.v3.test.numueg.app`, **or**
- a Let's Encrypt cert via DNS-01 like the other deep wildcards
  (`certbot/dns-cloudflare` + `/root/.cloudflare-credentials.ini`) if you later
  switch CF to Full. For Flexible mode the origin block is plain HTTP, so no
  origin cert is required to start testing.

**3. Runtime env file** — create `/opt/numu/.env.v3.test` (chmod 600):
```dotenv
# API ROOT — the app appends /api/v1 itself. Do NOT include /api/v1 here.
NUMU_API_URL=https://test.numueg.app
# Platform domain so the storefront middleware extracts <store> from
# <store>.v3.test.numueg.app correctly.
NUMU_PLATFORM_DOMAIN=v3.test.numueg.app
NUMU_IMAGE_HOSTS=**.numueg.app,**.r2.cloudflarestorage.com
REVALIDATION_SECRET=<same secret the test API uses for ISR revalidation>
```

**4. nginx** — copy `deploy/nginx/v3.test.conf` into the shared nginx config
(`/opt/numu/docker/nginx/` as a conf.d include, or paste into `nginx.conf`),
then:
```bash
docker exec numu-nginx-staging nginx -t && \
docker exec numu-nginx-staging nginx -s reload
```
> The nginx.conf file is CRLF and bind-mounted (not git-tracked). Edit in place
> with an inode-safe method (`cp`/`>`), not `mv`/`sed -i`, or the container keeps
> the old content even after reload.

**5. Backend tenancy** (optional) — to let the bare apex `v3.test.numueg.app`
bypass tenant resolution, add it to `RESERVED_HOST_SUBDOMAINS` in the API
(`src/infrastructure/tenancy/middleware.py`). Per-store hosts
(`<store>.v3.test.numueg.app`) work without this.

---

## Build, push, deploy

Images publish to GHCR (same registry as the API). Build with the dev public
env baked in:

```bash
# from the repo root, on a machine with docker + ghcr login
docker build \
  --build-arg NEXT_PUBLIC_NUMU_ENV=test \
  --build-arg NEXT_PUBLIC_BYOT_BUNDLE_HOSTS="https://*.v3.test.numueg.app,https://test.numueg.app" \
  -t ghcr.io/numu-io/numu-storefront:dev .

docker push ghcr.io/numu-io/numu-storefront:dev
```

Then on the droplet (copy `deploy/docker-compose.storefront.v3.test.yml` →
`/opt/numu/docker/` and `scripts/deploy-storefront-v3.sh` → `/opt/numu/` first):

```bash
NUMU_STOREFRONT_V3_IMAGE=ghcr.io/numu-io/numu-storefront:dev \
  /opt/numu/deploy-storefront-v3.sh
```

The script pulls, recreates the container, and waits for `healthy`
(`/__numu-runtime/manifest.json`). nginx already points at the stable container
name, so no upstream flip is needed.

---

## Test the full theme engine

1. Publish CLI/SDK/plugin **0.2.0** are already on npm.
2. Scaffold + build a theme:
   ```bash
   npx @numueg/theme-cli init demo-theme
   cd demo-theme && npm i && npx numu-theme build
   npx numu-theme submit            # uploads the bundle to the configured (test) backend
   ```
3. In the merchant hub (test), set the demo store's active theme to that BYOT
   theme.
4. Visit `https://<store>.v3.test.numueg.app` — `ByotThemeBoundary` resolves the
   theme, loads the federated bundle (sharing the `/__numu-runtime` React/SDK
   copies), mounts it, and renders product / cart / checkout.
5. Confirm the merchant-hub theme-editor **preview iframe** points at the
   `v3.test` host and live-updates (PreviewBridge + the app's CSP
   `frame-ancestors` allow the embed).

---

## Rollback
Redeploy the previous image tag:
```bash
NUMU_STOREFRONT_V3_IMAGE=ghcr.io/numu-io/numu-storefront:<previous-sha> \
  /opt/numu/deploy-storefront-v3.sh
```

## Promotion to staging / prod
Dev is single-container. For `staging.numueg.app` / apex, add a blue/green
variant of the compose + deploy script (mirror
`numu-egyptian-bazaar/deploy/docker-compose.storefront.*.yml` and
`scripts/deploy-storefront.sh`) so promotions are zero-downtime. The endgame
for retiring bazaar: point its hostnames at this container and delete bazaar's
compose.
