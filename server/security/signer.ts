import fs from 'node:fs';
import { Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import {
  decryptPrivateKey,
  encryptPrivateKey,
  maskAddress,
  parseSolanaSecretKey,
  type EncryptedKeystorePayload,
} from './crypto';

export class ServerSignerManager {
  private unlockedKeypair: Keypair | null = null;
  private source: 'env' | 'keystore' | 'none' = 'none';
  private readonly keystorePath: string;

  constructor(keystorePath: string) {
    this.keystorePath = keystorePath;
  }

  async initFromEnv(envPrivateKey?: string): Promise<void> {
    if (envPrivateKey && envPrivateKey.trim().length > 0) {
      try {
        const bytes = parseSolanaSecretKey(envPrivateKey);
        this.unlockedKeypair = await Keypair.fromSecretKey(bytes);
        this.source = 'env';
        bytes.fill(0);
      } catch {
        this.unlockedKeypair = null;
        this.source = 'none';
      }
    }
  }

  hasKeystoreFile(): boolean {
    return fs.existsSync(this.keystorePath);
  }

  getKeystorePublicKey(): string | null {
    if (!this.hasKeystoreFile()) return null;
    try {
      const raw = fs.readFileSync(this.keystorePath, 'utf8');
      const parsed = JSON.parse(raw) as EncryptedKeystorePayload;
      return parsed.publicKey || null;
    } catch {
      return null;
    }
  }

  isUnlocked(): boolean {
    return this.unlockedKeypair !== null;
  }

  getPublicKey(): string | null {
    return this.unlockedKeypair ? this.unlockedKeypair.publicKey.toBase58() : this.getKeystorePublicKey();
  }

  getMaskedPublicKey(): string {
    return maskAddress(this.getPublicKey());
  }

  getSource(): 'env' | 'keystore' | 'none' {
    return this.source;
  }

  async saveEncryptedKeystore(rawPrivateKey: string, passphrase: string): Promise<{ publicKey: string }> {
    const bytes = parseSolanaSecretKey(rawPrivateKey);
    try {
      const payload = await encryptPrivateKey(bytes, passphrase);
      fs.writeFileSync(this.keystorePath, JSON.stringify(payload, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      this.unlockedKeypair = await Keypair.fromSecretKey(bytes);
      this.source = 'keystore';
      return { publicKey: payload.publicKey };
    } finally {
      bytes.fill(0);
    }
  }

  async unlockWithPassphrase(passphrase: string): Promise<{ publicKey: string }> {
    if (!this.hasKeystoreFile()) {
      throw new Error('No encrypted keystore found. Set up a signer key first.');
    }
    const raw = fs.readFileSync(this.keystorePath, 'utf8');
    const payload = JSON.parse(raw) as EncryptedKeystorePayload;
    const bytes = decryptPrivateKey(payload, passphrase);
    try {
      const kp = await Keypair.fromSecretKey(bytes);
      this.unlockedKeypair = kp;
      this.source = 'keystore';
      return { publicKey: kp.publicKey.toBase58() };
    } finally {
      bytes.fill(0);
    }
  }

  lockMemorySigner(): void {
    this.unlockedKeypair = null;
    if (this.source === 'keystore') {
      this.source = 'none';
    }
  }

  clearKeystore(): void {
    this.unlockedKeypair = null;
    this.source = 'none';
    if (fs.existsSync(this.keystorePath)) {
      fs.unlinkSync(this.keystorePath);
    }
  }

  async signVersionedTransaction(tx: VersionedTransaction): Promise<VersionedTransaction> {
    if (!this.unlockedKeypair) {
      throw new Error('Server signer is locked or not configured.');
    }
    await tx.sign([this.unlockedKeypair]);
    return tx;
  }

  async signLegacyTransaction(tx: Transaction): Promise<Transaction> {
    if (!this.unlockedKeypair) {
      throw new Error('Server signer is locked or not configured.');
    }
    await tx.sign(this.unlockedKeypair);
    return tx;
  }

  getKeypairForInternalSigning(): Keypair {
    if (!this.unlockedKeypair) {
      throw new Error('Server signer is locked or not configured.');
    }
    return this.unlockedKeypair;
  }
}
