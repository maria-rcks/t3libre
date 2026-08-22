import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { apiClient } from '../lib/api';
import { DockerApp } from '../lib/types';
import { toast } from 'sonner';
import { GitDeployManager } from '../components/GitDeployManager';
import { DatabaseManager } from '../components/DatabaseManager';
import { ModpackBrowser } from '../components/ModpackBrowser';
import ConfigEditor from '../components/ConfigEditor';
import { ConfigVersionControl } from '../components/ConfigVersionControl';
import { LiveLogs } from '../components/LiveLogs';
import AlertConfig from '../components/AlertConfig';
import { ServerOperationsHub } from '../components/ServerOperationsHub';

export const AppDetail = () => {
  const navigate = useNavigate();
  const { appId } = useParams();
  const [app, setApp] = useState<DockerApp | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'env' | 'volumes' | 'config' | 'settings' | 'deploy' | 'database' | 'modpacks' | 'operations' | 'diff' | 'alerts'>(
    'overview'
  );
  const [logs, setLogs] = useState<Array<any>>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (appId) {
      loadApp();
    }
  }, [appId]);

  useEffect(() => {
    if (activeTab === 'logs') {
      loadLogs();
      const interval = setInterval(loadLogs, 3000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const loadApp = async () => {
    try {
      const data = await apiClient.getApp(appId!);
      setApp(data);
    } catch (error) {
      toast.error('Failed to load app');
      navigate('/dashboard');
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    if (!appId) return;
    setLogsLoading(true);
    try {
      const data = await apiClient.getLogs(appId, 50, 0);
      setLogs(data);
    } catch (error) {
      // Silently fail on logs load
    } finally {
      setLogsLoading(false);
    }
  };

  const handleStart = async () => {
    setActionLoading(true);
    try {
      const updated = await apiClient.startApp(appId!);
      setApp(updated);
      toast.success('App started');
    } catch (error) {
      toast.error('Failed to start app');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async () => {
    setActionLoading(true);
    try {
      const updated = await apiClient.stopApp(appId!);
      setApp(updated);
      toast.success('App stopped');
    } catch (error) {
      toast.error('Failed to stop app');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestart = async () => {
    setActionLoading(true);
    try {
      const updated = await apiClient.restartApp(appId!);
      setApp(updated);
      toast.success('App restarting');
    } catch (error) {
      toast.error('Failed to restart app');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this app?')) return;

    setActionLoading(true);
    try {
      await apiClient.deleteApp(appId!);
      toast.success('App deleted');
      navigate('/dashboard');
    } catch (error) {
      toast.error('Failed to delete app');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-600 dark:text-slate-300">Loading...</p>
      </div>
    );
  }

  if (!app) {
    return (
      <div className="text-center py-12">
        <p className="text-slate-600 dark:text-slate-300">App not found</p>
        <button
          onClick={() => navigate('/dashboard')}
          className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running':
        return 'text-green-600';
      case 'stopped':
        return 'text-gray-600';
      case 'restarting':
        return 'text-yellow-600';
      case 'error':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white mb-2">{app.name}</h1>
          <p className="text-slate-600 dark:text-slate-300 font-mono">{app.image}</p>
          {app.description && (
            <p className="text-slate-500 dark:text-slate-400 mt-2">{app.description}</p>
          )}
        </div>
        <button
          onClick={() => navigate('/dashboard')}
          className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
        >
          ← Back
        </button>
      </div>

      {/* Status and Actions */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-1">Current Status</p>
            <p className={`text-2xl font-bold ${getStatusColor(app.status)}`}>
              {app.status.charAt(0).toUpperCase() + app.status.slice(1)}
            </p>
          </div>
          <div className="flex gap-2">
            {app.status === 'running' ? (
              <>
                <button
                  onClick={handleRestart}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
                >
                  Restart
                </button>
                <button
                  onClick={handleStop}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
                >
                  Stop
                </button>
              </>
            ) : (
              <button
                onClick={handleStart}
                disabled={actionLoading}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
              >
                Start
              </button>
            )}
            <button
              onClick={() => navigate(`/apps/${app.id}/edit`)}
              disabled={actionLoading}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              disabled={actionLoading}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div>
        <div className="flex border-b border-slate-200 dark:border-slate-700 gap-4">
          {(
            ['overview', 'operations', 'logs', 'env', 'volumes', 'config', 'diff', 'alerts', 'settings', 'deploy', 'database', 'modpacks'] as const
          ).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
                <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Details</h3>
                <dl className="space-y-3">
                  <div className="flex justify-between">
                    <dt className="text-slate-600 dark:text-slate-400">Container ID:</dt>
                    <dd className="text-slate-900 dark:text-white font-mono text-sm">
                      {app.container_id || 'Not assigned'}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-600 dark:text-slate-400">Created:</dt>
                    <dd className="text-slate-900 dark:text-white">
                      {new Date(app.created_at).toLocaleString()}
                    </dd>
                  </div>
                  {app.started_at && (
                    <div className="flex justify-between">
                      <dt className="text-slate-600 dark:text-slate-400">Started:</dt>
                      <dd className="text-slate-900 dark:text-white">
                        {new Date(app.started_at).toLocaleString()}
                      </dd>
                    </div>
                  )}
                  {app.memory_limit && (
                    <div className="flex justify-between">
                      <dt className="text-slate-600 dark:text-slate-400">Memory Limit:</dt>
                      <dd className="text-slate-900 dark:text-white">{app.memory_limit}</dd>
                    </div>
                  )}
                  {app.ports && app.ports.length > 0 && (
                    <div className="flex justify-between">
                      <dt className="text-slate-600 dark:text-slate-400">Ports:</dt>
                      <dd className="text-slate-900 dark:text-white">
                        {app.ports.map((p) => `${p.hostPort}:${p.containerPort}`).join(', ')}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          )}

          {activeTab === 'logs' && (
            <LiveLogs
              appId={appId}
              logs={logs.map((log, idx) => ({
                id: String(log.id ?? idx),
                timestamp: log.created_at || log.timestamp || new Date().toISOString(),
                app: app.name,
                level: (log.level || 'INFO').toUpperCase(),
                message: log.message || String(log),
              }))}
            />
          )}

          {activeTab === 'env' && (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
              {app.environment_vars && Object.keys(app.environment_vars).length > 0 ? (
                <div className="space-y-2">
                  {Object.entries(app.environment_vars).map(([key, value]) => (
                    <div key={key} className="font-mono text-sm">
                      <span className="text-blue-600 dark:text-blue-400">{key}</span>=
                      <span className="text-green-600 dark:text-green-400">{value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-600 dark:text-slate-400">No environment variables set</p>
              )}
            </div>
          )}

          {activeTab === 'volumes' && (
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-6">
              {app.volumes && app.volumes.length > 0 ? (
                <div className="space-y-2">
                  {app.volumes.map((vol, idx) => (
                    <div key={idx} className="font-mono text-sm">
                      <span className="text-blue-600 dark:text-blue-400">{vol.hostPath}</span> →{' '}
                      <span className="text-green-600 dark:text-green-400">{vol.containerPath}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-slate-600 dark:text-slate-400">No volumes mounted</p>
              )}
            </div>
          )}

          {activeTab === 'config' && appId && (
            <ConfigEditor appId={appId} />
          )}

          {activeTab === 'operations' && (
            <ServerOperationsHub app={app} onCloned={(clone) => navigate(`/apps/${clone.id}`)} />
          )}

          {activeTab === 'diff' && appId && (
            <ConfigVersionControl appId={appId} />
          )}

          {activeTab === 'alerts' && (
            <div className="rounded-lg bg-slate-900 p-4"><AlertConfig /></div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-4">
              <button
                onClick={() => navigate(`/apps/${app.id}/edit`)}
                className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
              >
                Edit Configuration
              </button>
            </div>
          )}

          {activeTab === 'deploy' && (
            <GitDeployManager />
          )}

          {activeTab === 'database' && appId && (
            <DatabaseManager appId={appId} />
          )}

          {activeTab === 'modpacks' && appId && (
            <ModpackBrowser appId={appId} />
          )}
        </div>
      </div>
    </div>
  );
};
