/**
 * Agent Spawner - Coordinates spawning all 5 team agents via Claude Code Task tool
 *
 * This module provides utilities for spawning the lean agentic coding team
 * using Claude Code's Task tool in parallel.
 */

const TEAM_AGENTS = {
  'agentic-architect': {
    type: 'system-architect',
    purpose: 'Define autonomous-coding vision and safety guardrails',
    promptFile: '../prompts/agentic-architect.md'
  },
  'prompt-engineer': {
    type: 'researcher',
    purpose: 'Craft and iterate prompt templates for code generation',
    promptFile: '../prompts/prompt-engineer.md'
  },
  'tool-integrator': {
    type: 'cicd-engineer',
    purpose: 'Connect agents to CI/CD and deployment pipelines',
    promptFile: '../prompts/tool-integrator.md'
  },
  'qa-bot-designer': {
    type: 'tester',
    purpose: 'Design test-generation agents and verification loops',
    promptFile: '../prompts/qa-bot-designer.md'
  },
  'operations-coach': {
    type: 'perf-analyzer',
    purpose: 'Monitor resources, costs, and enforce lean flow',
    promptFile: '../prompts/operations-coach.md'
  }
};

/**
 * Generates Task tool invocations for all team agents
 * @param {string} task - The task to assign to the team
 * @returns {Array} Array of Task configurations
 */
function generateTeamTasks(task) {
  return Object.entries(TEAM_AGENTS).map(([id, config]) => ({
    description: `${id} working on: ${task}`,
    prompt: `
You are the ${id} agent. ${config.purpose}

TASK: ${task}

Follow your role-specific prompt guidelines.
Coordinate with other team members via memory and hooks.

Run hooks before starting:
- npx claude-flow@alpha hooks pre-task --description "${task}"

Run hooks after completing:
- npx claude-flow@alpha hooks post-task --task-id "${id}-${Date.now()}"
    `.trim(),
    subagent_type: config.type
  }));
}

/**
 * Example usage for spawning the full team on a feature
 */
const EXAMPLE_FEATURE_TASK = `
Implement disc drive auto-detection for EasyRip:
1. Agentic Architect: Design the auto-detection architecture
2. Prompt Engineer: Create prompts for generating detection code
3. Tool-Integrator: Connect to MakeMKV CLI for drive enumeration
4. QA Bot-Designer: Create tests for drive detection edge cases
5. Operations Coach: Monitor the implementation metrics
`;

module.exports = {
  TEAM_AGENTS,
  generateTeamTasks,
  EXAMPLE_FEATURE_TASK
};
