import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '../lib/api';
import { Database, DockerApp } from '../lib/types';
import { toast } from 'sonner';

interface DatabaseManagerProps {
  appId?: string;
}

export const DatabaseManager = ({ appId }: DatabaseManagerProps) => {
  const [databases, setDatabases] = useState<Database[]>([]);
  const [apps, setApps] = useState<DockerApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [selectedAppId, setSelectedAppId] = useState(appId || '');
  const [nameError, setNameError] = useState('');
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  const [newDbCredentials, setNewDbCredentials] = useState<Database | null>(null);

  useEffect(() => {
    Promise.all([loadDatabases(), loadApps()]).finally(() => setLoading(false));
  }, []);

  const loadDatabases = async () => {
    try {
      const dbs = await apiClient.getDatabases();
      setDatabases(appId ? dbs.filter((db) => db.appId === appId) : dbs);
    } catch {
      setDatabases([]);
    }
  };

  const loadApps = async () => {
    try {
      setApps(await apiClient.listApps());
    } catch {
      setApps([]);
    }
  };

  const validateName = (value: string) => {
    if (!value) {
      setNameError('Database name is required');
      return false;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(value)) {
      setNameError('Alphanumeric and underscores only');
      return false;
    }
    setNameError('');
    return true;
  };

  const handleCreate = async () => {
    if (!validateName(name)) return;
    try {
      const result = await apiClient.createDatabase(name, selectedAppId || undefined);
      toast.success('Database created');
      setNewDbCredentials(result);
      setShowForm(false);
      setName('');
      setSelectedAppId(appId || '');
      loadDatabases();
    } catch {
      toast.error('Failed to create database');
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this database? This action cannot be undone.')) return;
    try {
      await apiClient.deleteDatabase(id);
      toast.success('Database deleted');
      loadDatabases();
    } catch {
      toast.error('Failed to delete database');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'running': return 'text-green-400';
      case 'stopped': return 'text-gray-400';
      case 'creating': return 'text-yellow-400';
      default: return 'text-gray-400';
    }
  };

  if (loading) {
    return <div className="text-slate-400 py-4">Loading databases...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-md font-semibold text-white">Databases</h4>
        <button
          onClick={() => {
            setShowForm(!showForm);
            setNewDbCredentials(null);
          }}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded transition-colors"
        >
          {showForm ? 'Cancel' : 'New Database'}
        </button>
      </div>

      {newDbCredentials && (
        <div className="bg-yellow-900/30 border border-yellow-700 rounded-lg p-4 space-y-2">
          <p className="text-yellow-400 font-semibold">Database Created! Save these credentials:</p>
          <div className="font-mono text-sm text-white space-y-1">
            <p>Host: {newDbCredentials.host}</p>
            <p>Port: {newDbCredentials.port}</p>
            <p>Database: {newDbCredentials.database}</p>
            <p>Username: {newDbCredentials.username}</p>
            <p>Password: <span className="text-red-400 font-bold">{newDbCredentials.password}</span></p>
            <p className="text-yellow-400 text-xs mt-2">⚠️ This password will not be shown again. Save it now.</p>
          </div>
          <button
            onClick={() => setNewDbCredentials(null)}
            className="px-3 py-1 bg-yellow-600 hover:bg-yellow-700 text-white text-sm rounded"
          >
            Dismiss
          </button>
        </div>
      )}

      {showForm && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 space-y-3">
          <div>
            <input
              type="text"
              placeholder="Database name (alphanumeric + underscores)"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (nameError) validateName(e.target.value);
              }}
              onBlur={() => validateName(name)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white placeholder-slate-400 outline-none focus:border-blue-500"
            />
            {nameError && <p className="text-red-400 text-xs mt-1">{nameError}</p>}
          </div>
          {!appId && (
            <select
              value={selectedAppId}
              onChange={(e) => setSelectedAppId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
            >
              <option value="">Link to app (optional)...</option>
              {apps.map((app) => (
                <option key={app.id} value={app.id}>{app.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={handleCreate}
            disabled={!!nameError}
            className="w-full py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white font-medium rounded transition-colors"
          >
            Create Database
          </button>
        </div>
      )}

      <div className="space-y-2">
        {databases.length === 0 ? (
          <p className="text-slate-500 text-sm">No databases created yet</p>
        ) : (
          databases.map((db) => (
            <div key={db.id} className="flex items-center justify-between p-3 bg-slate-800 rounded-lg border border-slate-700">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${getStatusColor(db.status)}`} />
                  <p className="text-sm font-semibold text-white">{db.name}</p>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {db.host}:{db.port} · Created: {new Date(db.createdAt).toLocaleDateString()}
                  {db.appId && ' · Linked to app'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowPassword({ ...showPassword, [db.id]: !showPassword[db.id] })}
                  className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded transition-colors"
                >
                  {showPassword[db.id] ? 'Hide Credentials' : 'Show Credentials'}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `mysql://${db.username}:${db.password || '****'}@${db.host}:${db.port}/${db.database}`
                    );
                    toast.success('Connection string copied');
                  }}
                  className="px-2 py-1 text-xs bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 rounded transition-colors"
                >
                  Connect Info
                </button>
                <button
                  onClick={() => handleDelete(db.id)}
                  className="px-2 py-1 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/40 rounded transition-colors"
                >
                  Delete
                </button>
              </div>
              {showPassword[db.id] && (
                <div className="absolute mt-20 right-0 bg-slate-900 border border-slate-700 rounded-lg p-3 shadow-xl z-10 text-xs font-mono text-white space-y-1">
                  <p>Host: {db.host}</p>
                  <p>Port: {db.port}</p>
                  <p>Database: {db.database}</p>
                  <p>Username: {db.username}</p>
                  <p>Password: {db.password || '****'}</p>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default DatabaseManager;
