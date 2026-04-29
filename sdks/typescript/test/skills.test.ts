import { describe, it, expect } from 'vitest';
import {
  InMemorySkillsPolicy,
  denyAllSkills,
  allowAllSkills,
} from '../src/skills.js';
import { SkillDeniedError } from '../src/errors.js';

describe('InMemorySkillsPolicy', () => {
  it('allows explicitly granted skills', () => {
    const policy = new InMemorySkillsPolicy(['frontend-design', 'sql-query']);
    expect(policy.canInvoke('frontend-design')).toBe(true);
    expect(policy.canInvoke('sql-query')).toBe(true);
    expect(policy.canInvoke('kernel-write')).toBe(false);
  });

  it('supports wildcard suffix matches', () => {
    const policy = new InMemorySkillsPolicy(['frontend-*']);
    expect(policy.canInvoke('frontend-design')).toBe(true);
    expect(policy.canInvoke('frontend-test')).toBe(true);
    expect(policy.canInvoke('backend-foo')).toBe(false);
  });

  it('assertCanInvoke throws SkillDeniedError', () => {
    const policy = new InMemorySkillsPolicy(['frontend-design']);
    expect(() => policy.assertCanInvoke('frontend-design')).not.toThrow();
    expect(() => policy.assertCanInvoke('backend-write')).toThrow(SkillDeniedError);
  });

  it('grant/revoke are immutable', () => {
    const a = new InMemorySkillsPolicy(['x']);
    const b = a.grant('y');
    const c = b.revoke('x');
    expect(a.listAllowed()).toEqual(['x']);
    expect(b.listAllowed()).toEqual(['x', 'y']);
    expect(c.listAllowed()).toEqual(['y']);
  });

  it('grant returns same instance when skill is already present', () => {
    const a = new InMemorySkillsPolicy(['x']);
    expect(a.grant('x')).toBe(a);
  });

  it('revoke returns same instance when skill is absent', () => {
    const a = new InMemorySkillsPolicy(['x']);
    expect(a.revoke('y')).toBe(a);
  });

  it('denyAllSkills denies everything', () => {
    expect(denyAllSkills.canInvoke('anything')).toBe(false);
  });

  it('allowAllSkills allows via wildcard', () => {
    expect(allowAllSkills.canInvoke('anything')).toBe(true);
    expect(allowAllSkills.canInvoke('foo-bar')).toBe(true);
  });
});
