import { Component, useEffect, useState, useCallback, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { IntlProvider } from 'react-intl';
import { Toaster } from 'sonner';
import { apiClient } from './lib/api';
import { apiClientEffect, useEffectful } from './lib/effect';
import { getAccessToken } from './lib/auth';
import { ConfigContext, SetupMode } from './lib/types';
import { Setup } from './pages/Setup';
import { Dashboard } from './pages/Dashboard';
import Customers from './pages/Customers';
import { AppForm } from './pages/AppForm';
import { AppDetail } from './pages/AppDetail';
import { Monitoring } from './pages/Monitoring';
import { AccessLogs } from './pages/AccessLogs';
import { Backups } from './pages/Backups';
import { Reports } from './pages/Reports';
import { SettingsPage } from './pages/Settings';
import { AuditLog } from './pages/AuditLog';
import { KnowledgeBase } from './pages/KnowledgeBase';
import { ActivityFeed } from './components/ActivityFeed';
import { MainLayout } from './components/MainLayout';
import { OnboardingWizard } from './components/OnboardingWizard';
import { GlobalSearch } from './components/GlobalSearch';
import { featureGates } from './lib/types';
import { I18nContext } from './i18n/index';
import { detectBrowserLocale, type SupportedLocale } from './i18n/locale-detector';
import { isRTL } from './i18n/locale-detector';
import { RTLProvider } from './i18n/rtl-support';
import { SkipLink } from './components/accessibility/SkipLink';
import { KeyboardShortcuts } from './components/accessibility/KeyboardShortcuts';
import en from './i18n/en.json';
import de from './i18n/de.json';
import zh from './i18n/zh.json';
import es from './i18n/es.json';
import fr from './i18n/fr.json';
import ja from './i18n/ja.json';
import pt from './i18n/pt.json';
import ru from './i18n/ru.json';
import ar from './i18n/ar.json';
import ko from './i18n/ko.json';
import tr from './i18n/tr.json';

const messages: Record<string, Record<string, string>> = {
  en, de, zh, es, fr, ja, pt, ru, ar, ko, tr,
};

/** Simple loading/fallback logo component */
const SimpleLogo = ({ size = 64 }: { size?: number }) => (
  <div
    className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center text-white font-bold text-3xl"
    style={{ width: size, height: size }}
  >
    IP
  </div>
);

/**
 * Error boundary to catch rendering errors and display a fallback UI.
 */
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
          <div className="text-center p-8">
            <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
            <p className="text-slate-400 mb-4">{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button
              className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload(); }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Root application component.
 * Handles setup mode detection, authentication, locale, theme, and routing.
 */
export default function App() {
  const [mode, setMode] = useState<SetupMode>('personal');
  const [authenticated, setAuthenticated] = useState(false);
  const [locale, setLocaleState] = useState<SupportedLocale>(detectBrowserLocale());

  const { data: status, loading } = useEffectful(
    () => apiClientEffect.getSetupStatus(),
    []
  );
  const initialized = status ? status.initialized : false;

  const setLocale = useCallback((l: SupportedLocale) => {
    setLocaleState(l);
    localStorage.setItem('locale', l);
  }, []);

  const direction = useMemo(() => isRTL(locale) ? 'rtl' : 'ltr', [locale]);
  const i18nCtx = useMemo(() => ({ locale, setLocale, direction }), [locale, setLocale, direction]);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  useEffect(() => {
    if (!status) return;
    if (status.initialized) {
      setMode(status.mode as SetupMode);
      const token = getAccessToken();
      if (token) {
        apiClient.setToken(token);
        setAuthenticated(true);
      }
    }
  }, [status]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <SimpleLogo size={64} />
          <p className="text-slate-400 mt-4">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
    <IntlProvider messages={messages[locale]} locale={locale} defaultLocale="en">
      <I18nContext.Provider value={i18nCtx}>
        <RTLProvider>
          <ConfigContext.Provider value={{ mode, loading: false }}>
            <BrowserRouter>
              <SkipLink />
              <KeyboardShortcuts />
              <Routes>
                {!initialized ? (
                  <Route path="*" element={<Setup />} />
                ) : !authenticated ? (
                  <Route path="*" element={<Navigate to="/setup" replace />} />
                  ) : (
                    <Route element={<MainLayout />}>
                      <Route path="/dashboard" element={<Dashboard />} />
                      <Route path="/monitoring" element={<Monitoring />} />
                      <Route path="/apps/new" element={<AppForm />} />
                      <Route path="/apps/:appId" element={<AppDetail />} />
                      <Route path="/apps/:appId/edit" element={<AppForm />} />
                      <Route path="/logs/access" element={<AccessLogs />} />
                      <Route path="/backups" element={<Backups />} />
                      <Route path="/reports" element={<Reports />} />
                      <Route path="/audit" element={<AuditLog />} />
                      <Route path="/activity" element={<ActivityFeed limit={50} />} />
                      <Route path="/knowledge-base" element={<KnowledgeBase />} />
                      <Route path="/knowledge-base/:articleId" element={<KnowledgeBase />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="/settings/alerts" element={<SettingsPage />} />
                      <Route path="/settings/maintenance" element={<SettingsPage />} />
                      {featureGates.canManageCustomers(mode) && (
                        <Route path="/customers" element={<Customers />} />
                      )}
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Route>
                  )}
              </Routes>
              <OnboardingWizard />
              <GlobalSearch />
            </BrowserRouter>
            <Toaster />
          </ConfigContext.Provider>
        </RTLProvider>
      </I18nContext.Provider>
    </IntlProvider>
    </ErrorBoundary>
  );
}
