import type { ServerContext } from '../../../context.js';
import type { ChatBody } from './schemas.js';
import type { AgentLoop } from '@cabinet/agent';

export interface SkillInvokeContext {
  skillName: string;
  args: string;
}

export interface SkillResolution {
  context: SkillInvokeContext | null;
  notFoundSkillName?: string;
}

export async function resolveSkillInvocation(
  ctx: ServerContext,
  parsed: { data: ChatBody },
  agentLoop: AgentLoop | null,
  message: string,
  augmentedMessage: string,
): Promise<SkillResolution> {
  // Direct skill invocation: if message starts with /skillName, load and inject skill prompt
  if (parsed.data.type === 'skill_invoke' && parsed.data.skillName) {
    const skillName = parsed.data.skillName;
    const skillArgs = parsed.data.skillArgs ?? '';
    const skill = ctx.skillRegistry.load(skillName);
    if (skill) {
      const skillResult = await ctx.skillRegistry.executeSkill(skill, { arguments: skillArgs });
      agentLoop?.setSkillContext(skillResult.output);
      return { context: { skillName, args: skillArgs } };
    }
    return { context: null, notFoundSkillName: skillName };
  }

  const skillMatch = augmentedMessage.trim().match(/^\/(\S+)/);
  if (skillMatch) {
    const skillName = skillMatch[1];
    const skillArgs = augmentedMessage.slice(skillMatch[0].length).trim();
    if (skillName) {
      const skill = ctx.skillRegistry.load(skillName);
      if (skill) {
        const skillResult = await ctx.skillRegistry.executeSkill(skill, {
          arguments: skillArgs,
        });
        agentLoop?.setSkillContext(skillResult.output);
        return { context: { skillName, args: skillArgs } };
      }
      return { context: null, notFoundSkillName: skillName };
    }
  }

  return { context: null };
}
