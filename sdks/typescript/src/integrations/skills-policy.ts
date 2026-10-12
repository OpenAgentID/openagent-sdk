import type { InvocationContext, Receipt, SkillsPolicy as PublishedSkillsPolicy } from '@openagentid/skills-policy';
import { didSchema } from '../config.js';

/** Full policy invocation keeps arguments, rate accounting, consent, session
 * and hash-chained receipts together. It is deliberately not a boolean-only
 * SkillsPolicy cast, which would drop security-relevant context. */
export function createSkillsPolicyInvoker(options: {
  policy: PublishedSkillsPolicy;
  agentDid: string;
  context(input: { skill: string; arguments: unknown }): InvocationContext;
}): { invoke<T>(skill: string, args: unknown, run: () => T | Promise<T>): Promise<{ result: T; receipt: Receipt }> } {
  didSchema.parse(options.agentDid);
  if (options.policy.agent().toString() !== options.agentDid) throw new Error('Skills policy belongs to another agent');
  return {
    async invoke(skill, args, run) {
      const context = options.context({ skill, arguments: args });
      if (context.agentDid.toString() !== options.agentDid || !context.sessionId || context.arguments !== args) {
        throw new Error('Skills invocation context does not match this agent, session or arguments');
      }
      const receipt = options.policy.recordInvocation(skill, context);
      return { result: await run(), receipt };
    },
  };
}
