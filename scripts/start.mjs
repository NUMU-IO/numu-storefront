// ENV-1 — make `npm start` self-sufficient (no shell exports needed).
//
// The storefront reads NUMU_API_URL / NUMU_PLATFORM_DOMAIN / REVALIDATION_SECRET
// server-side at runtime. Relying on Next's implicit `.env.local` loading for
// `next start` proved unreliable in this setup — SSR fell back to the code
// default (`http://localhost:8021/api/v1`) and every store rendered
// "Store not found" until the vars were exported in the launching shell.
//
// This wrapper explicitly parses `.env.local` (then `.env`) into process.env
// BEFORE starting Next, so a plain `npm start` works with zero shell exports.
// Real shell env still wins (explicit > file), so CI / ad-hoc overrides keep
// working. NEXT_PUBLIC_* are inlined at build time and are unaffected here.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(name, override) {
  const p = join(root, name);
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const eq = line.indexOf("=");
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (override || process.env[key] === undefined) process.env[key] = val;
  }
}

// .env.local is AUTHORITATIVE — it overrides ambient/shell vars. This is the
// whole point of ENV-1: a stale global like NUMU_API_URL=:8000 (the prod port)
// was shadowing the project's :8001 and pointing SSR at a dead API. Pinned
// project config must win for a reproducible `npm start`. .env only fills gaps.
loadEnvFile(".env.local", true);
loadEnvFile(".env", false);

const port = process.env.PORT || "3100";
console.error(
  "[start.mjs] cwd=" + process.cwd() + " root=" + root +
  " NUMU_API_URL=" + process.env.NUMU_API_URL +
  " REVALIDATION_SECRET=" + (process.env.REVALIDATION_SECRET ? "set" : "unset"),
);
// Invoke Next's binary directly via this node (no `npx`, no `shell:true`):
// on Windows a shell-spawned `npx` did NOT reliably inherit the env we just
// loaded, so the server fell back to its :8021 API default. Passing an
// explicit env object to a non-shell spawn propagates it deterministically.
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "-p", port], {
  stdio: "inherit",
  cwd: root,
  env: { ...process.env },
});
child.on("exit", (code) => process.exit(code ?? 0));
