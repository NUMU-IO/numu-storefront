# Deploying numu-storefront to the dedicated prod EC2 (`subdomain.numueg.app`)

numu-storefront is the **only** prod storefront (replaced numu-egyptian-bazaar).
It runs on a dedicated EC2 box, fronted by Cloudflare (Flexible TLS → HTTP :80).

| File | Purpose |
|------|---------|
| `deploy/docker-compose.storefront.ec2.yml` | storefront (GHCR image) + nginx, self-contained |
| `deploy/nginx/ec2-prod.conf` | host-agnostic :80 edge, CF real-IP, frame-ancestors |
| `deploy/.env.prod.example` | server-side runtime env template (copy → `.env.prod`) |
| `scripts/deploy-storefront-ec2.sh` | pull image → recreate → health-gate |
| `.github/workflows/cd-prod.yml` | build → GHCR → SSH deploy on push to `prod` |

## Box specs
`t3.small`, Amazon Linux 2023, eu-west-1, **+4 GiB swap** (headroom), Docker.
SG: **80** from Cloudflare ranges, **22** from your IP. No 443 (CF terminates TLS).

## One-time box setup
```bash
ssh -i numu-store.pem ec2-user@<EC2_IP>
sudo dnf install -y docker && sudo systemctl enable --now docker && sudo usermod -aG docker ec2-user
# 4 GiB swap
sudo dd if=/dev/zero of=/swapfile bs=1M count=4096 && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# runtime env (server-side only; NEXT_PUBLIC_* are baked into the image by CI)
sudo mkdir -p /opt/numu-storefront/deploy && sudo chown -R ec2-user /opt/numu-storefront
# create /opt/numu-storefront/deploy/.env.prod from .env.prod.example, fill from `heroku config`, chmod 600
```

## GitHub secrets (repo → Settings → Secrets → Actions)
- `PROD_EC2_HOST` — the EC2 IP (use an **Elastic IP** so it survives stop/start)
- `PROD_EC2_USER` — `ec2-user`
- `PROD_EC2_SSH_KEY` — private key for the `numu-store` key pair
- `NEXT_PUBLIC_GOOGLE_MAPS_KEY` — maps key (build-time)

## Deploy
Push to `prod` (or run the **CD Prod (EC2)** workflow). CI builds the image,
pushes to GHCR, SSHes the box, and runs the deploy script. The box pulls + flips.

## Cutover (Cloudflare)
1. Test one subdomain first: point `<teststore>.numueg.app` (DNS-only) → EC2 IP,
   verify in a browser incl. the theme-editor iframe.
2. Flip the `*.numueg.app` A record (DNS-only) from the droplet → EC2 IP.
3. Rollback = revert the record (Heroku/droplet stay up until you decommission).

## Smoke test (no DNS needed)
```bash
curl -s -H 'Host: <store>.numueg.app' http://<EC2_IP>/__numu-runtime/manifest.json | head -c 80
curl -s -H 'Host: <store>.numueg.app' http://<EC2_IP>/ -o /dev/null -w '%{http_code}\n'
```
