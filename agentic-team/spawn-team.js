#!/usr/bin/env node
/**
 * Spawn Team - Launch all 5 agentic coding team members in parallel
 *
 * This script provides the command to spawn all team agents using
 * Claude Code's Task tool in a single parallel execution.
 *
 * Usage: node spawn-team.js "<task-description>"
 */

const fs = require('fs');
const path = require('path');

const AGENTS_DIR = path.join(__dirname, 'agents');

// Load all agent configurations
function loadAgents() {
  const agentFiles = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.json'));
  return agentFiles.map(file => {
    const content = fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8');
    return JSON.parse(content);
  });
}

// Generate Claude Code Task tool invocations
function generateTaskInvocations(task, agents) {
  return agents.map(agent => ({
    tool: 'Task',
    params: {
      description: `${agent.agent.name}: ${task.slice(0, 50)}...`,
      prompt: generateAgentPrompt(agent, task),
      subagent_type: agent.claudeCode.subagentType,
      model: agent.claudeCode.model
    }
  }));
}

function generateAgentPrompt(agent, task) {
  return `
# ${agent.agent.name} - Agentic Coding Team

## Your Role
${agent.purpose}

## Task
${task}

## Responsibilities
${agent.responsibilities.map(r => `- ${r}`).join('\n')}

## Coordination
- Upstream dependencies: ${agent.coordination.upstream.join(', ') || 'None'}
- Downstream dependents: ${agent.coordination.downstream.join(', ') || 'None'}
- Parallel collaborators: ${agent.coordination.parallel.join(', ') || 'None'}

## Hooks to Execute

### Before Starting
\`\`\`bash
${agent.hooks.preTask}
\`\`\`

### After Each File Edit
\`\`\`bash
${agent.hooks.postEdit}
\`\`\`

### After Completing
\`\`\`bash
${agent.hooks.postTask}
\`\`\`

## Metrics to Track
${agent.metrics.track.map(m => `- ${m}`).join('\n')}

## Instructions
1. Execute your pre-task hook
2. Complete your assigned responsibilities for the task
3. Coordinate with other team members via memory
4. Execute your post-task hook
5. Report your metrics and findings

Remember: You are part of a lean agentic team. Focus on delivering value with minimal waste.
`.trim();
}

// Main execution
const task = process.argv[2];

if (!task) {
  console.log(`
Usage: node spawn-team.js "<task-description>"

This will generate Claude Code Task tool invocations to spawn all 5 team agents:
  - Agentic Architect
  - Prompt Engineer
  - Tool-Integrator
  - QA Bot-Designer
  - Operations Coach

Example:
  node spawn-team.js "Implement disc auto-detection for EasyRip"
  `);
  process.exit(0);
}

const agents = loadAgents();
const invocations = generateTaskInvocations(task, agents);

console.log(`
============================================================
AGENTIC CODING TEAM - PARALLEL SPAWN COMMAND
============================================================

Task: ${task}

To spawn all 5 agents in parallel, use these Task tool invocations
in a SINGLE Claude Code message:

${invocations.map(inv => `
Task(
  description: "${inv.params.description}",
  subagent_type: "${inv.params.subagent_type}",
  model: "${inv.params.model}",
  prompt: "<see agent prompt below>"
)
`).join('')}

============================================================
AGENT PROMPTS (copy for each Task invocation)
============================================================
${agents.map(agent => `
--- ${agent.agent.name.toUpperCase()} ---
${generateAgentPrompt(agent, task)}
`).join('\n')}
`);

module.exports = { loadAgents, generateTaskInvocations };
