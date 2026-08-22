import { useLocation } from 'react-router';
import { FormattedMessage, useIntl } from 'react-intl';
import { MaintenanceScheduler } from '../components/MaintenanceScheduler';
import { AlertConfig } from '../components/AlertConfig';
import { AlertHistory } from '../components/AlertHistory';
import { TwoFactorSetup } from '../components/TwoFactorSetup';
import MetricsConfig from '../components/MetricsConfig';
import { LanguageSelector } from '../i18n/LanguageSelector';

export const SettingsPage = () => {
  const location = useLocation();
  const intl = useIntl();
  const isAlerts = location.pathname.includes('/settings/alerts');
  const isMaintenance = location.pathname.includes('/settings/maintenance');

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2"><FormattedMessage id="settings.title" /></h1>
          <p className="text-slate-400">
            {isAlerts ? intl.formatMessage({ id: 'nav.alerts' }) :
             isMaintenance ? intl.formatMessage({ id: 'nav.maintenance' }) :
             intl.formatMessage({ id: 'settings.general' })}
          </p>
        </div>
      </div>

      {isAlerts ? (
        <>
          <AlertConfig />
          <AlertHistory />
        </>
      ) : isMaintenance ? (
        <MaintenanceScheduler />
      ) : (
        <div className="space-y-6">
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4"><FormattedMessage id="settings.general" /></h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1"><FormattedMessage id="settings.displayName" /></label>
                <input
                  type="text"
                  value="Admin"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1"><FormattedMessage id="settings.email" /></label>
                <input
                  type="email"
                  value="admin@example.com"
                  className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm text-white outline-none focus:border-blue-500"
                />
              </div>
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded transition-colors">
                <FormattedMessage id="settings.saveChanges" />
              </button>
            </div>
            <div className="mt-6 pt-6 border-t border-slate-700">
              <LanguageSelector />
            </div>
          </div>

          <TwoFactorSetup />

          <MetricsConfig />

          <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Configuration Management</h2>
            <p className="text-sm text-slate-400 mb-4">
              To manage configuration versions, go to an app's detail page and use the Config Version Control panel.
            </p>
            <p className="text-sm text-slate-500">
              Configuration versioning allows you to snapshot, browse, and rollback app configurations.
            </p>
          </div>

          <MaintenanceScheduler />
        </div>
      )}
    </div>
  );
};

export default SettingsPage;
