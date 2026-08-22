# Contributing

Thanks for wanting to help! We welcome bug fixes, new features, docs, and ideas.

## Table of Contents

- [How to Contribute](#how-to-contribute)
- [Branch Names](#branch-names)
- [Commits](#commits)
- [PR Checklist](#pr-checklist)
- [Running Tests](#running-tests)

## How to Contribute

1. **Fork** the repo and clone your copy
2. **Add upstream**: `git remote add upstream https://github.com/drosemann/infra-pilot.git`
3. **Create a branch** from `main` (see naming below)
4. **Make your changes** and make sure tests pass
5. **Push** and open a Pull Request to `main`

## Branch Names

Use a prefix and a short description with dashes.

Examples: `feat/add-login`, `fix/bug-123`, `docs/readme-update`

Prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/`, `perf/`, `style/`

## Commits

Write clear commit messages. Use this format:

```
<type>(<scope>): <short description>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `style`

Keep the summary under 72 characters.

## PR Checklist

Before submitting, check these off:

- [ ] Branch name follows the naming rule
- [ ] Commit messages are clear
- [ ] Tests pass and coverage didn't drop
- [ ] No new warnings or errors
- [ ] Updated docs if needed
- [ ] No secrets or passwords in code

## Running Tests

```bash
pytest tests/
cd services/management-panel && npm test
cd services/orchestrator-agent && pytest
```
