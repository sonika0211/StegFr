/**
 * AES-GCM encryption/decryption using Web Crypto.
 * Key is derived from the user password via PBKDF2 (SHA-256, 200k iters).
 * Output layout for hidden payload:
 *   [4-byte BE length] [16-byte salt] [12-byte iv] [ciphertext+tag]
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

async function deriveKey(password: string, salt: Uint8Array) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 200_000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptMessage(message: string, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      enc.encode(message) as BufferSource,
    ),
  );

  const body = new Uint8Array(salt.length + iv.length + ct.length);
  body.set(salt, 0);
  body.set(iv, salt.length);
  body.set(ct, salt.length + iv.length);

  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, false);
  out.set(body, 4);
  return out;
}

export async function decryptMessage(payload: Uint8Array, password: string): Promise<string> {
  if (payload.length < 4) throw new Error("Payload too short");
  const len = new DataView(payload.buffer, payload.byteOffset).getUint32(0, false);
  if (len + 4 > payload.length || len < 28) throw new Error("Invalid payload length");
  const body = payload.subarray(4, 4 + len);
  const salt = body.subarray(0, 16);
  const iv = body.subarray(16, 28);
  const ct = body.subarray(28);
  const key = await deriveKey(password, salt);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource,
  );
  return dec.decode(pt);
}

export function readPayloadLength(payload: Uint8Array): number {
  if (payload.length < 4) return 0;
  return new DataView(payload.buffer, payload.byteOffset).getUint32(0, false);
}