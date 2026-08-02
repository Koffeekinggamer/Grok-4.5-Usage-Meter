"use strict";

const fs = require("fs");
const { getAuthPath } = require("./paths");

/**
 * Pick the best auth entry from ~/.grok/auth.json.
 * Prefers a non-expired OIDC entry; falls back to the first entry.
 * @param {Record<string, any>} authFile
 * @param {{ now?: Date }} [opts]
 */
function pickAuthEntry(authFile, opts = {}) {
  if (!authFile || typeof authFile !== "object") {
    throw new Error("auth.json is empty or invalid");
  }

  const now = opts.now ?? new Date();
  const entries = Object.entries(authFile).filter(
    ([, v]) => v && typeof v === "object" && typeof v.key === "string" && v.key
  );

  if (entries.length === 0) {
    throw new Error("No access token in auth.json — run `grok login` first");
  }

  const withExpiry = entries.map(([issuer, entry]) => {
    const expiresAt = entry.expires_at ? new Date(entry.expires_at) : null;
    const expired =
      expiresAt instanceof Date &&
      !Number.isNaN(expiresAt.getTime()) &&
      expiresAt.getTime() <= now.getTime();
    return { issuer, entry, expired, expiresAt };
  });

  const live = withExpiry.find((e) => !e.expired) || withExpiry[0];
  return live;
}

/**
 * Read the signed-in Terminal Grok account from auth.json.
 * @param {{ authPath?: string, now?: Date }} [opts]
 */
function readGrokAccount(opts = {}) {
  const authPath = opts.authPath || getAuthPath();
  if (!fs.existsSync(authPath)) {
    throw new Error(`Grok auth file not found at ${authPath} — run grok login`);
  }

  let raw;
  try {
    raw = fs.readFileSync(authPath, "utf8");
  } catch (err) {
    throw new Error(`Cannot read Grok auth file: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Grok auth.json is not valid JSON");
  }

  const { issuer, entry, expired, expiresAt } = pickAuthEntry(parsed, {
    now: opts.now,
  });

  if (expired) {
    throw new Error(
      "Grok access token expired — open Terminal Grok or run `grok login`"
    );
  }

  return {
    accessToken: entry.key,
    email: entry.email || null,
    userId: entry.user_id || null,
    teamId: entry.team_id || null,
    authMode: entry.auth_mode || null,
    issuer,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
  };
}

module.exports = {
  pickAuthEntry,
  readGrokAccount,
};
