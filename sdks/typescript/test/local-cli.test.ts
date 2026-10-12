import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/cli.js';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function directory() {
  const path = await mkdtemp(join(process.cwd(), '.oaid-local-cli-'));
  directories.push(path);
  return path;
}

async function command(args: string[]) {
  const stdout: string[] = [], stderr: string[] = [];
  const code = await runCli(args, { stdout: value => stdout.push(value), stderr: value => stderr.push(value),
    fetch: async () => { throw new Error('Local commands must not use a remote service'); } });
  return { code, out: stdout.join(''), err: stderr.join('') };
}

describe('public local CLI integration', () => {
  it('creates separate real identities and receivers, verifies once, then retains revocation', async () => {
    const root = await directory();
    const signer = join(root, 'signer'), receiver = join(root, 'receiver');
    const audience = 'https://my-application.example/agents';
    for (const path of [signer, receiver]) {
      expect((await command(['init', '--directory', path, '--audience', audience])).code).toBe(0);
    }
    const created = await command(['agent', 'create', '--name', 'Local researcher', '--directory', signer]);
    expect(created.code, created.err).toBe(0);
    const agent = JSON.parse(created.out);
    expect(agent.did).toMatch(/^did:oas:openagent:agent:/);
    expect(agent.publicKeyJwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519' });
    expect(agent.publicKeyJwk.d).toBeUndefined();
    expect((await command(['challenge', '--did', agent.did, '--directory', receiver])).code).toBe(1);

    const publicFile = join(root, 'public-identity.json');
    expect((await command(['agent', 'export', '--did', agent.did, '--directory', signer, '--output', publicFile])).code).toBe(0);
    const exported = JSON.parse(await readFile(publicFile, 'utf8'));
    expect(Object.keys(exported).sort()).toEqual(['did', 'name', 'publicKeyJwk', 'schemaVersion']);
    expect((await command(['agent', 'trust', '--document', publicFile, '--directory', receiver])).code).toBe(0);

    const challenge = JSON.parse((await command(['challenge', '--did', agent.did, '--directory', receiver])).out);
    const proofFile = join(root, 'proof.json');
    expect((await command(['prove', '--did', agent.did, '--nonce', challenge.nonce, '--audience', audience,
      '--directory', signer, '--output', proofFile])).code).toBe(0);
    const verify = ['verify', '--local', '--proof', proofFile, '--nonce', challenge.nonce, '--directory', receiver];
    const verified = await command(verify);
    expect(verified.code, verified.err).toBe(0);
    expect(JSON.parse(verified.out)).toMatchObject({ did: agent.did, owner: null, root: { kind: 'self' } });
    const replay = await command(verify);
    expect(replay.code).toBe(1);
    expect(replay.out).toBe('');
    expect(replay.err).not.toContain(JSON.parse(await readFile(proofFile, 'utf8')).token);

    const second = JSON.parse((await command(['challenge', '--did', agent.did, '--directory', receiver])).out);
    const secondProof = join(root, 'second-proof.json');
    expect((await command(['prove', '--did', agent.did, '--nonce', second.nonce, '--audience', audience,
      '--directory', signer, '--output', secondProof])).code).toBe(0);
    expect((await command(['agent', 'revoke', '--did', agent.did, '--directory', receiver])).code).toBe(0);
    expect((await command(['verify', '--local', '--proof', secondProof, '--nonce', second.nonce, '--directory', receiver])).code).toBe(1);
    const doctor = await command(['doctor', '--directory', receiver]);
    expect(doctor.code, doctor.err).toBe(0);
    expect(JSON.parse(doctor.out)).toMatchObject({ storage: 'valid', revoked: 1, hostedServiceRequired: false });
  });

  it('never overwrites a workspace or requested output file', async () => {
    const root = await directory();
    const path = join(root, 'identity');
    expect((await command(['init', '--directory', path])).code).toBe(0);
    expect((await command(['init', '--directory', path])).code).toBe(1);
    const created = await command(['agent', 'create', '--name', 'Agent', '--directory', path]);
    const did = JSON.parse(created.out).did;
    const output = join(root, 'kept.json');
    await writeFile(output, 'keep this exact content');
    expect((await command(['agent', 'export', '--did', did, '--directory', path, '--output', output])).code).toBe(1);
    expect(await readFile(output, 'utf8')).toBe('keep this exact content');
  });

  it('rejects malformed proof files without echoing their contents', async () => {
    const root = await directory();
    const file = join(root, 'invalid.json');
    await writeFile(file, 'secret-key-material-that-must-not-be-printed');
    const result = await command(['verify', '--local', '--proof', file, '--nonce', 'nonce', '--directory', join(root, 'unused')]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('Input is not valid UTF-8 JSON');
    expect(result.err).not.toContain('secret-key-material');
  });

  it('renders both live skins and maps actual statuses without a hosted API', async () => {
    const did = 'did:oas:openagent:agent:cli-avatar';
    const autos = await command(['avatar', did, '--status', 'reasoning']);
    expect(autos.code, autos.err).toBe(0);
    expect(autos.out).toContain('autos');
    expect(autos.out).toContain('thoughtful');
    const space = await command(['avatar', did, '--skin', 'spacex', '--expression', 'happy']);
    expect(space.code, space.err).toBe(0);
    expect(space.out).toContain('spacex');
    expect(space.out).toContain('happy');
    expect((await command(['avatar', did, '--skin', 'unknown'])).code).toBe(1);
    expect((await command(['avatar', did, '--status', 'made-up'])).code).toBe(1);
  });

  it('discovers every family and renders a selected holiday kind in either framing', async () => {
    const catalog = await command(['avatar', 'skins']);
    expect(catalog.code, catalog.err).toBe(0);
    const families = JSON.parse(catalog.out) as { id: string; shapes: string[] }[];
    expect(families).toHaveLength(17);
    expect(families.reduce((sum, family) => sum + family.shapes.length, 0)).toBe(62);
    for (const family of families) {
      const result = await command(['avatar', 'did:oas:openagent:agent:cli-family', '--skin', family.id,
        '--shape', family.shapes[0]!, '--status', 'reasoning']);
      expect(result.code, result.err).toBe(0);
      expect(result.out).toContain('data-character-view="avatar"');
      expect(result.out).toContain('data-character-expression="thoughtful"');
    }
    const full = await command(['avatar', 'did:oas:openagent:agent:cli-family', '--skin', 'christmas',
      '--shape', 'snowman', '--view', 'full']);
    expect(full.code, full.err).toBe(0);
    expect(full.out).toContain('viewBox="0 0 512 512"');
    expect(full.out).toContain('data-character-shape="snowman"');
    for (const flags of [['--skin', 'halloween', '--shape', 'snowman'], ['--view', 'unknown'], ['--shape', 'tree']]) {
      expect((await command(['avatar', 'did:oas:openagent:agent:cli-family', ...flags])).code).toBe(1);
    }
    expect((await command(['avatar', 'skins', '--skin', 'autos'])).code).toBe(1);
  });

  it('rejects mixed authority modes and duplicate or unknown options', async () => {
    for (const args of [
      ['verify', '--local', '--local'],
      ['verify', '--local', '--endpoint', 'https://example.com', '--proof', 'unused', '--nonce', 'unused'],
      ['init', '--audience', 'one', '--audience', 'two'],
      ['doctor', '--unknown', 'value'], ['agent', 'unknown'], ['--version', 'extra'],
    ]) expect((await command(args)).code).toBe(1);
    const version = await command(['--version']);
    expect(version.out).toBe('0.5.0\n');
    expect((await command(['--help'])).out).toContain('oaid agent trust');
  });
});
