import { describe, expect, it } from 'vitest';
import {
  AllowListSkillsPolicy,
  CompositeSkillsPolicy,
  DenyUnlessScopedSkillsPolicy,
  StaticCapabilityChecker,
  skillScope,
  toolScope,
} from '../src/policy.js';
import { makeIdentity } from './fixtures.js';

describe('StaticCapabilityChecker', () => {
  it('matches literal scopes', () => {
    const c = new StaticCapabilityChecker(['tools:invoke:bash']);
    expect(c.check('tools:invoke:bash').allowed).toBe(true);
    expect(c.check('tools:invoke:read').allowed).toBe(false);
  });

  it('matches wildcard scopes', () => {
    const c = new StaticCapabilityChecker(['skills:invoke:web.*']);
    expect(c.check('skills:invoke:web.search').allowed).toBe(true);
    expect(c.check('skills:invoke:web.fetch').allowed).toBe(true);
    expect(c.check('skills:invoke:fs.read').allowed).toBe(false);
  });

  it('returns matchedScope on hit', () => {
    const c = new StaticCapabilityChecker(['tools:invoke:bash']);
    expect(c.check('tools:invoke:bash').matchedScope).toBe('tools:invoke:bash');
  });
});

describe('DenyUnlessScopedSkillsPolicy', () => {
  it('denies when scope is missing', async () => {
    const p = new DenyUnlessScopedSkillsPolicy();
    const ctx = {
      identity: makeIdentity(),
      capabilities: new StaticCapabilityChecker([]),
    };
    const d = await p.evaluate('foo', ctx);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('No matching scope');
  });

  it('allows when scope is held', async () => {
    const p = new DenyUnlessScopedSkillsPolicy();
    const ctx = {
      identity: makeIdentity(),
      capabilities: new StaticCapabilityChecker(['skills:invoke:foo']),
    };
    const d = await p.evaluate('foo', ctx);
    expect(d.allowed).toBe(true);
    expect(d.matchedScope).toBe('skills:invoke:foo');
  });
});

describe('AllowListSkillsPolicy', () => {
  it('blocks anything not in the list', async () => {
    const p = new AllowListSkillsPolicy(['web.search']);
    const ctx = {
      identity: makeIdentity(),
      capabilities: new StaticCapabilityChecker(['skills:invoke:web.search']),
    };
    expect((await p.evaluate('web.search', ctx)).allowed).toBe(true);
    expect((await p.evaluate('fs.write', ctx)).allowed).toBe(false);
  });
});

describe('CompositeSkillsPolicy', () => {
  it('requires every policy to allow', async () => {
    const c = new CompositeSkillsPolicy([
      new AllowListSkillsPolicy(['web.search', 'fs.read']),
      new DenyUnlessScopedSkillsPolicy(),
    ]);
    const ctx = {
      identity: makeIdentity(),
      capabilities: new StaticCapabilityChecker(['skills:invoke:web.search']),
    };
    expect((await c.evaluate('web.search', ctx)).allowed).toBe(true);
    expect((await c.evaluate('fs.read', ctx)).allowed).toBe(false); // missing scope
    expect((await c.evaluate('fs.write', ctx)).allowed).toBe(false); // not in list
  });
});

describe('scope helpers', () => {
  it('builds canonical scope strings', () => {
    expect(skillScope('web.search')).toBe('skills:invoke:web.search');
    expect(toolScope('bash')).toBe('tools:invoke:bash');
  });
});
