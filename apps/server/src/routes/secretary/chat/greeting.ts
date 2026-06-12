import { GreetingService } from '@cabinet/secretary';
import type { ServerContext } from '../../../context.js';
import { broadcast } from '../../../ws/handler.js';

export async function sendGreetingForNewSession(
  ctx: ServerContext,
  sessionId: string,
  captainId: string,
  projectId: string,
): Promise<void> {
  try {
    const greeter = new GreetingService();
    const pendingDecisions = ctx.db
      .prepare("SELECT COUNT(*) as count FROM decisions WHERE status = 'pending'")
      .get() as { count: number } | undefined;
    const activeWorkflows = ctx.db
      .prepare(
        "SELECT COUNT(*) as count FROM workflows WHERE status = 'active' OR status = 'running'",
      )
      .get() as { count: number } | undefined;
    const prefs = ctx.entity.getPreferences(captainId);
    const captainName = prefs?.name ?? 'Captain';
    const greeting = greeter.generate({
      captainName,
      pendingDecisions: pendingDecisions?.count ?? 0,
      activeWorkflows: activeWorkflows?.count ?? 0,
      todayCost: ctx.costTracker?.getDailyCost() ?? 0,
    });
    // Persist greeting as chat message so it appears in the dialog
    let greetingText = greeting.greeting;
    if (greeting.suggestions && greeting.suggestions.length > 0) {
      greetingText +=
        '\n\n**Suggestions:**\n' + greeting.suggestions.map((s: string) => `- ${s}`).join('\n');
    }
    // Inject Curator session brief if available
    try {
      const brief = ctx.shortTerm.get(sessionId, 'session_brief');
      if (brief && typeof brief === 'string' && brief.length > 0) {
        greetingText += `\n\n**Context Brief:**\n${brief}`;
      }
    } catch {
      /* brief lookup failure is non-fatal */
    }
    ctx.sessionManager.addMessage(sessionId, 'assistant', greetingText);
    broadcast('secretary_greeting', { sessionId, greeting });
  } catch {
    // Greeting failure is non-fatal
  }
}
