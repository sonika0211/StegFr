/**
 * Crypto module — Fernet (AES-128-CBC + HMAC-SHA256, encrypt-then-MAC).
 * Re-exports the Fernet implementation so existing callers keep working.
 */
export { encryptMessage, decryptMessage, fernetTokenString } from "./fernet";
import { encryptMessage as _enc } from "./fernet";

export function readPayloadLength(payload: Uint8Array): number {
  if (payload.length < 4) return 0;
  return new DataView(payload.buffer, payload.byteOffset).getUint32(0, false);
}
// keep _enc referenced to avoid unused-import pruning
void _enc;