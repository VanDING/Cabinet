export interface GreetingData {
  captainName: string;
  pendingDecisions: number;
  activeWorkflows: number;
  todayCost: number;
  lastSessionSummary?: string;
}

export interface GreetingResult {
  greeting: string;
  suggestions: string[];
  stats: {
    pendingDecisions: number;
    activeWorkflows: number;
    todayCost: number;
  };
}

export class GreetingService {
  generate(data: GreetingData): GreetingResult {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
    const greeting = this.buildGreeting(timeOfDay, data);
    const suggestions = this.buildSuggestions(data);

    return {
      greeting,
      suggestions,
      stats: {
        pendingDecisions: data.pendingDecisions,
        activeWorkflows: data.activeWorkflows,
        todayCost: data.todayCost,
      },
    };
  }

  generateGreeting(captainName: string, pendingDecisions: number, todayCost: number): string {
    // Backward-compatible: returns plain text greeting
    return this.generate({
      captainName,
      pendingDecisions,
      todayCost,
      activeWorkflows: 0,
    }).greeting;
  }

  private buildGreeting(timeOfDay: string, data: GreetingData): string {
    const parts: string[] = [`Good ${timeOfDay}, ${data.captainName}.`];

    const alerts: string[] = [];
    if (data.pendingDecisions > 0) {
      alerts.push(`${data.pendingDecisions} decision(s) await your review`);
    }
    if (data.activeWorkflows > 0) {
      alerts.push(`${data.activeWorkflows} workflow(s) are running`);
    }
    if (alerts.length > 0) {
      parts.push(alerts.join(' and ') + '.');
    } else {
      parts.push('Everything is quiet.');
    }

    parts.push(`Today's LLM cost: $${data.todayCost.toFixed(2)}.`);
    if (data.lastSessionSummary) {
      parts.push(`Last session: ${data.lastSessionSummary}`);
    }
    return parts.join(' ');
  }

  private buildSuggestions(data: GreetingData): string[] {
    const suggestions: string[] = [];
    if (data.pendingDecisions > 0) {
      suggestions.push('Review pending decisions');
    }
    if (data.activeWorkflows > 0) {
      suggestions.push('Check workflow status');
    }
    suggestions.push('Start a new discussion');
    if (data.lastSessionSummary) {
      suggestions.push('Continue where we left off');
    }
    return suggestions;
  }
}
