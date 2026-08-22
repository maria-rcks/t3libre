import { useState, useEffect } from 'react';
import { SystemGauge } from './SystemGauge';

interface ResourceData {
  cpu: number;
  memory: { used: number; total: number };
  disk: { used: number; total: number };
  network: { rx: number; tx: number };
}

export const ResourceMonitor = () => {
  const [data] = useState<ResourceData>({
    cpu: Math.floor(Math.random() * 60) + 10,
    memory: { used: Math.floor(Math.random() * 8) + 2, total: 16 },
    disk: { used: Math.floor(Math.random() * 100) + 50, total: 250 },
    network: { rx: Math.floor(Math.random() * 500) + 100, tx: Math.floor(Math.random() * 200) + 50 },
  });

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-white">Resource Monitoring</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <SystemGauge label="CPU Usage" value={data.cpu} max={100} unit="%" color="blue" />
        <SystemGauge label="Memory" value={data.memory.used} max={data.memory.total} unit="GB" color="purple" />
        <SystemGauge label="Disk" value={data.disk.used} max={data.disk.total} unit="GB" color="cyan" />
        <SystemGauge label="Network RX" value={data.network.rx} max={1000} unit="KB/s" color="green" />
      </div>
    </div>
  );
};

export default ResourceMonitor;
