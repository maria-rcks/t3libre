interface AppCardProps {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'restarting' | 'error';
  cpu: number;
  memory: number;
  uptime?: string;
  ports?: Array<{ hostPort: number; containerPort: number; protocol: string }>;
  onClick?: () => void;
}

export const AppCard = ({
  id,
  name,
  image,
  status,
  cpu,
  memory,
  uptime = '3d 14h',
  ports = [],
  onClick,
}: AppCardProps) => {
  const getStatusColor = () => {
    switch (status) {
      case 'running':
        return {
          bg: 'bg-green-500/10',
          text: 'text-green-400',
          dot: 'bg-green-500',
        };
      case 'stopped':
        return {
          bg: 'bg-gray-500/10',
          text: 'text-gray-400',
          dot: 'bg-gray-500',
        };
      case 'restarting':
        return {
          bg: 'bg-yellow-500/10',
          text: 'text-yellow-400',
          dot: 'bg-yellow-500 animate-pulse',
        };
      case 'error':
        return {
          bg: 'bg-red-500/10',
          text: 'text-red-400',
          dot: 'bg-red-500 animate-pulse',
        };
      default:
        return {
          bg: 'bg-slate-500/10',
          text: 'text-slate-400',
          dot: 'bg-slate-500',
        };
    }
  };

  const statusColor = getStatusColor();

  const getAppIcon = () => {
    if (image.includes('postgres') || image.includes('mysql'))
      return '🗄️';
    if (image.includes('redis')) return '💾';
    if (image.includes('nginx') || image.includes('httpd')) return '🌐';
    if (image.includes('node')) return '📦';
    if (image.includes('python')) return '🐍';
    if (image.includes('java')) return '☕';
    return '🐳';
  };

  return (
    <div
      onClick={onClick}
      className="bg-slate-800 border border-slate-700 rounded-lg p-6 hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/20 transition-all cursor-pointer group"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 flex-1">
          <div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center text-lg group-hover:bg-blue-600/20 transition-colors">
            {getAppIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white truncate">{name}</h3>
            <p className="text-xs text-slate-400 truncate">{image}</p>
          </div>
        </div>

        {/* Status Badge */}
        <div className={`${statusColor.bg} ${statusColor.text} px-3 py-1 rounded-full flex items-center gap-2 flex-shrink-0`}>
          <span className={`w-2 h-2 rounded-full ${statusColor.dot}`}></span>
          <span className="text-xs font-semibold">{status}</span>
        </div>
      </div>

      {/* Uptime */}
      {status === 'running' && (
        <p className="text-xs text-slate-400 mb-4">Uptime: {uptime}</p>
      )}

      {/* Resource Usage */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* CPU */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-slate-400">CPU</span>
            <span className="text-sm font-semibold text-white">{cpu}%</span>
          </div>
          <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-blue-600"
              style={{ width: `${cpu}%` }}
            ></div>
          </div>
        </div>

        {/* Memory */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-slate-400">MEM</span>
            <span className="text-sm font-semibold text-white">{memory}MB</span>
          </div>
          <div className="w-full h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-purple-500 to-purple-600"
              style={{ width: `${Math.min(memory / 2, 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Ports */}
      {ports.length > 0 && (
        <div className="border-t border-slate-700 pt-3">
          <p className="text-xs text-slate-400 mb-2">Ports:</p>
          <div className="flex flex-wrap gap-1">
            {ports.slice(0, 2).map((port, idx) => (
              <span
                key={idx}
                className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded"
              >
                {port.hostPort}:{port.containerPort}
              </span>
            ))}
            {ports.length > 2 && (
              <span className="text-xs bg-slate-700 text-slate-400 px-2 py-1 rounded">
                +{ports.length - 2}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
