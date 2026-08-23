/**
 * AES-256-GCM encryption for the Authentication vault (bank/card/GST details and
 * passwords). The passphrase never leaves the device and is never stored — only
 * a PBKDF2 salt and an encrypted "canary" string are kept, so a wrong passphrase
 * can be detected without ever knowing the right one.
 */

function toB64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function randomSaltB64(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16)))
}

const PBKDF2_ITERATIONS = 150_000

export async function deriveVaultKey(passphrase: string, saltB64: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromB64(saltB64) as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encrypts to base64(iv || ciphertext). A fresh random IV is used every call. */
export async function encryptText(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext) as BufferSource,
  )
  const combined = new Uint8Array(iv.length + cipher.byteLength)
  combined.set(iv, 0)
  combined.set(new Uint8Array(cipher), iv.length)
  return toB64(combined)
}

/** Throws if `payload` wasn't encrypted with `key` — that's how a wrong passphrase is detected. */
export async function decryptText(key: CryptoKey, payload: string): Promise<string> {
  const combined = fromB64(payload)
  const iv = combined.slice(0, 12)
  const data = combined.slice(12)
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    data as BufferSource,
  )
  return new TextDecoder().decode(plain)
}

export async function encryptJSON(key: CryptoKey, value: unknown): Promise<string> {
  return encryptText(key, JSON.stringify(value))
}

export async function decryptJSON<T>(key: CryptoKey, payload: string): Promise<T> {
  return JSON.parse(await decryptText(key, payload)) as T
}
