import { useState, useEffect, useCallback } from 'react';

interface SettingsPanelProps {
  onClose: () => void;
}

type ExecutionMode = 'iterative' | 'script';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);
  const [currentBaseUrl, setCurrentBaseUrl] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('iterative');
  const [savingMode, setSavingMode] = useState(false);

  // Load current config on mount
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getLLMConfig().then(config => {
        setApiKeySet(config.hasApiKey);
        setCurrentBaseUrl(config.baseUrl);
      });
      
      // Load execution mode
      window.electronAPI.agent.getExecutionMode().then(mode => {
        setExecutionMode(mode);
      });
    }
  }, []);

  // Save config
  const handleSaveConfig = useCallback(async () => {
    if (!window.electronAPI || !apiKey.trim()) return;
    
    setSaving(true);
    try {
      const config: { apiKey: string; baseUrl?: string } = {
        apiKey: apiKey.trim()
      };
      
      // Only set baseUrl if it's different from default
      const trimmedBaseUrl = baseUrl.trim();
      if (trimmedBaseUrl && trimmedBaseUrl !== DEFAULT_BASE_URL) {
        config.baseUrl = trimmedBaseUrl;
      }
      
      const result = await window.electronAPI.setLLMConfig(config);
      if (result.success) {
        setApiKeySet(true);
        setCurrentBaseUrl(config.baseUrl);
        setApiKey(''); // Clear input for security
      }
    } finally {
      setSaving(false);
    }
  }, [apiKey, baseUrl]);

  // Handle execution mode change
  const handleModeChange = useCallback(async (mode: ExecutionMode) => {
    if (!window.electronAPI) return;
    
    setSavingMode(true);
    try {
      const result = await window.electronAPI.agent.setExecutionMode(mode);
      if (result.success) {
        setExecutionMode(mode);
      }
    } finally {
      setSavingMode(false);
    }
  }, []);

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h2>Settings</h2>
        <button className="settings-close-btn" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="settings-content">
        {/* AI Configuration Section */}
        <section className="settings-section">
          <div className="section-header">
            <span className="section-icon">◆</span>
            <h3>AI Configuration</h3>
            {apiKeySet && <span className="status-badge success">Enabled</span>}
          </div>
          
          <p className="section-description">
            设置 Claude API Key 启用自然语言功能，让你可以用日常对话控制浏览器。
          </p>

          <div className="form-group">
            <label>Base URL (Optional)</label>
            <input
              type="text"
              className="form-input full-width"
              placeholder={DEFAULT_BASE_URL}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            {currentBaseUrl && (
              <div className="form-hint">
                当前: {currentBaseUrl}
              </div>
            )}
          </div>

          <div className="form-group">
            <label>API Key</label>
            <div className="input-group">
              <input
                type="password"
                className="form-input"
                placeholder={apiKeySet ? '••••••••••••••••••••' : 'sk-ant-...'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveConfig()}
              />
              <button 
                className="form-btn primary"
                onClick={handleSaveConfig}
                disabled={!apiKey.trim() || saving}
              >
                {saving ? 'Saving...' : apiKeySet ? 'Update' : 'Save'}
              </button>
            </div>
            {apiKeySet && (
              <div className="form-hint success">
                ✓ API Key 已配置，AI 功能已启用
              </div>
            )}
          </div>
        </section>

        {/* Agent Mode Section */}
        <section className="settings-section">
          <div className="section-header">
            <span className="section-icon">◈</span>
            <h3>Agent Mode</h3>
            <span className={`status-badge ${executionMode === 'iterative' ? 'info' : 'warning'}`}>
              {executionMode === 'iterative' ? 'Iterative' : 'Script'}
            </span>
          </div>
          
          <p className="section-description">
            选择 Agent 的执行模式。单步迭代模式更可靠，完整脚本模式更快速。
          </p>

          <div className="mode-selector">
            <label className={`mode-option ${executionMode === 'iterative' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="executionMode"
                value="iterative"
                checked={executionMode === 'iterative'}
                onChange={() => handleModeChange('iterative')}
                disabled={savingMode}
              />
              <div className="mode-content">
                <div className="mode-title">单步迭代模式 (Iterative)</div>
                <div className="mode-description">
                  每次生成一小段代码并执行，根据结果决定下一步。
                  更可靠，适合复杂任务和动态页面。
                </div>
              </div>
            </label>
            
            <label className={`mode-option ${executionMode === 'script' ? 'selected' : ''}`}>
              <input
                type="radio"
                name="executionMode"
                value="script"
                checked={executionMode === 'script'}
                onChange={() => handleModeChange('script')}
                disabled={savingMode}
              />
              <div className="mode-content">
                <div className="mode-title">完整脚本模式 (Script)</div>
                <div className="mode-description">
                  一次性生成完整脚本并执行。
                  更快速，适合简单任务和稳定页面。
                </div>
              </div>
            </label>
          </div>
        </section>

        {/* Natural Language Examples */}
        <section className="settings-section">
          <div className="section-header">
            <span className="section-icon">◇</span>
            <h3>Natural Language Examples</h3>
          </div>
          
          <p className="section-description">
            启用 AI 后，你可以用自然语言描述想要执行的操作：
          </p>

          <div className="examples-grid">
            <div className="example-card">
              <div className="example-input">"打开百度"</div>
              <div className="example-output">
                <code>goto https://baidu.com</code>
              </div>
            </div>
            <div className="example-card">
              <div className="example-input">"点击搜索按钮"</div>
              <div className="example-output">
                <code>click 搜索按钮</code>
              </div>
            </div>
            <div className="example-card">
              <div className="example-input">"输入 hello world"</div>
              <div className="example-output">
                <code>type ... hello world</code>
              </div>
            </div>
            <div className="example-card">
              <div className="example-input">"等待 3 秒"</div>
              <div className="example-output">
                <code>wait 3000</code>
              </div>
            </div>
            <div className="example-card">
              <div className="example-input">"截个图"</div>
              <div className="example-output">
                <code>screenshot</code>
              </div>
            </div>
            <div className="example-card">
              <div className="example-input">"按回车键"</div>
              <div className="example-output">
                <code>press Enter</code>
              </div>
            </div>
          </div>
        </section>

        {/* About Section */}
        <section className="settings-section">
          <div className="section-header">
            <span className="section-icon">○</span>
            <h3>About</h3>
          </div>
          
          <div className="about-info">
            <div className="about-row">
              <span className="about-label">Version</span>
              <span className="about-value">1.0.0</span>
            </div>
            <div className="about-row">
              <span className="about-label">Browser Control</span>
              <span className="about-value">CDP (Chrome DevTools Protocol)</span>
            </div>
            <div className="about-row">
              <span className="about-label">AI Model</span>
              <span className="about-value">Claude 3 Haiku</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

