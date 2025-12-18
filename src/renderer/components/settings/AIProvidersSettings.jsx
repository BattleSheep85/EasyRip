/**
 * AIProvidersSettings - LLM Provider Configuration
 * Configure Ollama, OpenRouter, and Claude API for disc identification
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useToast } from '../common/Toast.jsx';

function AIProvidersSettings() {
  const toast = useToast();
  const { settings, loadSettings } = useSettings();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Provider settings state
  const [aiSettings, setAiSettings] = useState(null);
  const [originalSettings, setOriginalSettings] = useState(null);

  // Ollama models with status
  const [ollamaModels, setOllamaModels] = useState([]);
  const [ollamaAvailable, setOllamaAvailable] = useState(false);
  const [pullingModel, setPullingModel] = useState(null);
  const [pullProgress, setPullProgress] = useState({ percent: 0, status: '' });

  // Other provider models
  const [openrouterModels, setOpenrouterModels] = useState([]);
  const [claudeModels, setClaudeModels] = useState([]);

  // API keys (not stored in settings, stored in credential store)
  const [openrouterApiKey, setOpenrouterApiKey] = useState('');
  const [claudeApiKey, setClaudeApiKey] = useState('');
  const [claudeOAuthToken, setClaudeOAuthToken] = useState('');
  const [hasOpenrouterKey, setHasOpenrouterKey] = useState(false);
  const [hasClaudeKey, setHasClaudeKey] = useState(false);
  const [hasClaudeOAuth, setHasClaudeOAuth] = useState(false);

  // Claude auth type selection
  const [claudeAuthType, setClaudeAuthType] = useState('api_key');

  // Test results
  const [testResults, setTestResults] = useState({});

  // Tooltip state
  const [activeTooltip, setActiveTooltip] = useState(null);

  // Load settings on mount
  useEffect(() => {
    loadAllSettings();
  }, []);

  // Listen for pull progress updates
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.onOllamaModelPullProgress((data) => {
        setPullProgress({ percent: data.percent, status: data.status });
        if (data.percent >= 100) {
          // Pull complete, refresh models
          setTimeout(() => {
            refreshOllamaModels();
            setPullingModel(null);
            setPullProgress({ percent: 0, status: '' });
          }, 500);
        }
      });

      return () => {
        window.electronAPI.removeOllamaModelListeners();
      };
    }
  }, []);

  // Track changes
  useEffect(() => {
    if (originalSettings && aiSettings) {
      setHasChanges(JSON.stringify(originalSettings) !== JSON.stringify(aiSettings));
    }
  }, [aiSettings, originalSettings]);

  const loadAllSettings = async () => {
    setLoading(true);
    try {
      await loadSettings();

      // Load models for each provider
      if (window.electronAPI) {
        const [ollamaResult, openrouterResult, claudeResult] = await Promise.all([
          window.electronAPI.getOllamaModelsStatus(),
          window.electronAPI.getAIProviderModels('openrouter'),
          window.electronAPI.getAIProviderModels('claude')
        ]);

        if (ollamaResult.success) {
          setOllamaModels(ollamaResult.models || []);
          setOllamaAvailable(ollamaResult.ollamaAvailable);
        }
        if (openrouterResult.success) setOpenrouterModels(openrouterResult.models || []);
        if (claudeResult.success) setClaudeModels(claudeResult.models || []);

        // Check for existing API keys
        const [hasOpenrouter, hasClaude, hasOAuth] = await Promise.all([
          window.electronAPI.credentialHas('openrouter-api-key'),
          window.electronAPI.credentialHas('claude-api-key'),
          window.electronAPI.credentialHas('claude-oauth-token')
        ]);
        setHasOpenrouterKey(hasOpenrouter.exists || false);
        setHasClaudeKey(hasClaude.exists || false);
        setHasClaudeOAuth(hasOAuth.exists || false);

        // Set auth type based on what's configured
        if (hasOAuth.exists) {
          setClaudeAuthType('oauth');
        } else if (hasClaude.exists) {
          setClaudeAuthType('api_key');
        }
      }
    } catch (error) {
      toast.error('Failed to load AI provider settings: ' + error.message);
    }
    setLoading(false);
  };

  const refreshOllamaModels = async () => {
    if (!window.electronAPI) return;
    try {
      const result = await window.electronAPI.getOllamaModelsStatus();
      if (result.success) {
        setOllamaModels(result.models || []);
        setOllamaAvailable(result.ollamaAvailable);
      }
    } catch (error) {
      console.error('Failed to refresh Ollama models:', error);
    }
  };

  // Update when settings change from context
  useEffect(() => {
    if (settings?.aiProviders && !aiSettings) {
      const ai = settings.aiProviders;
      setAiSettings(ai);
      setOriginalSettings(JSON.parse(JSON.stringify(ai)));
      setLoading(false);
    }
  }, [settings]);

  const handleProviderChange = (providerName) => {
    setAiSettings({
      ...aiSettings,
      activeProvider: providerName
    });
  };

  const handleModelChange = (providerName, modelId) => {
    setAiSettings({
      ...aiSettings,
      [providerName]: {
        ...aiSettings[providerName],
        model: modelId
      }
    });
  };

  const handleOllamaUrlChange = (url) => {
    setAiSettings({
      ...aiSettings,
      ollama: {
        ...aiSettings.ollama,
        baseUrl: url
      }
    });
  };

  const handlePullModel = async (modelId) => {
    if (!window.electronAPI || pullingModel) return;

    setPullingModel(modelId);
    setPullProgress({ percent: 0, status: 'Starting...' });

    try {
      const result = await window.electronAPI.pullOllamaModelNew(modelId);
      if (result.success) {
        toast.success(`Model ${modelId} downloaded successfully`);
        await refreshOllamaModels();
      } else {
        toast.error(`Failed to download: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Download error: ${error.message}`);
    }

    setPullingModel(null);
    setPullProgress({ percent: 0, status: '' });
  };

  const handleDeleteModel = async (modelId) => {
    if (!window.electronAPI) return;

    // Don't allow deleting the currently selected model
    if (aiSettings.ollama?.model === modelId) {
      toast.error('Cannot delete the currently selected model');
      return;
    }

    try {
      const result = await window.electronAPI.deleteOllamaModel(modelId);
      if (result.success) {
        toast.success(`Model ${modelId} deleted`);
        await refreshOllamaModels();
      } else {
        toast.error(`Failed to delete: ${result.error}`);
      }
    } catch (error) {
      toast.error(`Delete error: ${error.message}`);
    }
  };

  const handleTestProvider = async (providerName) => {
    if (!window.electronAPI) return;

    setTesting(providerName);
    setTestResults(prev => ({ ...prev, [providerName]: null }));

    try {
      // First configure the provider with current settings
      const config = { ...aiSettings[providerName] };

      // For cloud providers, add API key or OAuth token if entered
      if (providerName === 'openrouter' && openrouterApiKey) {
        config.apiKey = openrouterApiKey;
      } else if (providerName === 'claude') {
        if (claudeAuthType === 'oauth' && claudeOAuthToken) {
          config.oauthToken = claudeOAuthToken;
          config.apiKey = null;
        } else if (claudeApiKey) {
          config.apiKey = claudeApiKey;
          config.oauthToken = null;
        }
      }

      await window.electronAPI.configureAIProvider(providerName, config);
      const result = await window.electronAPI.testAIProvider(providerName);

      setTestResults(prev => ({
        ...prev,
        [providerName]: {
          success: result.success,
          message: result.message,
          latency: result.latency
        }
      }));

      if (result.success) {
        toast.success(`${providerName} connection successful!`);
      } else {
        toast.error(`${providerName} test failed: ${result.message}`);
      }
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [providerName]: { success: false, message: error.message }
      }));
      toast.error(`Test failed: ${error.message}`);
    }

    setTesting(null);
  };

  const handleSave = async () => {
    if (!window.electronAPI) return;
    setSaving(true);

    try {
      // Save API keys if entered
      if (openrouterApiKey) {
        await window.electronAPI.credentialSet('openrouter-api-key', openrouterApiKey);
        setHasOpenrouterKey(true);
        setOpenrouterApiKey(''); // Clear from state after saving
      }

      // Handle Claude credentials based on auth type
      if (claudeAuthType === 'api_key' && claudeApiKey) {
        await window.electronAPI.credentialSet('claude-api-key', claudeApiKey);
        setHasClaudeKey(true);
        setClaudeApiKey('');
        // Clear OAuth if switching to API key
        if (hasClaudeOAuth) {
          await window.electronAPI.credentialDelete('claude-oauth-token');
          setHasClaudeOAuth(false);
        }
      } else if (claudeAuthType === 'oauth' && claudeOAuthToken) {
        await window.electronAPI.credentialSet('claude-oauth-token', claudeOAuthToken);
        setHasClaudeOAuth(true);
        setClaudeOAuthToken('');
        // Clear API key if switching to OAuth
        if (hasClaudeKey) {
          await window.electronAPI.credentialDelete('claude-api-key');
          setHasClaudeKey(false);
        }
      }

      // Save settings (includes aiProviders)
      const fullSettings = {
        ...settings,
        aiProviders: aiSettings
      };

      const result = await window.electronAPI.saveSettings(fullSettings);
      if (result.success) {
        toast.success('AI provider settings saved');
        setOriginalSettings(JSON.parse(JSON.stringify(aiSettings)));
        setHasChanges(false);

        // Re-initialize providers with new settings
        await window.electronAPI.initAIProviderFromSettings();
        await loadSettings();
      } else {
        toast.error('Failed to save: ' + result.error);
      }
    } catch (error) {
      toast.error('Error saving settings: ' + error.message);
    }

    setSaving(false);
  };

  const handleReset = () => {
    setAiSettings(JSON.parse(JSON.stringify(originalSettings)));
    setOpenrouterApiKey('');
    setClaudeApiKey('');
    setClaudeOAuthToken('');
    setHasChanges(false);
    toast.info('Changes discarded');
  };

  const handleDeleteApiKey = async (keyName, setHasKey) => {
    if (!window.electronAPI) return;
    try {
      await window.electronAPI.credentialDelete(keyName);
      setHasKey(false);
      toast.success('API key deleted');
    } catch (error) {
      toast.error('Failed to delete key: ' + error.message);
    }
  };

  // Render model card for Ollama
  const renderOllamaModelCard = (model) => {
    const isSelected = aiSettings.ollama?.model === model.id;
    const isPulling = pullingModel === model.id;

    return (
      <div
        key={model.id}
        className={`model-card ${isSelected ? 'selected' : ''} ${model.installed ? 'installed' : 'not-installed'}`}
        onMouseEnter={() => setActiveTooltip(model.id)}
        onMouseLeave={() => setActiveTooltip(null)}
      >
        <div className="model-card-header">
          <label className="model-radio">
            <input
              type="radio"
              name="ollamaModel"
              value={model.id}
              checked={isSelected}
              onChange={() => handleModelChange('ollama', model.id)}
              disabled={!model.installed || isPulling}
            />
            <span className="model-name">
              {model.name}
              {model.recommended && <span className="recommended-badge">★</span>}
            </span>
          </label>
          <div className="model-status">
            {model.installed ? (
              <span className="status-installed">✓ Installed</span>
            ) : (
              <span className="status-not-installed">Not installed</span>
            )}
          </div>
        </div>

        <div className="model-card-body">
          <div className="model-short-desc">{model.shortDesc}</div>
          <div className="model-specs">
            <span className="spec-item" title="Download size">
              📥 {model.downloadSize}
            </span>
            <span className="spec-item" title="VRAM required">
              🎮 {model.vramRequired}
            </span>
            <span className="spec-item" title="JSON accuracy">
              📊 {model.jsonAccuracy}%
            </span>
            <span className={`spec-item speed-${model.speed}`} title="Inference speed">
              ⚡ {model.speed.replace('-', ' ')}
            </span>
          </div>
        </div>

        <div className="model-card-actions">
          {!model.installed ? (
            <button
              className="btn btn-sm btn-primary"
              onClick={() => handlePullModel(model.id)}
              disabled={isPulling || pullingModel}
            >
              {isPulling ? `${pullProgress.percent}% ${pullProgress.status}` : 'Download'}
            </button>
          ) : (
            <>
              {!isSelected && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => handleDeleteModel(model.id)}
                  title="Delete this model"
                >
                  Delete
                </button>
              )}
            </>
          )}
        </div>

        {/* Tooltip */}
        {activeTooltip === model.id && model.tooltip && (
          <div className="model-tooltip">
            <div className="tooltip-section">
              <strong>Strengths:</strong>
              <ul>
                {model.tooltip.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
            <div className="tooltip-section">
              <strong>Best for:</strong>
              <p>{model.tooltip.bestFor}</p>
            </div>
            <div className="tooltip-section tooltip-notes">
              <em>{model.tooltip.notes}</em>
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="settings-tab">
        <h2>AI Providers</h2>
        <p>Loading...</p>
      </div>
    );
  }

  if (!aiSettings) {
    return (
      <div className="settings-tab">
        <h2>AI Providers</h2>
        <p>Failed to load settings</p>
      </div>
    );
  }

  return (
    <div className="settings-tab ai-providers-settings">
      <h2>AI Providers</h2>
      <p className="settings-description">
        Configure which AI provider to use for disc identification.
        Ollama runs locally, while OpenRouter and Claude API require cloud access.
      </p>

      {/* Provider Selection */}
      <section className="settings-section">
        <h3>Active Provider</h3>
        <div className="preset-selector">
          {/* Ollama */}
          <label className="preset-radio">
            <input
              type="radio"
              name="aiProvider"
              value="ollama"
              checked={aiSettings.activeProvider === 'ollama'}
              onChange={() => handleProviderChange('ollama')}
            />
            <div className="preset-card">
              <div className="preset-name">Ollama (Local)</div>
              <div className="preset-description">
                Run AI locally on your machine. Free, private, no API key needed.
              </div>
              <div className="preset-specs">
                {ollamaAvailable ? '✓ Running' : '⚠ Not running'}
              </div>
            </div>
          </label>

          {/* OpenRouter */}
          <label className="preset-radio">
            <input
              type="radio"
              name="aiProvider"
              value="openrouter"
              checked={aiSettings.activeProvider === 'openrouter'}
              onChange={() => handleProviderChange('openrouter')}
            />
            <div className="preset-card">
              <div className="preset-name">OpenRouter</div>
              <div className="preset-description">
                Access multiple cloud AI models through a single API.
              </div>
              <div className="preset-specs">API key required (pay per use)</div>
            </div>
          </label>

          {/* Claude API */}
          <label className="preset-radio">
            <input
              type="radio"
              name="aiProvider"
              value="claude"
              checked={aiSettings.activeProvider === 'claude'}
              onChange={() => handleProviderChange('claude')}
            />
            <div className="preset-card">
              <div className="preset-name">Claude API</div>
              <div className="preset-description">
                Direct access to Anthropic's Claude models.
              </div>
              <div className="preset-specs">API key required</div>
            </div>
          </label>
        </div>
      </section>

      {/* Ollama Settings */}
      <section className={`settings-section ${aiSettings.activeProvider !== 'ollama' ? 'section-disabled' : ''}`}>
        <h3>Ollama Settings</h3>

        <div className="form-group ollama-url-group">
          <label>Base URL</label>
          <input
            type="text"
            value={aiSettings.ollama?.baseUrl || 'http://127.0.0.1:11434'}
            onChange={(e) => handleOllamaUrlChange(e.target.value)}
            placeholder="http://127.0.0.1:11434"
          />
          <small>URL where Ollama is running</small>
        </div>

        <div className="ollama-models-section">
          <div className="section-header">
            <h4>Available Models</h4>
            <button
              className="btn btn-xs btn-icon"
              onClick={refreshOllamaModels}
              title="Refresh model status"
            >
              ↻
            </button>
          </div>

          {!ollamaAvailable && (
            <div className="ollama-not-running">
              <strong>⚠ Ollama is not running</strong>
              <p>Start Ollama to manage models. Models cannot be downloaded until Ollama is running.</p>
            </div>
          )}

          <div className="model-cards-grid">
            {ollamaModels.map(model => renderOllamaModelCard(model))}
          </div>
        </div>

        <button
          className="btn btn-secondary"
          onClick={() => handleTestProvider('ollama')}
          disabled={testing === 'ollama'}
        >
          {testing === 'ollama' ? 'Testing...' : 'Test Connection'}
        </button>

        {testResults.ollama && (
          <div className={`test-result ${testResults.ollama.success ? 'test-success' : 'test-error'}`}>
            {testResults.ollama.message}
            {testResults.ollama.latency && ` (${testResults.ollama.latency}ms)`}
          </div>
        )}
      </section>

      {/* OpenRouter Settings */}
      <section className={`settings-section ${aiSettings.activeProvider !== 'openrouter' ? 'section-disabled' : ''}`}>
        <h3>OpenRouter Settings</h3>

        <div className="form-grid">
          <div className="form-group">
            <label>
              API Key
              {hasOpenrouterKey && <span className="key-status key-saved"> (saved)</span>}
            </label>
            <div className="input-with-button">
              <input
                type="password"
                value={openrouterApiKey}
                onChange={(e) => setOpenrouterApiKey(e.target.value)}
                placeholder={hasOpenrouterKey ? '••••••••••••' : 'Enter API key'}
              />
              {hasOpenrouterKey && (
                <button
                  className="btn btn-xs btn-danger"
                  onClick={() => handleDeleteApiKey('openrouter-api-key', setHasOpenrouterKey)}
                  title="Delete saved key"
                >
                  X
                </button>
              )}
            </div>
            <small>
              Get your API key at{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal('https://openrouter.ai/keys'); }}>
                openrouter.ai/keys
              </a>
            </small>
          </div>

          <div className="form-group">
            <label>Model</label>
            <select
              value={aiSettings.openrouter?.model || 'anthropic/claude-3.5-haiku'}
              onChange={(e) => handleModelChange('openrouter', e.target.value)}
            >
              {openrouterModels.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name} - {model.description}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          className="btn btn-secondary"
          onClick={() => handleTestProvider('openrouter')}
          disabled={testing === 'openrouter' || (!hasOpenrouterKey && !openrouterApiKey)}
        >
          {testing === 'openrouter' ? 'Testing...' : 'Test Connection'}
        </button>

        {testResults.openrouter && (
          <div className={`test-result ${testResults.openrouter.success ? 'test-success' : 'test-error'}`}>
            {testResults.openrouter.message}
            {testResults.openrouter.latency && ` (${testResults.openrouter.latency}ms)`}
          </div>
        )}
      </section>

      {/* Claude API Settings */}
      <section className={`settings-section ${aiSettings.activeProvider !== 'claude' ? 'section-disabled' : ''}`}>
        <h3>Claude API Settings</h3>

        {/* Auth Type Selection */}
        <div className="form-group auth-type-selector">
          <label>Authentication Method</label>
          <div className="radio-group">
            <label className="radio-label">
              <input
                type="radio"
                name="claudeAuthType"
                value="api_key"
                checked={claudeAuthType === 'api_key'}
                onChange={() => setClaudeAuthType('api_key')}
              />
              <span>API Key</span>
              <small>Pay-per-use from console.anthropic.com</small>
            </label>
            <label className="radio-label">
              <input
                type="radio"
                name="claudeAuthType"
                value="oauth"
                checked={claudeAuthType === 'oauth'}
                onChange={() => setClaudeAuthType('oauth')}
              />
              <span>OAuth Token (Pro/Max)</span>
              <small>Use your Claude subscription quota</small>
            </label>
          </div>
        </div>

        <div className="form-grid">
          {/* API Key Input */}
          {claudeAuthType === 'api_key' && (
            <div className="form-group">
              <label>
                API Key
                {hasClaudeKey && <span className="key-status key-saved"> (saved)</span>}
              </label>
              <div className="input-with-button">
                <input
                  type="password"
                  value={claudeApiKey}
                  onChange={(e) => setClaudeApiKey(e.target.value)}
                  placeholder={hasClaudeKey ? '••••••••••••' : 'Enter API key'}
                />
                {hasClaudeKey && (
                  <button
                    className="btn btn-xs btn-danger"
                    onClick={() => handleDeleteApiKey('claude-api-key', setHasClaudeKey)}
                    title="Delete saved key"
                  >
                    X
                  </button>
                )}
              </div>
              <small>
                Get your API key at{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); window.electronAPI?.openExternal('https://console.anthropic.com/'); }}>
                  console.anthropic.com
                </a>
              </small>
            </div>
          )}

          {/* OAuth Token Input */}
          {claudeAuthType === 'oauth' && (
            <div className="form-group oauth-connect-section">
              <label>
                OAuth Token
                {hasClaudeOAuth && <span className="key-status key-saved"> (saved)</span>}
              </label>

              {/* Connect with Claude button */}
              {!hasClaudeOAuth && (
                <div className="oauth-connect-prompt">
                  <p className="oauth-info">
                    Use your Claude Pro or Max subscription to access the API without per-use charges.
                  </p>
                  <button
                    type="button"
                    className="btn btn-oauth-connect"
                    onClick={(e) => {
                      e.preventDefault();
                      window.electronAPI?.openExternal('https://claude.ai/settings/api');
                    }}
                  >
                    <span className="oauth-icon">🔑</span>
                    Connect with Claude
                  </button>
                  <small className="oauth-instructions">
                    Click above to open Claude settings. Copy your API access token and paste it below.
                  </small>
                </div>
              )}

              <div className="input-with-button">
                <input
                  type="password"
                  value={claudeOAuthToken}
                  onChange={(e) => setClaudeOAuthToken(e.target.value)}
                  placeholder={hasClaudeOAuth ? '••••••••••••' : 'Paste token here after authorizing'}
                />
                {hasClaudeOAuth && (
                  <button
                    className="btn btn-xs btn-danger"
                    onClick={() => handleDeleteApiKey('claude-oauth-token', setHasClaudeOAuth)}
                    title="Delete saved token"
                  >
                    X
                  </button>
                )}
              </div>
              {hasClaudeOAuth && (
                <small className="oauth-connected">
                  ✓ Connected to Claude Pro/Max subscription
                </small>
              )}
            </div>
          )}

          <div className="form-group">
            <label>Model</label>
            <select
              value={aiSettings.claude?.model || 'claude-haiku-4-5-20251001'}
              onChange={(e) => handleModelChange('claude', e.target.value)}
            >
              {claudeModels.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name} - {model.description}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          className="btn btn-secondary"
          onClick={() => handleTestProvider('claude')}
          disabled={testing === 'claude' || (claudeAuthType === 'api_key' ? (!hasClaudeKey && !claudeApiKey) : (!hasClaudeOAuth && !claudeOAuthToken))}
        >
          {testing === 'claude' ? 'Testing...' : 'Test Connection'}
        </button>

        {testResults.claude && (
          <div className={`test-result ${testResults.claude.success ? 'test-success' : 'test-error'}`}>
            {testResults.claude.message}
            {testResults.claude.latency && ` (${testResults.claude.latency}ms)`}
          </div>
        )}
      </section>

      {/* Save/Reset Buttons */}
      {(hasChanges || openrouterApiKey || claudeApiKey || claudeOAuthToken) && (
        <div className="settings-actions">
          <button className="btn btn-secondary" onClick={handleReset} disabled={saving}>
            Discard Changes
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save AI Settings'}
          </button>
        </div>
      )}

      {/* Help Section */}
      <section className="settings-section">
        <h3>Provider Comparison</h3>
        <div className="help-box">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Cost</th>
                <th>Privacy</th>
                <th>Speed</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Ollama</strong></td>
                <td>Free</td>
                <td>Local (best)</td>
                <td>Depends on GPU</td>
              </tr>
              <tr>
                <td><strong>OpenRouter</strong></td>
                <td>Pay per use</td>
                <td>Cloud</td>
                <td>Fast</td>
              </tr>
              <tr>
                <td><strong>Claude API</strong></td>
                <td>Pay per use</td>
                <td>Cloud</td>
                <td>Fast</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default AIProvidersSettings;
