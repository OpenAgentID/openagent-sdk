/**
 * SKILLS.md integration test.
 *
 * The Claude Agent SDK loads skills from SKILLS.md files. We don't parse
 * the file ourselves — that's the SDK's job — but we DO assert that the
 * onSkillInvoke hook is the choke point and is honoured before any
 * skill code runs.
 */

import { describe, expect, it } from 'vitest';
import { openAgentPlugin } from '../src/plugin.js';
import { SkillDeniedError } from '../src/errors.js';
import { checker, makeIdentity } from './fixtures.js';

/** Simulate the SDK loading SKILLS.md and dispatching to a skill. */
async function loadAndInvokeSkill(
  plugin: ReturnType<typeof openAgentPlugin>,
  skillName: string,
  skillImpl: () => Promise<string>,
): Promise<string> {
  // Pretend we just parsed a SKILLS.md entry and are about to invoke it.
  const decision = await plugin.hooks.onSkillInvoke({
    skillName,
    metadata: { source: 'SKILLS.md' },
  });
  if (!decision.allow) {
    throw new SkillDeniedError(skillName, decision.reason);
  }
  // Only now does the SDK execute the skill body.
  return skillImpl();
}

describe('SKILLS.md integration', () => {
  it('blocks unscoped skills before the body runs', async () => {
    const plugin = openAgentPlugin({
      agent: makeIdentity(),
      capabilities: checker([]),
      audit: true,
      denyMode: 'block',
    });
    await plugin.hooks.onSessionStart({ sessionId: 'sess' });

    let bodyRan = false;
    await expect(
      loadAndInvokeSkill(plugin, 'web.search', async () => {
        bodyRan = true;
        return 'should-not-happen';
      }),
    ).rejects.toThrow(SkillDeniedError);
    expect(bodyRan).toBe(false);
  });

  it('allows scoped skills and lets the body run', async () => {
    const plugin = openAgentPlugin({
      agent: makeIdentity(),
      capabilities: checker(['skills:invoke:web.search']),
      audit: true,
      denyMode: 'block',
    });
    await plugin.hooks.onSessionStart({ sessionId: 'sess' });

    const result = await loadAndInvokeSkill(
      plugin,
      'web.search',
      async () => 'results',
    );
    expect(result).toBe('results');

    const records = plugin.inspectAudit();
    const skillRec = records.find((r) => r.kind === 'skill.preflight');
    expect(skillRec).toBeDefined();
    expect(skillRec?.outcome).toBe('allow');
    expect(skillRec?.context?.requiredScope).toBe('skills:invoke:web.search');
  });
});
