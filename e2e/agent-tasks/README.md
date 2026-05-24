# Agent Tasks

This directory contains tool-neutral tasks for Codex App, Browser Use, Chrome
DevTools MCP, and humans.

Rules:

- Scenario semantics live in repository definitions and the page bridge.
- Agents should call bridge actions before falling back to DOM interaction.
- Oracles are deterministic and evidence-driven.
- Failure reports must identify missing evidence instead of guessing.

Current task pack:

- `p0-smoke.ai-task.md`
- `failure-report.prompt.md`
