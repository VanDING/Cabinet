# Agent System

## TAOR Loop

Every agent runs the **Think → Act → Observe → React** loop:

1. **Think**: Build context from memory and current state
2. **Act**: Execute tools or generate responses
3. **Observe**: Record results and update memory
4. **React**: Loop back or hand off to next agent

## Built-in Roles

| Role                  | Responsibility                                                    |
| --------------------- | ----------------------------------------------------------------- |
| **Secretary**         | Entry point — parses intent, routes to specialist agents          |
| **Decision Analyst**  | Structures options, classifies decisions L0-L3, provides analysis |
| **Meeting Chair**     | Orchestrates multi-agent debates, synthesizes perspectives        |
| **Workflow Designer** | Designs automation pipelines from conversation                    |
| **Curator**           | Consolidates memory, surfaces relevant context                    |
| **Agent Creator**     | Creates custom agents from user descriptions                      |

## Custom Agents

Custom agents are defined via the `/api/agents` endpoint or the Employees page in the desktop app. Each agent specifies:

- **System prompt** — the agent's persona and instructions
- **Model** — which LLM to use
- **Allowed tools** — which tools the agent can invoke
- **Context budget** — maximum context window usage

## Agent-to-Agent Communication

Agents communicate through structured handoff documents. The handoff includes:

- What was done
- Key findings
- Open questions
- Recommended next agent

This enables chaining: Secretary → Decision Analyst → Meeting Chair → Captain review.
