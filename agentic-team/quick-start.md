# Agentic Coding Team - Quick Start Guide

## Team Structure (5 Agents)

| Role | Type | Purpose |
|------|------|---------|
| **Agentic Architect** | system-architect | Defines autonomous-coding vision and safety guardrails |
| **Prompt Engineer** | researcher | Crafts and iterates prompt templates |
| **Tool-Integrator** | cicd-engineer | Connects agents to CI/CD and pipelines |
| **QA Bot-Designer** | tester | Designs test-generation and verification loops |
| **Operations Coach** | perf-analyzer | Monitors resources, costs, enforces lean flow |

## Quick Setup Checklist

1. **MCP Servers Configured**
   - [x] claude-flow (required) - `claude mcp add claude-flow -- npx claude-flow@alpha mcp start`

2. **Folder Structure Created**
   - [x] `/agentic-team/prompts` - Prompt templates
   - [x] `/agentic-team/adapters` - Tool adapters and MCP config
   - [x] `/agentic-team/tests` - Team validation tests
   - [x] `/agentic-team/ops` - Metrics and operations config
   - [x] `/agentic-team/agents` - Agent definitions
   - [x] `/agentic-team/workflows` - Kanban and workflow configs

## Spawning the Team

### Option 1: Use Claude Code's Task Tool (Recommended)

In a SINGLE message, spawn all 5 agents in parallel:

```javascript
// All agents spawn in parallel in ONE message
Task("Agentic Architect", "<task>", "system-architect")
Task("Prompt Engineer", "<task>", "researcher")
Task("Tool-Integrator", "<task>", "cicd-engineer")
Task("QA Bot-Designer", "<task>", "tester")
Task("Operations Coach", "<task>", "perf-analyzer")
```

### Option 2: Use the Spawn Script

```bash
node agentic-team/spawn-team.js "Your task description here"
```

## Kanban Workflow

```
| Ready | In-Prompt-Design | In-Integration | In-QA | Done |
|-------|------------------|----------------|-------|------|
| WIP:5 | WIP:2            | WIP:2          | WIP:2 | ∞    |
```

## Lean KPIs (Targets)

| Metric | Target |
|--------|--------|
| Cycle Time | ≤ 2 days |
| Defect Escape Rate | ≤ 5% |
| Token Cost/Story | ≤ $0.10 |
| Team WIP | ≤ 3 stories |

## First Sprint: Hello-World Validation

Test the pipeline with the hello-world prompt:

1. Prompt Engineer creates prompt from `prompts/hello-world.md`
2. Tool-Integrator executes via agent
3. QA Bot-Designer generates and runs tests
4. Operations Coach records metrics

## Agent Coordination Hooks

Every agent runs these hooks:

```bash
# Before work
npx claude-flow@alpha hooks pre-task --description "[task]"

# After file edits
npx claude-flow@alpha hooks post-edit --file "[file]" --memory-key "swarm/[agent]/[step]"

# After completing
npx claude-flow@alpha hooks post-task --task-id "[agent]-[timestamp]"
```

## Ceremonies

| Ceremony | Frequency | Duration |
|----------|-----------|----------|
| Backlog Grooming | Weekly | 30 min |
| Pair-Coding with Agents | Daily | 1 hour |
| Retrospective | Biweekly | 45 min |
