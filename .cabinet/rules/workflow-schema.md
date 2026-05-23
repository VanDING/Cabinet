---
description: Complete WorkflowDefinition JSON schema reference for Workflow Designer and Organize agents
globs: []
alwaysApply: false
tags: [workflow, schema, reference]
---

# WorkflowDefinition JSON Schema

A Cabinet Workflow is a declarative JSON document: `{ "name": "...", "steps": [...], "capabilities": {...} }`.

## Step Fields
- `id`: unique step identifier (e.g., "analyze", "review", "approve")
- `type`: aiAgent | humanApproval | condition | parallel | notification | wait | llmCall
- `title`: short human-readable label
- `description`: what this step does (optional)
- `prompt`: detailed instruction for the agent (supports {{template}} variables)
- `agent`: registered Agent role name — REQUIRED for aiAgent steps
- `template`: optional object with template variable definitions

## Step Connection
- `input.from`: "trigger" (entry point) or another step's id
- If `input.from` is omitted, steps connect sequentially in array order
- Consecutive steps with the same agent share context as a "segment"

## Constraints
- `constraints.model`: model override for this step
- `constraints.temperature`: 0.0-1.0
- `constraints.maxTokens`: response token limit
- `constraints.maxRetries`: retry count on failure
- `constraints.persistent`: keep agent alive across workflow runs

## Condition Steps
- `condition.expression`: Cabinet expression language
- `condition.trueBranch` / `condition.falseBranch`: step ids

Expression syntax:
- Template refs: `{{steps.<stepId>.output}}` or `{{steps.<stepId>.output.path.to.field}}` or `{{results.<key>}}`
- Operators: `> < >= <= == != contains`
- Logic: `AND OR NOT` (parentheses for grouping)
- Example: `"{{steps.analyze.output.score}} > 0.7"`
- Example: `"{{steps.review.output.pass}} == true AND {{steps.analyze.output.score}} >= 0.6"`

## Human Approval Steps
- `approvalOptions.retryTarget`: step id to retry on rejection
- `approvalOptions.actions`: [continue, retry, halt]

## Parallel Steps
- `parallel.children`: array of step ids
- `parallel.aggregation`: "all" (default) | "first" | "merge"

## Capabilities (Tool Permissions)
Declare what the workflow needs:
- `capabilities.files.read` / `capabilities.files.write`
- `capabilities.web.fetch` / `capabilities.web.http`
- `capabilities.shell`
- `capabilities.knowledge.search`
- `capabilities.evaluation`

Only declare capabilities the workflow genuinely needs. Captain must approve elevated capabilities.
