import { useState, useEffect } from 'react';
import { apiClient } from '../lib/api';
import { Modpack, ModpackInstallation } from '../lib/types';
import { toast } from 'sonner';

interface Props {
  appId: string;
}

export const ModpackBrowser = ({ appId }: Props) => {
  const [query, setQuery] = useState('');
  const [platform, setPlatform] = useState('all');
  const [results, setResults] = useState<Modpack[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [confirmModpack, setConfirmModpack] = useState<Modpack | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installations, setInstallations] = useState<ModpackInstallation[]>([]);

  useEffect(() => {
    loadInstallations();
  }, [appId]);

  const loadInstallations = async () => {
    try {
      const data = await apiClient.getModpackInstallationStatus(appId);
      setInstallations(data);
    } catch {}
  };

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const data = await apiClient.searchModpacks(query, platform);
      setResults(data);
    } catch {
      toast.error('Failed to search modpacks');
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async () => {
    if (!confirmModpack) return;
    setInstalling(true);
    try {
      await apiClient.installModpack(appId, confirmModpack.id, confirmModpack.platform);
      toast.success('Installation started');
      setConfirmModpack(null);
      setTimeout(loadInstallations, 1000);
    } catch {
      toast.error('Failed to start installation');
    } finally {
      setInstalling(false);
    }
  };

  const formatDownloads = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
    return n.toString();
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-500';
      case 'failed': return 'text-red-500';
      case 'downloading':
      case 'installing': return 'text-yellow-500';
      default: return 'text-slate-400';
    }
  };

  const latestInstallation = installations[0];

  return (
    <div className="space-y-6">
      {/* Search Bar */}
      <div className="flex gap-3">
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
        >
          <option value="all">All</option>
          <option value="curseforge">CurseForge</option>
          <option value="modrinth">Modrinth</option>
        </select>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Search modpacks..."
          className="flex-1 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
        />
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </div>

      {/* Installation Progress */}
      {latestInstallation && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-slate-900 dark:text-white">
              Latest installation: {latestInstallation.modpackId}
            </span>
            <span className={`text-sm font-medium ${statusIcon(latestInstallation.status)}`}>
              {latestInstallation.status.charAt(0).toUpperCase() + latestInstallation.status.slice(1)}
            </span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
            <div
              className="bg-purple-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${latestInstallation.progress}%` }}
            />
          </div>
          {latestInstallation.error && (
            <p className="text-sm text-red-500 mt-1">{latestInstallation.error}</p>
          )}
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="text-center py-8 text-slate-500">Searching modpacks...</div>
      ) : searched && results.length === 0 ? (
        <div className="text-center py-8 text-slate-500">No modpacks found</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {results.map((modpack) => (
            <div
              key={modpack.id}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 flex gap-4"
            >
              {modpack.iconUrl && (
                <img
                  src={modpack.iconUrl}
                  alt=""
                  className="w-16 h-16 rounded-lg object-cover flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium text-slate-900 dark:text-white truncate">
                      {modpack.name}
                    </h3>
                    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${
                      modpack.platform === 'curseforge'
                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
                        : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                    }`}>
                      {modpack.platform}
                    </span>
                  </div>
                  <span className="text-sm text-slate-500 whitespace-nowrap">
                    {formatDownloads(modpack.downloads)} downloads
                  </span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                  {modpack.summary}
                </p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {modpack.minecraftVersions.slice(0, 3).map((v) => (
                    <span key={v} className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full">
                      {v}
                    </span>
                  ))}
                  {modpack.loaders.slice(0, 2).map((l) => (
                    <span key={l} className="text-xs px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">
                      {l}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => setConfirmModpack(modpack)}
                  className="mt-2 text-sm text-purple-600 hover:text-purple-700 dark:text-purple-400 font-medium"
                >
                  Install
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmModpack && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-slate-800 rounded-lg p-6 max-w-md mx-4">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white mb-2">
              Install Modpack
            </h3>
            <p className="text-slate-600 dark:text-slate-400 mb-4">
              Install <strong>{confirmModpack.name}</strong> ({confirmModpack.platform}) into this server?
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmModpack(null)}
                disabled={installing}
                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleInstall}
                disabled={installing}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
              >
                {installing ? 'Installing...' : 'Confirm Install'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
