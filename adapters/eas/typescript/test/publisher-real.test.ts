import { afterAll, beforeAll, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { ContractFactory, JsonRpcProvider, ZeroAddress } from 'ethers';
import { SchemaRegistry, EAS } from '@ethereum-attestation-service/eas-sdk';
import { EasAnchorPublisher, EasAnchorResolver, SCHEMA_STRING, didRecipient } from '../src/index.js';

// A real local EVM and the released EAS contracts. The small HTTP index below
// reads actual chain state; it does not manufacture attestation/revocation data.
const require = createRequire(import.meta.url);
let node: ChildProcess;
let provider: JsonRpcProvider;
let rpcUrl: string;
let output = '';
beforeAll(async () => {
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('Missing local EVM port');
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  rpcUrl = `http://127.0.0.1:${address.port}`;
  node = spawn(process.execPath, [require.resolve('hardhat/internal/cli/cli'), 'node',
    '--config', 'test/hardhat.config.cjs', '--hostname', '127.0.0.1', '--port', String(address.port)],
  { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
  node.stdout?.on('data', chunk => { output += chunk; });
  node.stderr?.on('data', chunk => { output += chunk; });
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (node.exitCode !== null) throw new Error(`Local EVM exited: ${output}`);
    try {
      const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
      if (response.ok && (await response.json()).result === '0x7a69') break;
    } catch { /* server has not bound its port yet */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  provider = new JsonRpcProvider(rpcUrl);
  expect((await provider.getNetwork()).chainId).toBe(31337n);
}, 30_000);
afterAll(async () => {
  provider?.destroy();
  if (node && node.exitCode === null) { node.kill('SIGTERM'); await once(node, 'exit'); }
});

it('publishes an actual anchor, resolves it, and observes the publisher’s native revocation', async () => {
  const signer = await provider.getSigner(0);
  const registryArtifact = require('@ethereum-attestation-service/eas-contracts/artifacts/contracts/SchemaRegistry.sol/SchemaRegistry.json');
  const easArtifact = require('@ethereum-attestation-service/eas-contracts/artifacts/contracts/EAS.sol/EAS.json');
  const registryContract = await new ContractFactory(registryArtifact.abi, registryArtifact.bytecode, signer).deploy();
  await registryContract.waitForDeployment();
  const easContract = await new ContractFactory(easArtifact.abi, easArtifact.bytecode, signer).deploy(await registryContract.getAddress());
  await easContract.waitForDeployment();
  const registry = new SchemaRegistry(await registryContract.getAddress());
  registry.connect(signer);
  const registration = await registry.register({ schema: SCHEMA_STRING, resolverAddress: ZeroAddress, revocable: true });
  const schemaUid = await registration.wait();
  const eas = new EAS(await easContract.getAddress());
  eas.connect(provider);
  const publisher = new EasAnchorPublisher({ schemaUid, easContractAddress: await easContract.getAddress(), signer });
  const did = 'did:oas:example:hmr:eas-compatibility';
  const uid = await publisher.publishAnchor({ did, kind: 'hmr', status: 'active',
    metadataCommitment: 'sha256:compatibility', anchoredAtBlock: BigInt(await provider.getBlockNumber()) });
  const attester = (await signer.getAddress()).toLowerCase();
  const index = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { variables } = JSON.parse(body);
      const record = await eas.getAttestation(uid);
      expect(variables).toEqual({ schema: schemaUid, recipient: didRecipient(did), attesters: [attester] });
      expect(record.recipient.toLowerCase()).toBe(didRecipient(did));
      expect(record.schema).toBe(schemaUid);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: { attestations: [{ id: uid, data: record.data, attester: record.attester,
        revocationTime: record.revocationTime.toString(), expirationTime: record.expirationTime.toString() }] } }));
    } catch (error) { res.statusCode = 500; res.end(String(error)); }
  }).listen(0, '127.0.0.1');
  await once(index, 'listening');
  const address = index.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP index port');
  try {
    const resolver = new EasAnchorResolver({ schemaUid, trustedAttesters: [attester],
      graphqlUrl: `http://127.0.0.1:${address.port}/graphql`, rpcUrl, confirmationDepth: 0 });
    expect(await resolver.checkRevocation(did)).toEqual({ revoked: false });
    expect((await resolver.getRoot(did, 'hmr'))?.did).toBe(did);
    expect(await resolver.currentFinalizedBlock()).toBeGreaterThan(0);
    await publisher.revoke(uid);
    expect((await eas.getAttestation(uid)).revocationTime).toBeGreaterThan(0n);
    expect((await resolver.checkRevocation(did)).revoked).toBe(true);
    expect((await resolver.getRoot(did, 'hmr'))?.status).toBe('revoked');
  } finally { await new Promise<void>(resolve => index.close(() => resolve())); }
}, 30_000);
