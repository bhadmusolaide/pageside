import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptVaultBackup,
  encryptVaultBackup,
  EncryptedBackupError,
} from '../src/lib/encryptedBackup.ts';
import type { VaultExport } from '../src/lib/vault.ts';

const backup: VaultExport = {
  version: 1,
  exportedAt: 1,
  items: [{
    type: 'note',
    title: 'Synthetic note',
    content: 'Synthetic backup content.',
    tags: ['test'],
    vaultProfileId: 'default',
    createdAt: 1,
    updatedAt: 1,
  }],
};

test('encrypted vault backups round-trip and reject wrong passwords or tampering', async () => {
  const encrypted = await encryptVaultBackup(backup, 'a-long-test-passphrase');
  assert.doesNotMatch(JSON.stringify(encrypted), /Synthetic backup content|a-long-test-passphrase/);
  assert.deepEqual(await decryptVaultBackup(encrypted, 'a-long-test-passphrase'), backup);

  await assert.rejects(
    decryptVaultBackup(encrypted, 'a-different-passphrase'),
    error => error instanceof EncryptedBackupError && error.code === 'decryption_failed'
  );

  const tampered = {
    ...encrypted,
    ciphertext: `${encrypted.ciphertext[0] === 'A' ? 'B' : 'A'}${encrypted.ciphertext.slice(1)}`,
  };
  await assert.rejects(
    decryptVaultBackup(tampered, 'a-long-test-passphrase'),
    error => error instanceof EncryptedBackupError && error.code === 'decryption_failed'
  );
});

test('encryption rejects weak passphrases and invalid backup payloads', async () => {
  await assert.rejects(
    encryptVaultBackup(backup, 'short'),
    error => error instanceof EncryptedBackupError && error.code === 'password_too_short'
  );
  await assert.rejects(
    encryptVaultBackup({ ...backup, items: [{ ...backup.items[0], content: undefined }] }, 'a-long-test-passphrase'),
    error => error instanceof EncryptedBackupError && error.code === 'invalid_payload'
  );
  await assert.rejects(
    decryptVaultBackup({ format: 'pageside-encrypted-vault' }, 'a-long-test-passphrase'),
    error => error instanceof EncryptedBackupError && error.code === 'invalid_format'
  );
});
