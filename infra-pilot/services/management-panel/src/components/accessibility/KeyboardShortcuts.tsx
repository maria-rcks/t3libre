import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useIntl } from 'react-intl';

const SHORTCUTS: Record<string, { key: string; route: string; description: string }> = {
  'g d': { key: 'g d', route: '/dashboard', description: 'Go to Dashboard' },
  'g m': { key: 'g m', route: '/monitoring', description: 'Go to Monitoring' },
  'g s': { key: 'g s', route: '/settings', description: 'Go to Settings' },
  'g n': { key: 'g n', route: '/apps/new', description: 'New App' },
};

export const KeyboardShortcuts = () => {
  const navigate = useNavigate();
  const intl = useIntl();

  useEffect(() => {
    let buffer = '';
    let timeout: ReturnType<typeof setTimeout>;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const shortcuts = Object.values(SHORTCUTS)
          .map((s) => `${s.key}: ${s.description}`)
          .join(', ');
        const msg = intl.formatMessage({ id: 'a11y.keyboardShortcuts' }) + ': ' + shortcuts;
        return;
      }

      buffer += e.key.toLowerCase();
      clearTimeout(timeout);
      timeout = setTimeout(() => { buffer = ''; }, 1000);

      const match = SHORTCUTS[buffer];
      if (match) {
        e.preventDefault();
        navigate(match.route);
        buffer = '';
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearTimeout(timeout);
    };
  }, [navigate, intl]);

  return null;
};
