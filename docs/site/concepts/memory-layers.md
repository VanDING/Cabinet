# Memory Layers

Cabinet implements a 4-layer memory architecture:

## Layer 1: Short-Term Memory

- **Scope**: Current session
- **Content**: Recent messages, in-progress decisions, active context
- **Lifetime**: Session duration
- **Use**: Immediate conversation context

## Layer 2: Long-Term Memory

- **Scope**: Cross-session
- **Content**: Consolidated summaries, learned preferences, important decisions
- **Lifetime**: Persistent (SQLite-backed)
- **Use**: Context retrieval across sessions

## Layer 3: Entity Memory

- **Scope**: Per-entity (Captain, project, agent)
- **Content**: Preferences, expertise profiles, behavioral patterns
- **Lifetime**: Persistent
- **Use**: Personalized responses and adaptive behavior

## Layer 4: Project Memory

- **Scope**: Per-project
- **Content**: Project goals, key decisions, deliverables, meeting summaries
- **Lifetime**: Project duration
- **Use**: Project context isolation

## Consolidation

The **Curator** agent periodically runs consolidation:
1. Identifies important information from short-term memory
2. Summarizes and stores in long-term memory
3. Links related memories across layers
4. Prunes stale or redundant entries

## Project Isolation

Each project has strict memory isolation. Switching projects switches the full memory context — agents cannot accidentally leak information across project boundaries.
