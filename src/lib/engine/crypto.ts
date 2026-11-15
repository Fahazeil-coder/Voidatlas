import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/* ---------------------------------------------------------------------------
   BLISSVOID credential vault — AES-256-GCM encryption for stored secrets.
--------------------------------------------------------------------------- */

const SALT = "blissvoid-salt";

function masterKey(): Buffer {
  const envKey = process.env.BLISSVOID_MASTER_KEY;
  if (envKey) {
    // Accept either a 64-char hex key or any passphrase (derived via scrypt).
    if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
      return Buffer.from(envKey, "hex");
    }
    return scryptSync(envKey, SALT, 32);
  }
  return scryptSync("blissvoid-dev-master", SALT, 32);
}

let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (!cachedKey) cachedKey = masterKey();
  return cachedKey;
}

/** Encrypt a JSON-serializable object -> "iv:tag:ciphertext" (hex segments). */
export function encryptJSON(obj: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(obj ?? {}), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/** Decrypt an "iv:tag:ciphertext" payload back into an object. Returns null when unreadable. */
export function decryptJSON<T = Record<string, unknown>>(payload: string): T | null {
  try {
    const [ivHex, tagHex, dataHex] = payload.split(":");
    if (!ivHex || !tagHex || !dataHex) return null;
    const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    return null;
  }
}

const SECRET_FIELD_PRIORITY = [
  "token",
  "apikey",
  "api_key",
  "secretkey",
  "secret_key",
  "secret",
  "password",
  "accesstoken",
  "access_token",
  "key",
];

/**
 * Build a masked preview of a credential's secret for safe UI display,
 * e.g. "token: xoxb-sim-••••9f2k" — bullet-masked body plus last 4 chars.
 */
export function maskCredential(type: string, data: Record<string, unknown> | null): string {
  if (!data || typeof data !== "object") return `${type} credential`;

  const entries = Object.entries(data).filter(([, v]) => typeof v === "string" && v.length > 0);
  if (entries.length === 0) return `${type} credential`;

  const lower = (k: string) => k.toLowerCase().replace(/[^a-z]/g, "");
  const secretEntry =
    entries.find(([k]) => SECRET_FIELD_PRIORITY.includes(lower(k))) ??
    entries.sort((a, b) => String(b[1]).length - String(a[1]).length)[0];

  const [field, value] = secretEntry;
  const str = String(value);
  const last4 = str.slice(-4);
  const masked =
    str.length > 12 ? `${str.slice(0, Math.min(8, Math.floor(str.length / 3)))}••••` : "••••";
  return `${field}: ${masked}${last4}`;
}
