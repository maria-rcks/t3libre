import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { apiClient } from '../lib/api';
import { ServerPreset, JAVA_VERSIONS } from '../lib/types';
import { toast } from 'sonner';

export const AppForm = () => {
  const navigate = useNavigate();
  const { appId } = useParams();
  const isEdit = !!appId;

  const [formData, setFormData] = useState({
    name: '',
    image: '',
    description: '',
    memoryLimit: '',
    javaVersion: '',
    ports: [] as Array<{ hostPort: string; containerPort: string; protocol: string }>,
    environmentVars: {} as Record<string, string>,
    volumes: [] as Array<{ hostPath: string; containerPath: string }>,
  });

  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [newPort, setNewPort] = useState({ hostPort: '', containerPort: '', protocol: 'tcp' });
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');
  const [newVolume, setNewVolume] = useState({ hostPath: '', containerPath: '' });
  const [presets, setPresets] = useState<ServerPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [discordToken, setDiscordToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{valid: boolean; botName?: string; guildCount?: number; error?: string} | null>(null);

  useEffect(() => {
    if (isEdit && appId) {
      loadApp();
    }
    loadPresets();
  }, [appId, isEdit]);


  const loadPresets = async () => {
    try {
      const data = await apiClient.listPresets();
      setPresets(data);
    } catch (error) {
      toast.error('Failed to load presets');
    }
  };

  const applyPreset = (presetId: string) => {
    const preset = presets.find((p) => p.id === presetId);
    if (!preset) return;

    setFormData((prev) => ({
      ...prev,
      name: prev.name || preset.name,
      image: preset.image,
      description: preset.description,
      memoryLimit: preset.resources.ram,
      javaVersion: preset.javaVersion || '',
      ports: preset.ports.map((port) => ({
        hostPort: String(port.hostPort),
        containerPort: String(port.containerPort),
        protocol: port.protocol,
      })),
      environmentVars: preset.environmentVars,
    }));
  };

  const loadApp = async () => {
    try {
      const app = await apiClient.getApp(appId!);
      setFormData({
        name: app.name,
        image: app.image,
        description: app.description || '',
        memoryLimit: app.memory_limit || '',
        javaVersion: app.javaVersion || app.environment_vars?.JAVA_VERSION || '',
        ports: app.ports || [],
        environmentVars: app.environment_vars || {},
        volumes: app.volumes || [],
      });
    } catch (error) {
      toast.error('Failed to load app');
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.image) {
      toast.error('Name and image are required');
      return;
    }

    setSubmitting(true);
    try {
      const payload: Record<string, any> = {
        name: formData.name,
        image: formData.image,
        description: formData.description,
        memoryLimit: formData.memoryLimit || undefined,
        ports: formData.ports,
        environmentVars: formData.environmentVars,
        volumes: formData.volumes,
      };
      if (formData.javaVersion) {
        payload.javaVersion = formData.javaVersion;
      }

      if (isEdit && appId) {
        await apiClient.updateApp(appId, payload);
        toast.success('App updated successfully');
      } else {
        await apiClient.createApp(payload);
        toast.success('App created successfully');
      }

      navigate('/dashboard');
    } catch (error: any) {
      toast.error(error.response?.data?.error || 'Failed to save app');
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidateDiscordToken = async () => {
    if (!discordToken) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await apiClient.validateDiscordToken(discordToken);
      setValidationResult(result);
    } catch {
      setValidationResult({ valid: false, error: 'Failed to connect to validation service' });
    } finally {
      setValidating(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-600 dark:text-slate-300">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-8">
        {isEdit ? 'Edit App' : 'Create New App'}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">

        {!isEdit && (
          <fieldset className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Create your first server
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
              Pick a preset to pre-fill resources, image, ports, and environment variables.
            </p>
            <div className="flex gap-2">
              <select
                value={selectedPreset}
                onChange={(e) => {
                  setSelectedPreset(e.target.value);
                  applyPreset(e.target.value);
                }}
                className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
              >
                <option value="">Select a preset</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </div>
          </fieldset>
        )}

        {!isEdit && selectedPreset === 'discord-bot' && (
          <fieldset className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
              Discord Bot Token
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
              Validate your Discord bot token before starting the container.
            </p>
            <div className="flex gap-2 mb-3">
              <input
                type="password"
                value={discordToken}
                onChange={(e) => {
                  setDiscordToken(e.target.value);
                  setValidationResult(null);
                }}
                placeholder="Paste your Discord bot token"
                className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-mono text-sm"
              />
              <button
                type="button"
                onClick={handleValidateDiscordToken}
                disabled={validating || !discordToken}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
              >
                {validating ? 'Validating...' : 'Validate'}
              </button>
            </div>
            {validationResult && (
              <div className={`text-sm px-3 py-2 rounded ${validationResult.valid ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
                {validationResult.valid ? (
                  <span>✓ Valid — <strong>{validationResult.botName}</strong> (in {validationResult.guildCount} guild{validationResult.guildCount !== 1 ? 's' : ''})</span>
                ) : (
                  <span>✗ {validationResult.error}</span>
                )}
              </div>
            )}
          </fieldset>
        )}

        {/* Basic Info */}
        <fieldset className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
            Basic Information
          </h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                App Name *
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., My Web App"
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Docker Image *
              </label>
              <input
                type="text"
                required
                value={formData.image}
                onChange={(e) => setFormData({ ...formData, image: e.target.value })}
                placeholder="e.g., nginx:latest"
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description"
                rows={3}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Memory Limit
              </label>
              <input
                type="text"
                value={formData.memoryLimit}
                onChange={(e) => setFormData({ ...formData, memoryLimit: e.target.value })}
                placeholder="e.g., 512m, 1g"
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {selectedPreset.startsWith('minecraft') && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Java Version
                </label>
                <select
                  value={formData.javaVersion}
                  onChange={(e) => setFormData({ ...formData, javaVersion: e.target.value })}
                  className="w-full px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select Java version</option>
                  {JAVA_VERSIONS.map((v) => (
                    <option key={v} value={v}>Java {v}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </fieldset>

        {/* Ports */}
        <fieldset className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Ports</h2>

          <div className="space-y-2 mb-4">
            {formData.ports.map((port, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <span className="text-sm text-slate-600 dark:text-slate-400">
                  {port.hostPort}:{port.containerPort}/{port.protocol}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFormData({
                      ...formData,
                      ports: formData.ports.filter((_, i) => i !== idx),
                    });
                  }}
                  className="text-red-600 hover:text-red-700 text-sm font-medium"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="number"
              value={newPort.hostPort}
              onChange={(e) => setNewPort({ ...newPort, hostPort: e.target.value })}
              placeholder="Host port"
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <input
              type="number"
              value={newPort.containerPort}
              onChange={(e) => setNewPort({ ...newPort, containerPort: e.target.value })}
              placeholder="Container port"
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <select
              value={newPort.protocol}
              onChange={(e) => setNewPort({ ...newPort, protocol: e.target.value })}
              className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            >
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
            <button
              type="button"
              onClick={() => {
                if (newPort.hostPort && newPort.containerPort) {
                  setFormData({
                    ...formData,
                    ports: [...formData.ports, newPort],
                  });
                  setNewPort({ hostPort: '', containerPort: '', protocol: 'tcp' });
                }
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              Add
            </button>
          </div>
        </fieldset>

        {/* Environment Variables */}
        <fieldset className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">
            Environment Variables
          </h2>

          <div className="space-y-2 mb-4">
            {Object.entries(formData.environmentVars).map(([key, value]) => (
              <div key={key} className="flex gap-2 items-center">
                <span className="text-sm text-slate-600 dark:text-slate-400 font-mono">
                  {key}={value}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const { [key]: _, ...rest } = formData.environmentVars;
                    setFormData({ ...formData, environmentVars: rest });
                  }}
                  className="text-red-600 hover:text-red-700 text-sm font-medium"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newEnvKey}
              onChange={(e) => setNewEnvKey(e.target.value)}
              placeholder="KEY"
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={newEnvValue}
              onChange={(e) => setNewEnvValue(e.target.value)}
              placeholder="value"
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <button
              type="button"
              onClick={() => {
                if (newEnvKey) {
                  setFormData({
                    ...formData,
                    environmentVars: {
                      ...formData.environmentVars,
                      [newEnvKey]: newEnvValue,
                    },
                  });
                  setNewEnvKey('');
                  setNewEnvValue('');
                }
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              Add
            </button>
          </div>
        </fieldset>

        {/* Volumes */}
        <fieldset className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Volumes</h2>

          <div className="space-y-2 mb-4">
            {formData.volumes.map((volume, idx) => (
              <div key={idx} className="flex gap-2 items-center">
                <span className="text-sm text-slate-600 dark:text-slate-400 font-mono">
                  {volume.hostPath} → {volume.containerPath}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setFormData({
                      ...formData,
                      volumes: formData.volumes.filter((_, i) => i !== idx),
                    });
                  }}
                  className="text-red-600 hover:text-red-700 text-sm font-medium"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={newVolume.hostPath}
              onChange={(e) => setNewVolume({ ...newVolume, hostPath: e.target.value })}
              placeholder="/host/path"
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={newVolume.containerPath}
              onChange={(e) => setNewVolume({ ...newVolume, containerPath: e.target.value })}
              placeholder="/container/path"
              className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-slate-900 dark:text-white"
            />
            <button
              type="button"
              onClick={() => {
                if (newVolume.hostPath && newVolume.containerPath) {
                  setFormData({
                    ...formData,
                    volumes: [...formData.volumes, newVolume],
                  });
                  setNewVolume({ hostPath: '', containerPath: '' });
                }
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              Add
            </button>
          </div>
        </fieldset>

        {/* Actions */}
        <div className="flex gap-4">
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white font-semibold rounded-lg transition-colors"
          >
            {submitting ? 'Saving...' : isEdit ? 'Update App' : 'Create App'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            disabled={submitting}
            className="px-6 py-3 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};
