---
description: Shared agent assignment and workflow design principles for Workflow Designer and Organize
globs: []
alwaysApply: false
tags: [workflow, design, agents]
---

# Workflow Design Principles

## Agent Assignment
- Same agent for consecutive steps that share domain knowledge and skills → shared context segment (efficient, fewer tokens)
- MUST separate: execution agent ≠ approval agent (L2/L3 decisions go to Captain or designated approver)
- Split when: steps can run in parallel or need different core competencies
- Default agent: "secretary" if no specialized agent fits
- Every aiAgent step MUST have an agent field

## Workflow Structure
- Keep workflows to 4-8 steps. Split larger processes into sub-workflows
- Use condition steps for quality gates and decision points
- Add humanApproval before destructive or high-cost actions
- Use the fast model for routine steps, reasoning model for complex analysis
- Check for similar workflows before creating duplicates

## Model Selection
- Default model for new agents: fast model for routine tasks, reasoning model for complex analysis
- Different agent only when: different model needed, different expertise domain, or service boundary
