export class TeachBack {
  verify(originalTask: string, aiRestatement: string): boolean {
    const keywords = originalTask
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    const matchCount = keywords.filter((kw) => aiRestatement.toLowerCase().includes(kw)).length;
    return matchCount >= keywords.length * 0.5;
  }

  generatePrompt(task: string): string {
    return `Before executing this high-risk operation, please restate what you understand:\n\n"${task}"\n\nReply with: "I understand that I should: [your restatement]"`;
  }
}
