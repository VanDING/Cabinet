# Contributing to Cabinet

Thank you for your interest in contributing to Cabinet!

## Development Setup

```bash
# Clone the repository
git clone https://github.com/VanDING/Cabinet.git
cd cabinet

# Create a virtual environment
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# .venv\Scripts\activate   # Windows

# Install with dev dependencies
pip install -e ".[dev]"
```

## Code Style

We use [Ruff](https://docs.astral.sh/ruff/) for linting and formatting:

```bash
ruff check src/ tests/        # Lint
ruff format src/ tests/       # Format
```

Configuration is in `pyproject.toml`:
- Line length: 100
- Target: Python 3.12+

## Testing

```bash
# Run all tests
pytest tests/ -v

# Run with coverage
pytest tests/ --cov=cabinet --cov-report=term-missing

# Run specific test file
pytest tests/unit/cli/test_main.py -v
```

All tests must pass before submitting a PR. The CI pipeline enforces a minimum 60% coverage threshold.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: resolve bug
docs: update documentation
chore: maintenance tasks
refactor: code restructuring
test: add or update tests
```

## Pull Request Process

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes with tests
4. Ensure all tests pass (`pytest tests/ -v`)
5. Ensure lint passes (`ruff check src/ tests/`)
6. Submit a pull request

## Project Structure

```
src/cabinet/
├── agents/          # AI agent layer
├── api/             # REST API (FastAPI)
├── cli/             # CLI (Typer)
├── core/            # Foundation (events, gateway, memory, tools, etc.)
├── models/          # Data models
├── rooms/           # Six-Room architecture
└── runtime.py       # CabinetRuntime assembly
```

## Reporting Issues

Please use [GitHub Issues](https://github.com/VanDING/Cabinet/issues) to report bugs or request features.
