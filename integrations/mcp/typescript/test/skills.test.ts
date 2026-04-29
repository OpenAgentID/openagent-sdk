/**
 * Unit tests for the skills policy helpers.
 */

import { describe, expect, it } from 'vitest';

import {
  combineSkillsPolicies,
  createSkillsPolicy,
  DEFAULT_SKILL_TOOL_NAMES,
  InMemorySkillsPolicyStore,
} from '../src/skills.js';
import { VerifiedIdentity } from '../src/types.js';

const identity: VerifiedIdentity = {
  did: 'did:oas:test:alice',
  scopes: ['mcp:invoke_skill:invoke'],
  auditId: 'audit-1',
  claims: {},
};

describe('createSkillsPolicy', () => {
  it('allows non-skill tools by default', async () => {
    const policy = createSkillsPolicy({
      store: new InMemorySkillsPolicyStore([]),
    });
    const decision = await policy({
      toolName: 'search_web',
      args: { q: 'mcp' },
      identity,
    });
    expect(decision.allow).toBe(true);
  });

  it('denies skill calls without a skill name', async () => {
    const policy = createSkillsPolicy({
      store: new InMemorySkillsPolicyStore([]),
    });
    const decision = await policy({
      toolName: 'invoke_skill',
      args: {},
      identity,
    });
    expect(decision.allow).toBe(false);
  });

  it('denies skills with no policy entry', async () => {
    const policy = createSkillsPolicy({
      store: new InMemorySkillsPolicyStore([]),
    });
    const decision = await policy({
      toolName: 'invoke_skill',
      args: { skill: 'cook_dinner' },
      identity,
    });
    expect(decision.allow).toBe(false);
    expect(decision.reason).toContain('cook_dinner');
  });

  it('allows skills when the rule lists the caller DID', async () => {
    const policy = createSkillsPolicy({
      store: new InMemorySkillsPolicyStore([
        { skillName: 'cook_dinner', dids: ['did:oas:test:alice'] },
      ]),
    });
    const decision = await policy({
      toolName: 'invoke_skill',
      args: { skill: 'cook_dinner' },
      identity,
    });
    expect(decision.allow).toBe(true);
  });

  it('allows any DID when the rule has dids: null', async () => {
    const policy = createSkillsPolicy({
      store: new InMemorySkillsPolicyStore([
        { skillName: 'cook_dinner', dids: null },
      ]),
    });
    const decision = await policy({
      toolName: 'invoke_skill',
      args: { skill: 'cook_dinner' },
      identity,
    });
    expect(decision.allow).toBe(true);
  });

  it('honours custom isSkillTool matchers', async () => {
    const policy = createSkillsPolicy({
      store: new InMemorySkillsPolicyStore([]),
      isSkillTool: (toolName) => toolName.startsWith('skill_'),
    });
    expect(
      (
        await policy({
          toolName: 'skill_dance',
          args: { skill: 'dance' },
          identity,
        })
      ).allow,
    ).toBe(false);
    expect(
      (
        await policy({
          toolName: 'search_web',
          args: { skill: 'dance' },
          identity,
        })
      ).allow,
    ).toBe(true);
  });
});

describe('combineSkillsPolicies', () => {
  it('denies if either underlying policy denies', async () => {
    const allow = createSkillsPolicy({
      store: new InMemorySkillsPolicyStore([
        { skillName: 'cook_dinner', dids: null },
      ]),
    });
    const deny = createSkillsPolicy({
      store: new InMemorySkillsPolicyStore([]),
    });
    const combined = combineSkillsPolicies(allow, deny);
    const decision = await combined({
      toolName: 'invoke_skill',
      args: { skill: 'cook_dinner' },
      identity,
    });
    expect(decision.allow).toBe(false);
  });

  it('allows when both policies allow', async () => {
    const a = createSkillsPolicy({
      store: new InMemorySkillsPolicyStore([
        { skillName: 'cook_dinner', dids: null },
      ]),
    });
    const b = createSkillsPolicy({
      store: new InMemorySkillsPolicyStore([
        { skillName: 'cook_dinner', dids: ['did:oas:test:alice'] },
      ]),
    });
    const combined = combineSkillsPolicies(a, b);
    const decision = await combined({
      toolName: 'invoke_skill',
      args: { skill: 'cook_dinner' },
      identity,
    });
    expect(decision.allow).toBe(true);
  });
});

describe('InMemorySkillsPolicyStore', () => {
  it('returns null for unknown skills', () => {
    const store = new InMemorySkillsPolicyStore([]);
    expect(store.lookup('missing')).toBeNull();
  });

  it('withRule returns a new store without mutating the original', () => {
    const original = new InMemorySkillsPolicyStore([]);
    const updated = original.withRule({
      skillName: 'cook_dinner',
      dids: null,
    });
    expect(original.lookup('cook_dinner')).toBeNull();
    expect(updated.lookup('cook_dinner')).not.toBeNull();
  });
});

describe('DEFAULT_SKILL_TOOL_NAMES', () => {
  it('contains the expected canonical entries', () => {
    expect(DEFAULT_SKILL_TOOL_NAMES).toContain('invoke_skill');
    expect(DEFAULT_SKILL_TOOL_NAMES).toContain('run_skill');
    expect(DEFAULT_SKILL_TOOL_NAMES).toContain('execute_skill');
  });
});
