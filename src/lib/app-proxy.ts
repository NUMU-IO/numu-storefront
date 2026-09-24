export const REQUEST_HEADERS = ["accept", "accept-language", "content-type", "user-agent"];
export const RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "content-security-policy",
  "x-content-type-options",
  "location",
];

export function pickHeaders(from: Headers, names: string[]): Headers {
  const out = new Headers();
  for (const name of names) {
    const value = from.get(name);
    if (value) out.set(name, value);
  }
  return out;
}
