import { registerOTel } from "@vercel/otel";

// Traces go over OTLP to the Alloy sidecar named by OTEL_EXPORTER_OTLP_ENDPOINT
// (deploy/docker-compose.storefront.ec2.yml); with it unset (dev, CI) nothing
// is exported. traceparent is sent only to the NUMU API, so a page render and
// the API calls it makes share one trace id end to end.
export function register() {
  const apiUrl = process.env.NUMU_API_URL;
  registerOTel({
    serviceName: "numu-storefront",
    instrumentationConfig: {
      fetch: { propagateContextUrls: apiUrl ? [apiUrl] : [] },
    },
  });
}
