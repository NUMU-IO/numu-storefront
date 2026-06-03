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
| `deploy/docker-compose.storefront.v3.test.yml` | Single-container service on the shared `numu-edge` network |
| `scripts/deploy-storefront-v3.sh` | Pull → recreate → health-gate deploy |
| `deploy/nginx/v3.test.conf` | nginx server block for `v3.test` + `*.v3.test` |

---

## One-time setup (per droplet)

The droplet serves these hosts on **443 with Let's Encrypt origin certs**
(the existing `<store>-test` block uses `/etc/letsencrypt/live/numueg.app`),
not CF-Flexible HTTP. numu-storefront's middleware (`proxy.ts`) derives the
tenant as `host.slice(0, -(PLATFORM_DOMAIN+1))`, so the host scheme must be
`<store>.v3.test.numueg.app` (dot) with `NUMU_PLATFORM_DOMAIN=v3.test.numueg.app`.

**1. Cloudflare DNS** — add two **proxied** A records → `188.166.156.151`
(`*.numueg.app` only matches one label, so `v3.test` needs its own records).
Use the CF token already on the droplet:
```bash
# extract the value programmatically; do not print it
CF_TOKEN=$(grep -i 'token' /root/.cloudflare-credentials.ini | cut -d= -f2- | tr -d ' ')
ZONE=$(curl -s -H "Authorization: Bearer $CF_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones?name=numueg.app" | python3 -c "import sys,json;print(json.load(sys.stdin)['result'][0]['id'])")
for name in v3.test '*.v3.test'; do
  curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
    -H "Authorization: Bearer $CF_TOKEN" -H "Content-Type: application/json" \
    --data "{\"type\":\"A\",\"name\":\"$name\",\"content\":\"188.166.156.151\",\"proxied\":true}" \
    | python3 -c "import sys,json;r=json.load(sys.stdin);print('ok' if r['success'] else r['errors'])"
done
```

**2. TLS** — issue a cert for `v3.test` + `*.v3.test` via the same DNS-01 flow
used for `*.test`/`*.staging`:
```bash
docker run --rm \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/lib/letsencrypt:/var/lib/letsencrypt \
  -v /root/.cloudflare-credentials.ini:/cf.ini:ro \
  certbot/dns-cloudflare certonly --dns-cloudflare \
  --dns-cloudflare-credentials /cf.ini --dns-cloudflare-propagation-seconds 30 \
  -d v3.test.numueg.app -d '*.v3.test.numueg.app' \
  --non-interactive --agree-tos -m noreply@numueg.app
```
This creates `/etc/letsencrypt/live/v3.test.numueg.app/` (the path the nginx
block references). The certbot container must reach `/etc/letsencrypt` the
same way the existing renewals do.

**3. Runtime env file** — `/opt/numu/.env.v3.test` (chmod 600). ✅ Already
created on this droplet (NUMU_API_URL, NUMU_PLATFORM_DOMAIN, NUMU_IMAGE_HOSTS,
and REVALIDATION_SECRET reused from `.env.test`).

**4. nginx** — `/opt/numu/docker/nginx/nginx.conf` is one monolithic file (no
conf.d include), edited in place with timestamped `.bak` backups. Back it up,
insert the two server blocks from `deploy/nginx/v3.test.conf` next to the other
`-test` blocks, validate, reload — inode-safe (no `mv`/`sed -i`; the file is
bind-mounted, so a rotated inode keeps the container on the old content):
```bash
cp -a /opt/numu/docker/nginx/nginx.conf /opt/numu/docker/nginx/nginx.conf.bak.v3.$(date +%s)
# paste the two blocks (or append before the http{} closing brace), then:
docker exec numu-nginx-staging nginx -t \
  && docker exec numu-nginx-staging nginx -s reload
```

**5. Backend tenancy** (optional) — to let the bare `v3.test.numueg.app` bypass
tenant resolution, add it to `RESERVED_HOST_SUBDOMAINS` in the API
(`src/infrastructure/tenancy/middleware.py`). Per-store hosts work without it.

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
