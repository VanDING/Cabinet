# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-05-05

### Added
- Six-Room architecture (Meeting, Strategy, Decision, Office, Summary, Secretary)
- Event sourcing with SQLite persistence and recovery
- LLM Gateway with LiteLLM integration (multi-provider support)
- KeyVault encrypted API key storage (Fernet + PBKDF2)
- Audit logging with OpenTelemetry trace correlation
- REST API with FastAPI (chat, employees, skills, knowledge, rooms, config, health)
- CLI with Typer (init, serve, chat, status, set-api-key, config, employee, skill, knowledge)
- WebSocket streaming chat
- ChromaDB vector memory and knowledge base
- SQLite memory store alternative
- MCP (Model Context Protocol) tool integration
- OpenTelemetry distributed tracing
- Prometheus metrics (11 custom metrics)
- Health check endpoints (/health liveness, /ready readiness)
- Rate limiting with SlowAPI
- Input validation with Pydantic Field constraints
- XSS sanitization utility
- Docker deployment with health checks and resource limits
- CI/CD pipeline (lint, type-check, test, security scan, docker-build)
- Interactive tutorial and E2E workflow demo
- Cross-platform API examples (bash, PowerShell, Python)
- Bilingual documentation (English + Chinese)
