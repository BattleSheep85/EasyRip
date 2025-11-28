/**
 * Team Validation Tests
 *
 * These tests verify that the agentic coding team infrastructure
 * is properly configured and ready for operation.
 */

const fs = require('fs');
const path = require('path');

const AGENTIC_TEAM_DIR = path.join(__dirname, '..');

describe('Agentic Team Infrastructure', () => {

  describe('Folder Structure', () => {
    const requiredFolders = ['prompts', 'adapters', 'tests', 'ops', 'agents', 'workflows'];

    requiredFolders.forEach(folder => {
      test(`should have ${folder} directory`, () => {
        const folderPath = path.join(AGENTIC_TEAM_DIR, folder);
        expect(fs.existsSync(folderPath)).toBe(true);
      });
    });
  });

  describe('Team Configuration', () => {
    let teamConfig;

    beforeAll(() => {
      const configPath = path.join(AGENTIC_TEAM_DIR, 'team-config.json');
      teamConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    });

    test('should have 5 agents configured', () => {
      expect(teamConfig.agents).toHaveLength(5);
    });

    test('should have all required agent roles', () => {
      const agentIds = teamConfig.agents.map(a => a.id);
      expect(agentIds).toContain('agentic-architect');
      expect(agentIds).toContain('prompt-engineer');
      expect(agentIds).toContain('tool-integrator');
      expect(agentIds).toContain('qa-bot-designer');
      expect(agentIds).toContain('operations-coach');
    });

    test('should have WIP limits configured', () => {
      expect(teamConfig.team.wipLimits).toBeDefined();
      expect(teamConfig.team.wipLimits.inPromptDesign).toBe(2);
      expect(teamConfig.team.wipLimits.inIntegration).toBe(2);
      expect(teamConfig.team.wipLimits.inQA).toBe(2);
    });

    test('should have KPIs defined', () => {
      expect(teamConfig.kpis.cycleTimePerStory.target).toBe('<=2 days');
      expect(teamConfig.kpis.defectEscapeRate.target).toBe('<=5%');
      expect(teamConfig.kpis.tokenCostPerStory.target).toBe('<=$0.10');
    });
  });

  describe('Agent Prompts', () => {
    const agentPrompts = [
      'agentic-architect.md',
      'prompt-engineer.md',
      'tool-integrator.md',
      'qa-bot-designer.md',
      'operations-coach.md'
    ];

    agentPrompts.forEach(promptFile => {
      test(`should have ${promptFile} prompt file`, () => {
        const promptPath = path.join(AGENTIC_TEAM_DIR, 'prompts', promptFile);
        expect(fs.existsSync(promptPath)).toBe(true);
      });

      test(`${promptFile} should have Role section`, () => {
        const promptPath = path.join(AGENTIC_TEAM_DIR, 'prompts', promptFile);
        const content = fs.readFileSync(promptPath, 'utf8');
        expect(content).toContain('## Role');
      });

      test(`${promptFile} should have Responsibilities section`, () => {
        const promptPath = path.join(AGENTIC_TEAM_DIR, 'prompts', promptFile);
        const content = fs.readFileSync(promptPath, 'utf8');
        expect(content).toContain('## Responsibilities');
      });
    });
  });

  describe('Kanban Workflow', () => {
    let kanbanConfig;

    beforeAll(() => {
      const configPath = path.join(AGENTIC_TEAM_DIR, 'workflows', 'kanban.json');
      kanbanConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    });

    test('should have 5 columns', () => {
      expect(kanbanConfig.columns).toHaveLength(5);
    });

    test('should have stop-the-line policy enabled', () => {
      expect(kanbanConfig.policies.stopTheLine.enabled).toBe(true);
    });

    test('should have WIP limits on work columns', () => {
      const workColumns = kanbanConfig.columns.filter(c =>
        c.id !== 'ready' && c.id !== 'done'
      );
      workColumns.forEach(col => {
        expect(col.wipLimit).toBe(2);
      });
    });
  });

  describe('MCP Configuration', () => {
    let mcpConfig;

    beforeAll(() => {
      const configPath = path.join(AGENTIC_TEAM_DIR, 'adapters', 'mcp-config.json');
      mcpConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    });

    test('should have claude-flow as required server', () => {
      expect(mcpConfig.mcpServers['claude-flow'].required).toBe(true);
    });

    test('should have agent-tool mappings for all agents', () => {
      const mappings = mcpConfig.agentToolMappings;
      expect(Object.keys(mappings)).toHaveLength(5);
    });
  });

  describe('Hello-World Validation', () => {
    test('should have hello-world prompt', () => {
      const promptPath = path.join(AGENTIC_TEAM_DIR, 'prompts', 'hello-world.md');
      expect(fs.existsSync(promptPath)).toBe(true);
    });

    test('hello-world should have success criteria', () => {
      const promptPath = path.join(AGENTIC_TEAM_DIR, 'prompts', 'hello-world.md');
      const content = fs.readFileSync(promptPath, 'utf8');
      expect(content).toContain('## Success Criteria');
    });
  });
});
