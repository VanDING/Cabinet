export class GreetingService {
  generateGreeting(captainName: string, pendingDecisions: number, todayCost: number): string {
    const timeOfDay = new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 18 ? 'Afternoon' : 'Evening';
    const parts: string[] = [`Good ${timeOfDay}, ${captainName}.`];
    if (pendingDecisions > 0) parts.push(`You have ${pendingDecisions} pending decision(s).`);
    parts.push(`Today's LLM cost: $${todayCost.toFixed(2)}.`);
    return parts.join(' ');
  }
}
