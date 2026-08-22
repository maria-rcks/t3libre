import { BackupManager } from '../components/BackupManager';
import { BackupStatus } from '../components/BackupStatus';

export const Backups = () => {
  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Backups</h1>
          <p className="text-slate-400">Database and server backup automation</p>
        </div>
      </div>

      <BackupStatus />
      <BackupManager />
    </div>
  );
};

export default Backups;
