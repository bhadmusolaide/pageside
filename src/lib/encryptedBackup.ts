import { isVaultExport, type VaultExport } from './vault.ts';

const FORMAT = 'pageside-encrypted-vault';
const VERSION = 1;
const KDF = 'PBKDF2-SHA-256';
const CIPHER = 'AES-256-GCM';
const ITERATIONS = 310_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_PLAINTEXT_BYTES = 50 * 1024 * 1024;
const MAX_CIPHERTEXT_BASE64_LENGTH = Math.ceil((MAX_PLAINTEXT_BYTES + 16) / 3) * 4;
export const MAX_BACKUP_FILE_BYTES = 70 * 1024 * 1024;

export type EncryptedBackupErrorCode =
  | 'password_required'
  | 'password_too_short'
  | 'password_too_long'
  | 'invalid_format'
  | 'decryption_failed'
  | 'invalid_payload'
  | 'crypto_unavailable'
  | 'payload_too_large';

export class EncryptedBackupError extends Error {
  readonly code: EncryptedBackupErrorCode;

  constructor(code: EncryptedBackupErrorCode) {
    super(code);
    this.name = 'EncryptedBackupError';
    this.code = code;
  }
}

export interface EncryptedVaultBackup {
  format: typeof FORMAT;
  version: typeof VERSION;
  kdf: typeof KDF;
  iterations: typeof ITERATIONS;
  cipher: typeof CIPHER;
  salt: string;
  iv: string;
  ciphertext: string;
}

function getCrypto(): Crypto {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle || !cryptoApi.getRandomValues) {
    throw new EncryptedBackupError('crypto_unavailable');
  }
  return cryptoApi;
}

function validatePassword(password: string): void {
  if (password.length < 12) throw new EncryptedBackupError('password_too_short');
  if (password.length > MAX_PASSWORD_LENGTH) throw new EncryptedBackupError('password_too_long');
}

function isBase64(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function additionalData(): Uint8Array {
  return new TextEncoder().encode(`${FORMAT}\n${VERSION}\n${KDF}\n${ITERATIONS}\n${CIPHER}`);
}

async function deriveKey(password: string, salt: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
  const cryptoApi = getCrypto();
  const material = await cryptoApi.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return cryptoApi.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations: ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

export function isEncryptedVaultBackup(value: unknown): value is EncryptedVaultBackup {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<EncryptedVaultBackup>;
  return data.format === FORMAT &&
    data.version === VERSION &&
    data.kdf === KDF &&
    data.iterations === ITERATIONS &&
    data.cipher === CIPHER &&
    isBase64(data.salt, 24) &&
    isBase64(data.iv, 24) &&
    isBase64(data.ciphertext, MAX_CIPHERTEXT_BASE64_LENGTH);
}

export async function encryptVaultBackup(
  backup: unknown,
  password: string
): Promise<EncryptedVaultBackup> {
  validatePassword(password);
  if (!isVaultExport(backup)) throw new EncryptedBackupError('invalid_payload');

  const cryptoApi = getCrypto();
  const plaintext = new TextEncoder().encode(JSON.stringify(backup));
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    throw new EncryptedBackupError('payload_too_large');
  }

  const salt = cryptoApi.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = cryptoApi.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(password, salt, ['encrypt']);
  const ciphertext = await cryptoApi.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(additionalData()),
      tagLength: 128,
    },
    key,
    toArrayBuffer(plaintext)
  );

  return {
    format: FORMAT,
    version: VERSION,
    kdf: KDF,
    iterations: ITERATIONS,
    cipher: CIPHER,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptVaultBackup(value: unknown, password: string): Promise<VaultExport> {
  if (!isEncryptedVaultBackup(value)) throw new EncryptedBackupError('invalid_format');
  if (!password) throw new EncryptedBackupError('password_required');
  if (password.length > MAX_PASSWORD_LENGTH) throw new EncryptedBackupError('password_too_long');

  let salt: Uint8Array;
  let iv: Uint8Array;
  let ciphertext: Uint8Array;
  try {
    salt = fromBase64(value.salt);
    iv = fromBase64(value.iv);
    ciphertext = fromBase64(value.ciphertext);
  } catch {
    throw new EncryptedBackupError('invalid_format');
  }
  if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES ||
      ciphertext.length < 16 || ciphertext.length > MAX_PLAINTEXT_BYTES + 16) {
    throw new EncryptedBackupError('invalid_format');
  }

  const cryptoApi = getCrypto();
  const key = await deriveKey(password, salt, ['decrypt']);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await cryptoApi.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(iv),
        additionalData: toArrayBuffer(additionalData()),
        tagLength: 128,
      },
      key,
      toArrayBuffer(ciphertext)
    );
  } catch {
    throw new EncryptedBackupError('decryption_failed');
  }
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    throw new EncryptedBackupError('payload_too_large');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
  } catch {
    throw new EncryptedBackupError('invalid_payload');
  }
  if (!isVaultExport(parsed)) throw new EncryptedBackupError('invalid_payload');
  return parsed;
}
