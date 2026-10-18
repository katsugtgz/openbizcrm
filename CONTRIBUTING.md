# Contributing to OpenBizCRM

Thanks for your interest in contributing. This document covers setup and the
expectations for pull requests.

## Setup

```sh
bun install
cp .env.example .env
bun run db:push
bun run dev
```

Requirements: Node 22 and Bun 1.4+. Bun is used as the package manager only —
run the Next.js dev server under Node as usual (`bun run dev` invokes Next via
package.json scripts; do not run Next itself under the Bun runtime).

## Commit style

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(hrm): add GPS attendance check-in
fix(payroll): round BPJS employee share correctly
docs: expand roadmap
chore(deps): bump drizzle-orm
```

Scope names follow the module touched: `hrm`, `crm`, `projects`, `finance`,
`collab`, `platform`, `db`, `ui`, `deps`, `docs`.

## Pull request checklist

- [ ] `bun run lint` passes
- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes (add or update tests for changed behavior)
- [ ] Schema changes ship with a Drizzle migration (`bun run db:generate`)
- [ ] New environment variables are documented in `.env.example`
- [ ] Conventional commit message(s) applied

## Scope expectations

- Keep pull requests focused: one feature or one fix per PR.
- Match existing patterns: `src/` layout, `@/*` imports, shadcn/ui components
  in `src/components/ui`, Drizzle schema in `src/db`.
- App UI text is in Indonesian; code, identifiers, and repo docs are in English.
- No copied code from proprietary products (including Kolabo). Original
  implementations only.
- For larger features, open an issue or discussion first to align on scope.

## License

By contributing, you agree that your contributions are licensed under the
MIT License.
