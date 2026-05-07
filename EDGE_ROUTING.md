# Production edge routing for the storefront

**Audience:** SRE / platform deploys. Theme developers don't need to read this.

## What we're solving

`numu-storefront` resolves a store via the first path segment under
`[domain]/...`:
`/lumiere/products/foo` → renders Lumiere's product page.

In production, customers visit `<sub>.numueg.app/products/foo` (no
path-segment). The platform's edge layer needs to rewrite the
hostname-based URL to the path-segment URL Next.js expects, *before*
the request reaches the Node origin.

`src/proxy.ts` already does this rewrite when the request lands on the
Next.js process directly (e.g., dev or a misconfigured prod). But
relying on the Node middleware in production:

- adds latency (one extra hop into Node before any SSR work),
- can't be cached at the edge (the rewrite decision happens after the
  edge cache checks the URL),
- duplicates the policy in two places.

So the canonical production setup runs the rewrite at the edge.

## Cloudflare Worker (recommended)

Saves the Node middleware completely; CF cache works on the rewritten
URL so subsequent identical requests bypass origin.

```js
// cloudflare-worker.js
const PLATFORM_DOMAIN = "numueg.app";

addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const host = url.hostname.toLowerCase();

  // Apex / www / control-plane subdomains pass through unchanged.
  if (
    host === PLATFORM_DOMAIN ||
    host === `www.${PLATFORM_DOMAIN}` ||
    ["api", "admin", "merchant", "dashboard", "app"].some(
      (s) => host === `${s}.${PLATFORM_DOMAIN}`,
    )
  ) {
    return; // serve as-is
  }

  let subdomain = null;
  if (host.endsWith(`.${PLATFORM_DOMAIN}`)) {
    subdomain = host.slice(0, -(PLATFORM_DOMAIN.length + 1));
  } else {
    // custom domain — route through the storefront with the full
    // hostname as the [domain] segment; api-client.fetchStoreByDomain
    // distinguishes by presence of dots.
    subdomain = host;
  }

  if (subdomain) {
    url.pathname = `/${subdomain}${url.pathname}`;
    event.respondWith(
      fetch(new Request(url.toString(), event.request), {
        cf: {
          // Cache the rewritten request at the edge. Storefront
          // emits no-cache for personalized routes (/cart, /account)
          // already.
          cacheEverything: true,
          cacheTtl: 60,
        },
      }),
    );
  }
});
```

Worker route binding: `*.numueg.app/*` and any custom-domain stores.

## nginx (alternative)

Same logic, no edge cache. Useful when there's already an nginx/HAProxy
in front of the Node origin.

```nginx
# /etc/nginx/conf.d/numu-storefront.conf
map $host $store_subdomain {
  default        "";

  # Strip the platform suffix for *.numueg.app
  ~^(?<sub>[a-z0-9-]+)\.numueg\.app$  $sub;

  # Apex + control-plane hosts → empty (no rewrite)
  numueg.app      "";
  www.numueg.app  "";
  api.numueg.app  "";
  admin.numueg.app  "";
  merchant.numueg.app  "";
  dashboard.numueg.app  "";
  app.numueg.app  "";
}

server {
  listen 443 ssl http2;
  server_name *.numueg.app;

  # Custom-domain stores: the host doesn't match *.numueg.app, so
  # $store_subdomain stays empty. Route them through a separate
  # block that uses $host as the [domain] segment.

  location / {
    if ($store_subdomain != "") {
      # Rewrite hostname-based URL to path-segment URL Next.js
      # expects. Internal redirect — no client-visible change.
      rewrite ^/(.*)$ /$store_subdomain/$1 last;
    }

    proxy_pass http://numu-storefront-upstream;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # Forward the original hostname so api-client can distinguish
    # subdomain vs custom domain.
    proxy_set_header X-Numu-Host $host;
  }
}

# Custom-domain block
server {
  listen 443 ssl http2;
  server_name ~^(?<custom>[^.]+(\..+)+)$;

  location / {
    rewrite ^/(.*)$ /$custom/$1 last;
    proxy_pass http://numu-storefront-upstream;
    proxy_set_header Host $host;
    proxy_set_header X-Numu-Host $host;
  }
}
```

## Health check / fall-through

Both edge layers should leave the proxy.ts middleware in place as a
defense-in-depth fallback. If the edge config is wrong (or removed
during a config rollback), the Node layer keeps requests routed
correctly — they're just slower until the edge is fixed.

Validate with:

```bash
curl -I https://lumiere.numueg.app/products/foo -H "Cache-Control: no-cache"
# Expect 200 with no `x-numu-fallback-rewrite: true` header set by the
# Node middleware. If that header IS present, the edge isn't rewriting.
```
