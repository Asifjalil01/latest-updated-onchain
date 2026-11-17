import crypto from 'node:crypto';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

export interface EncryptedKeystorePayload {
  version: 1;
  kdf: 'scrypt';
  saltHex: string;
  ivHex: string;
  tagHex: string;
  ciphertextHex: string;
  publicKey: string;
  createdAtIso: string;
}

export function maskAddress(address: string | null | undefined): string {
  if (!address) return 'none';
  if (address.length <= 10) return `${address.slice(0, 2)}...${address.slice(-2)}`;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function parseSolanaSecretKey(input: string): Uint8Array {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Private key input is empty.');
  }

  let bytes: Uint8Array;
  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.some((n) => typeof n !== 'number' || n < 0 || n > 255)) {
      throw new Error('JSON private key must be an array of bytes (0-255).');
    }
    bytes = Uint8Array.from(parsed);
  } else {
    bytes = bs58.decode(trimmed);
  }

  if (bytes.length !== 64) {
    throw new Error(`Expected 64-byte Solana secret key, got ${bytes.length} bytes.`);
  }

  return bytes;
}

export async function encryptPrivateKey(
  secretKeyBytes: Uint8Array,
  passphrase: string
): Promise<EncryptedKeystorePayload> {
  if (passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters long.');
  }

  const keypair = await Keypair.fromSecretKey(secretKeyBytes);
  const salt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const derivedKey = crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });

  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv);
    const plaintext = Buffer.from(secretKeyBytes);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    plaintext.fill(0);

    return {
      version: 1,
      kdf: 'scrypt',
      saltHex: salt.toString('hex'),
      ivHex: iv.toString('hex'),
      tagHex: tag.toString('hex'),
      ciphertextHex: encrypted.toString('hex'),
      publicKey: keypair.publicKey.toBase58(),
      createdAtIso: new Date().toISOString(),
    };
  } finally {
    derivedKey.fill(0);
  }
}

export function decryptPrivateKey(payload: EncryptedKeystorePayload, passphrase: string): Uint8Array {
  const salt = Buffer.from(payload.saltHex, 'hex');
  const iv = Buffer.from(payload.ivHex, 'hex');
  const tag = Buffer.from(payload.tagHex, 'hex');
  const ciphertext = Buffer.from(payload.ciphertextHex, 'hex');

  const derivedKey = crypto.scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1 });
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const bytes = new Uint8Array(decrypted);
    decrypted.fill(0);
    return bytes;
  } catch {
    throw new Error('Invalid passphrase or corrupted keystore.');
  } finally {
    derivedKey.fill(0);
  }
}

export function hashSettingsSnapshot(settingsJson: string): string {
  return crypto.createHash('sha256').update(settingsJson).digest('hex').slice(0, 16);
}
