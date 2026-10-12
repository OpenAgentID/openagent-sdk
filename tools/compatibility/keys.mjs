// Installed-package recovery across process restarts, with independent Node crypto.
import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { keys, setKeyCryptoBinding } from '@openagentid/sdk';
import * as wasm from '@openagentid/crypto-wasm';

setKeyCryptoBinding(wasm);
const message = new TextEncoder().encode('OpenAgentID seed recovery across processes');
if (process.argv[2] === '--restore') {
  const restored = await keys.fromSeedFile(process.argv[3]);
  process.stdout.write(JSON.stringify({
    verifyingKey: Buffer.from(restored.verifyingKey).toString('hex'),
    encryptionPublicKey: Buffer.from(restored.encryptionPublicKey).toString('hex'),
    signature: Buffer.from(wasm.ed25519_sign(restored.signingKey, message)).toString('hex'),
  }));
} else {
  const directory = await mkdtemp(join(process.cwd(), '.keys-recovery-'));
  try {
    const original = await keys.generate();
    const path = join(directory, 'seed');
    await keys.saveSeed(original, path);
    const child = spawnSync(process.execPath, [import.meta.filename, '--restore', path], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const restored = JSON.parse(child.stdout);
    assert.equal(restored.verifyingKey, Buffer.from(original.verifyingKey).toString('hex'));
    assert.equal(restored.encryptionPublicKey, Buffer.from(original.encryptionPublicKey).toString('hex'));
    const publicKey = createPublicKey({ key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'), original.verifyingKey,
    ]), format: 'der', type: 'spki' });
    assert(verify(null, message, publicKey, Buffer.from(restored.signature, 'hex')));
    const privateKey = createPrivateKey({ key: Buffer.concat([
      Buffer.from('302e020100300506032b656e04220420', 'hex'), original.encryptionSecretKey,
    ]), format: 'der', type: 'pkcs8' });
    const independentPublic = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(-32);
    assert.equal(restored.encryptionPublicKey, independentPublic.toString('hex'));
    console.log('PASS: installed SDK/WASM preserve signing and X25519 identity across process restart');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
