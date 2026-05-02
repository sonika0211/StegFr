/**
 * True Fernet (https://github.com/fernet/spec/blob/master/Spec.md)
 * Token layout (binary, then base64url-encoded):
 *   Version (1 byte = 0x80)
 *   Timestamp (8 bytes, big-endian, seconds since epoch)
 *   IV (16 bytes)
 *   Ciphertext (AES-128-CBC, PKCS7 padded, multiple of 16 bytes)
 *   HMAC (32 bytes, HMAC-SHA256 of all preceding bytes)
 *
 * The 32-byte Fernet key is split:
 *   key[0..16]  -> HMAC-SHA256 signing key
 *   key[16..32] -> AES-128 encryption key
 *
 * Key derivation: PBKDF2-SHA256(password, salt, 200_000) -> 32 bytes.
 * The salt (16 B) is prepended to the Fernet token in our payload so the
 * decoder can re-derive the key:
 *
 *   [4 B BE length] [16 B salt] [Fernet token bytes]
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(str: string): Uint8Array {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function deriveFernetKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password) as BufferSource,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: 200_000, hash: "SHA-256" },
    baseKey,
    256,
  );
  return new Uint8Array(bits);
}

function pkcs7Pad(data: Uint8Array, block = 16): Uint8Array {
  const pad = block - (data.length % block);
  const out = new Uint8Array(data.length + pad);
  out.set(data, 0);
  out.fill(pad, data.length);
  return out;
}
function pkcs7Unpad(data: Uint8Array): Uint8Array {
  const pad = data[data.length - 1];
  if (pad < 1 || pad > 16) throw new Error("Bad PKCS7 padding");
  for (let i = data.length - pad; i < data.length; i++) {
    if (data[i] !== pad) throw new Error("Bad PKCS7 padding");
  }
  return data.subarray(0, data.length - pad);
}

async function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  // Web Crypto AES-CBC always pads with PKCS7. To keep the Fernet spec exact
  // we want to control the padding ourselves — but Web Crypto's PKCS7 IS the
  // Fernet padding, so we feed it the raw plaintext and trust its output.
  const ck = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CBC" }, false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-CBC", iv: iv as BufferSource }, ck, plaintext as BufferSource);
  return new Uint8Array(ct);
}
async function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CBC" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, ck, ciphertext as BufferSource);
  return new Uint8Array(pt);
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", ck, data as BufferSource);
  return new Uint8Array(sig);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

/** Build a Fernet token (returns the raw binary token, not base64url). */
async function fernetEncryptRaw(fernetKey: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  if (fernetKey.length !== 32) throw new Error("Fernet key must be 32 bytes");
  const signKey = fernetKey.subarray(0, 16);
  const encKey = fernetKey.subarray(16, 32);

  const iv = crypto.getRandomValues(new Uint8Array(16));
  const ct = await aesCbcEncrypt(encKey, iv, plaintext);

  const ts = Math.floor(Date.now() / 1000);
  const tsBytes = new Uint8Array(8);
  const dv = new DataView(tsBytes.buffer);
  // 64-bit big-endian timestamp (high 32 bits zero for foreseeable future)
  dv.setUint32(0, Math.floor(ts / 0x100000000), false);
  dv.setUint32(4, ts >>> 0, false);

  const head = new Uint8Array(1 + 8 + 16 + ct.length);
  head[0] = 0x80;
  head.set(tsBytes, 1);
  head.set(iv, 9);
  head.set(ct, 25);

  const mac = await hmacSha256(signKey, head);
  const token = new Uint8Array(head.length + 32);
  token.set(head, 0);
  token.set(mac, head.length);
  return token;
}

async function fernetDecryptRaw(fernetKey: Uint8Array, token: Uint8Array): Promise<Uint8Array> {
  if (fernetKey.length !== 32) throw new Error("Fernet key must be 32 bytes");
  if (token.length < 1 + 8 + 16 + 16 + 32) throw new Error("Token too short");
  if (token[0] !== 0x80) throw new Error("Unsupported Fernet version");

  const signKey = fernetKey.subarray(0, 16);
  const encKey = fernetKey.subarray(16, 32);

  const head = token.subarray(0, token.length - 32);
  const mac = token.subarray(token.length - 32);
  const expected = await hmacSha256(signKey, head);
  if (!constantTimeEqual(mac, expected)) throw new Error("HMAC verification failed — wrong key or tampered token");

  const iv = head.subarray(9, 25);
  const ct = head.subarray(25);
  return aesCbcDecrypt(encKey, iv, ct);
}

/**
 * High-level helpers used by the stego pipeline.
 * Output bytes layout: [4B length BE][16B salt][Fernet token...]
 */
export async function encryptMessage(message: string, password: string): Promise<Uint8Array> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const fernetKey = await deriveFernetKey(password, salt);
  const token = await fernetEncryptRaw(fernetKey, enc.encode(message));

  const body = new Uint8Array(salt.length + token.length);
  body.set(salt, 0);
  body.set(token, salt.length);

  const out = new Uint8Array(4 + body.length);
  new DataView(out.buffer).setUint32(0, body.length, false);
  out.set(body, 4);
  return out;
}

export async function decryptMessage(payload: Uint8Array, password: string): Promise<string> {
  if (payload.length < 4) throw new Error("Payload too short");
  const len = new DataView(payload.buffer, payload.byteOffset).getUint32(0, false);
  if (len + 4 > payload.length || len < 16 + 1 + 8 + 16 + 16 + 32) {
    throw new Error("Invalid payload length");
  }
  const body = payload.subarray(4, 4 + len);
  const salt = body.subarray(0, 16);
  const token = body.subarray(16);
  const fernetKey = await deriveFernetKey(password, salt);
  const pt = await fernetDecryptRaw(fernetKey, token);
  return dec.decode(pt);
}

/** Get the human-readable Fernet token (base64url) for display/debug. */
export async function fernetTokenString(message: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const fernetKey = await deriveFernetKey(password, salt);
  const token = await fernetEncryptRaw(fernetKey, enc.encode(message));
  return b64urlEncode(token);
}

export { b64urlEncode, b64urlDecode };