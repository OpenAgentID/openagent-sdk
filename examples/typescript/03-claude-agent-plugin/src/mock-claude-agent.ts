// Minimal mock of the Claude Agent SDK shape so this example runs without an API key.
// The real SDK has the same plugin surface — swap the import and it works.

import type { Agent as OpenAgentAgent } from '@openagentid/sdk';

export interface ToolMetadata {
  openagent?: {
    scopes?: string[];
    skill?: string;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  metadata?: ToolMetadata;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolContext {
  openagent: OpenAgentAgent;
}

export interface Plugin {
  name: string;
  onToolCall?: (tool: ToolDefinition, args: Record<string, unknown>) => Promise<void>;
}

export interface AgentEventMap {
  'openagent:decision': { tool: string; allowed: boolean; reason?: string };
  'openagent:needs-approval': { skill: string; args: unknown; reason: string };
}

export class ClaudeAgent {
  private tools: ToolDefinition[] = [];
  private plugins: Plugin[] = [];
  private openagent!: OpenAgentAgent;
  private listeners: Map<string, Array<(evt: unknown) => void>> = new Map();

  constructor(private config: { model: string; plugins?: Plugin[] }) {
    this.plugins = config.plugins ?? [];
  }

  defineTool(tool: ToolDefinition) {
    this.tools.push(tool);
  }

  setOpenAgent(agent: OpenAgentAgent) {
    this.openagent = agent;
  }

  on<K extends keyof AgentEventMap>(event: K, handler: (evt: AgentEventMap[K]) => void) {
    const arr = this.listeners.get(event) ?? [];
    arr.push(handler as (evt: unknown) => void);
    this.listeners.set(event, arr);
  }

  private emit<K extends keyof AgentEventMap>(event: K, payload: AgentEventMap[K]) {
    const arr = this.listeners.get(event) ?? [];
    for (const h of arr) h(payload);
  }

  async run(prompt: string): Promise<void> {
    console.log(`[mock-claude-agent] prompt: ${prompt}`);

    // Simulate the model deciding to call each tool in turn.
    for (const tool of this.tools) {
      console.log(`\n[mock-claude-agent] attempting tool: ${tool.name}`);

      const required = tool.metadata?.openagent?.scopes ?? [];
      const hasAll = required.every((s) => this.openagent.hasScope(s));

      if (!hasAll) {
        const missing = required.filter((s) => !this.openagent.hasScope(s));
        this.emit('openagent:decision', { tool: tool.name, allowed: false, reason: `missing scopes: ${missing.join(', ')}` });
        console.log(`[mock-claude-agent] denied: missing scopes: ${missing.join(', ')}`);
        continue;
      }

      const skill = tool.metadata?.openagent?.skill;
      if (skill) {
        const decision = this.openagent.skillsPolicy().canInvoke(skill);
        if (!decision.allowed) {
          this.emit('openagent:decision', { tool: tool.name, allowed: false, reason: decision.reason ?? 'skill policy denied' });
          console.log(`[mock-claude-agent] denied by skills policy: ${decision.reason}`);
          continue;
        }
      }

      this.emit('openagent:decision', { tool: tool.name, allowed: true });
      console.log(`[mock-claude-agent] allowed, calling handler`);

      const result = await tool.handler({}, { openagent: this.openagent });
      console.log(`[mock-claude-agent] tool result:`, result);
    }
  }
}

export function openagentPlugin(_opts: { agentDid?: string; skillsPolicyPath?: string }): Plugin {
  return {
    name: 'openagent',
  };
}
