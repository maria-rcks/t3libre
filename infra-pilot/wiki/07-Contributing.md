# Contributing

## Development Setup

```bash
git clone https://github.com/drosemann/infra-pilot.git
cd infra-pilot
pip install -r requirements.txt
cd services/management-panel && npm install && cd ../..
cd services/discord-service && npm install && cd ../..
```

## Running Tests

```bash
pytest tests/
cd services/management-panel && npm test
```

### Test Markers

`unit` · `integration` · `e2e` · `smoke`

## Branch Naming

Use a prefix: `feat/`, `fix/`, `docs/`, `refactor/`, `test/`, `chore/` plus a short name.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): description`

## Pull Request Workflow

1. Create a new branch from `main`
2. Commit and push
3. Open a pull request against `main`
4. CI runs tests, lint, and security checks
5. Merge after review and all checks pass

---

*See [CONTRIBUTING.md](https://github.com/drosemann/infra-pilot/blob/main/CONTRIBUTING.md) for full details.*
