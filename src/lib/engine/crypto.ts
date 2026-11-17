import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/* ------------------------------------------------------------------
   BLISSVOID credential vault - AES-256-GCM encryption for stored secrets.
   ------------------------------------------------------------------ */

const LEGACY_SALT = "blissvoid-salt";

function masterKey(salt: string | Buffer = LEGACY_SALT): Buffer {
  const envKey = process.env.BLISSVOID_MASTER_KEY;
  if (process.env.NODE_ENV === "production") {
    if (!envKey || envKey.length < 32 || envKey === "blissvoid-dev-master") {
      throw new Error(
        "CRITICAL: BLISSVOID_MASTER_KEY must be set in production (min 32 chars) and cannot use default key",
      );
    }
  }
  if (envKey) {
    // Accept either a 64-char hex key or any passphrase (derived via scrypt).
    if (/^[0-9a-fA-F]{64}$/.test(envKey)) {
      return Buffer.from(envKey, "hex");
    }
    return scryptSync(envKey, salt, 32);
  }
  return scryptSync("blissvoid-dev-master", salt, 32);
}

let cachedLegacyKey: Buffer | null = null;
function getLegacyKey(): Buffer {
  if (!cachedLegacyKey) cachedLegacyKey = masterKey(LEGACY_SALT);
  return cachedLegacyKey;
}

/** Encrypt a JSON-serializable object -> "v2:salt:iv:tag:ciphertext" (hex segments). */
export function encryptJSON(obj: unknown): string {
  const salt = randomBytes(16);
  const key = masterKey(salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj ?? {}), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v2:${salt.toString("hex")}:${iv.toString("hex")}:${tag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/** Decrypt a stored payload (supports v2 5-part format and legacy 3-part format). */
export function decryptJSON<T = Record<string, unknown>>(payload: string): T | null {
  try {
    const parts = payload.split(":");
    let key: Buffer;
    let ivHex: string;
    let tagHex: string;
    let dataHex: string;

    if (parts.length === 5 && parts[0] === "v2") {
      const [, saltHex, ivPart, tagPart, dataPart] = parts;
      if (!saltHex || !ivPart || !tagPart || !dataPart) return null;
      key = masterKey(Buffer.from(saltHex, "hex"));
      ivHex = ivPart;
      tagHex = tagPart;
      dataHex = dataPart;
    } else if (parts.length === 3) {
      const [ivPart, tagPart, dataPart] = parts;
      if (!ivPart || !tagPart || !dataPart) return null;
      key = getLegacyKey();
      ivHex = ivPart;
      tagHex = tagPart;
      dataHex = dataPart;
    } else {
      return null;
    }

    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
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

/** Recursively redact sensitive secret strings from an arbitrary value. */
export function redactSecrets(value: unknown, secrets: string[]): unknown {
  const activeSecrets = secrets.filter((s) => typeof s === "string" && s.length > 0);
  if (activeSecrets.length === 0) return value;

  if (typeof value === "string") {
    let result = value;
    for (const secret of activeSecrets) {
      if (result.includes(secret)) {
        result = result.split(secret).join("[REDACTED]");
      }
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, activeSecrets));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactSecrets(v, activeSecrets);
    }
    return out;
  }
  return value;
}

/** Produce a non-sensitive masked preview of a credential's fields for list views. */
export function maskCredential(type: string, data: Record<string, unknown> | null): string {
  if (!data) return "Empty";
  const secretKeys = ["apiKey", "token", "secret", "password", "bearerToken", "key", "webhookUrl"];
  for (const field of secretKeys) {
    const val = data[field];
    if (typeof val === "string" && val.length > 0) {
      if (val.length <= 6) return `${field}: ***`;
      const last4 = val.slice(-4);
      const masked = "*".repeat(Math.min(8, val.length - 4));
      return `${field}: ${masked}${last4}`;
    }
  }
  const keys = Object.keys(data);
  if (keys.length === 0) return `${type} (empty)`;
  return `${keys.length} field${keys.length === 1 ? "" : "s"}`;
}
