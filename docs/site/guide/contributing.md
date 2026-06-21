# Contributing

Thank you for considering contributing to Cabinet. This project is built around a specific philosophy: **the Captain decides, the Cabinet executes**. We apply the same principle to contributions — clear ownership, minimal process, maximum autonomy within boundaries.

## Development Workflow

1. **Fork and branch** from `main`
2. **Write tests first** for any new behavior
3. **Implement** to make tests pass
4. **Run the full suite** — `pnpm test` and `pnpm typecheck`
5. **Open a PR** with a clear description of the problem and solution

## Code Standards

### TypeScript

- Target TypeScript 5.x with strict mode enabled
- No `any` types at API boundaries
- Prefer `interface` over `type` for object shapes
- Use explicit return types on public functions

### Testing

- Unit tests live next to source files: `*.test.ts`
- Integration tests live in `apps/server/src/__tests__/`
- Every bug fix must include a regression test
- Aim for >85% line coverage on new code

### Commit Messages

Use conventional commits for changelog generation:

```
feat(secretary): add intent routing for organize agent
fix(agent): correct retry backoff calculation
docs(api): update workflow endpoint descriptions
test(decision): add state machine boundary tests
```

### Pull Request Template

```markdown
## What

One-line summary of the change.

## Why

The problem being solved or the capability being added.

## How

Brief description of the approach. Mention any trade-offs.

## Verification

- [ ] Tests pass (`pnpm test`)
- [ ] Type checks pass (`pnpm typecheck`)
- [ ] E2E tests pass if UI changed (`pnpm test:e2e`)
- [ ] Manually tested the feature in desktop app
```

## Module Ownership

| Module               | Owner             | Description                                      |
| :------------------- | :---------------- | :----------------------------------------------- |
| `@cabinet/types`     | Core team         | Stability-critical; changes require broad review |
| `@cabinet/agent`     | Core team         | Safety and loop logic; high scrutiny             |
| `@cabinet/gateway`   | Core team         | Cost and routing; affects all LLM calls          |
| `@cabinet/workflow`  | Community welcome | Node types, blueprint validation                 |
| `@cabinet/ui`        | Community welcome | Components, themes, animations                   |
| `@cabinet/secretary` | Community welcome | Prompts, greeting logic                          |
| `@cabinet/memory`    | Community welcome | Retrieval, consolidation, decay                  |
| `apps/desktop`       | Community welcome | Pages, hooks, utilities                          |

Changes to **Core team** modules need approval from at least one maintainer. **Community welcome** modules can be merged after CI passes and one review.

## Adding a New Skill

Skills are atomic capability units defined in `SKILL.md` format. To add a built-in skill:

1. Define the skill in `packages/agent/src/skills/` or as a standalone `.md` file
2. Register it in `packages/agent/src/built-in-skills.ts`
3. Add tests in `packages/agent/src/__tests__/`
4. Document it in the API docs under `docs/site/api/`

## Reporting Issues

When reporting bugs, include:

- Cabinet version (from Settings > About)
- Desktop or server-only?
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Relevant logs from `~/.cabinet/logs/`

## Security Reports

For security vulnerabilities, do **not** open a public issue. Email security reports to the maintainers directly or use GitHub private vulnerability reporting.

## Code of Conduct

- Be direct and kind
- Assume good intent
- Disagree with ideas, not people
- Prefer writing code over writing process

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
