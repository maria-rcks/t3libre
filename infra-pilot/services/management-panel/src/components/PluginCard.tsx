import { Plugin } from '../lib/types';

interface PluginCardProps {
  plugin: Plugin;
  onInstall: (id: string) => void;
  onUninstall: (id: string) => void;
  installing?: string;
  uninstalling?: string;
}

export const PluginCard = ({ plugin, onInstall, onUninstall, installing, uninstalling }: PluginCardProps) => {
  const getCategoryColor = (cat: string) => {
    const colors: Record<string, string> = {
      performance: 'bg-green-500/20 text-green-400 border-green-500/30',
      security: 'bg-red-500/20 text-red-400 border-red-500/30',
      backup: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      monitoring: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      logging: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      scaling: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
      configuration: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
      integration: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
    };
    return colors[cat] || 'bg-slate-500/20 text-slate-400 border-slate-500/30';
  };

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition-colors flex flex-col">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          {plugin.iconUrl ? (
            <img src={plugin.iconUrl} alt="" className="w-10 h-10 rounded-lg shrink-0" />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center text-slate-400 text-lg shrink-0">
              {plugin.name[0]}
            </div>
          )}
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-white truncate">{plugin.name}</h4>
            <p className="text-xs text-slate-400">v{plugin.version} by {plugin.author}</p>
          </div>
        </div>
        <span className={`px-2 py-0.5 text-xs rounded border shrink-0 ${getCategoryColor(plugin.category)}`}>
          {plugin.category}
        </span>
      </div>

      <p className="text-xs text-slate-400 mb-3 line-clamp-2 flex-1">{plugin.description}</p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{plugin.downloads.toLocaleString()} downloads</span>
          {plugin.installed && (
            <span className="text-green-400">Installed</span>
          )}
        </div>

        {plugin.installed ? (
          <button
            onClick={() => onUninstall(plugin.id)}
            disabled={uninstalling === plugin.id}
            className="px-3 py-1 text-xs bg-red-600 hover:bg-red-700 disabled:bg-slate-600 text-white rounded transition-colors"
          >
            {uninstalling === plugin.id ? 'Removing...' : 'Uninstall'}
          </button>
        ) : (
          <button
            onClick={() => onInstall(plugin.id)}
            disabled={installing === plugin.id}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-700 disabled:bg-slate-600 text-white rounded transition-colors"
          >
            {installing === plugin.id ? 'Installing...' : 'Install'}
          </button>
        )}
      </div>
    </div>
  );
};
