import React, { useEffect, useState } from 'react';

type Mode = 'system' | 'light' | 'dark';

export const ThemeModeSelector: React.FC = () => {
  const [mode, setMode] = useState<Mode>(() => {
    if (typeof window === 'undefined') return 'system';
    return (localStorage.getItem('infra_pilot_theme_mode') as Mode) ?? 'system';
  });

  // Apply theme based on mode
  const applyMode = (m: Mode) => {
    localStorage.setItem('infra_pilot_theme_mode', m);
    if (m === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq.matches) document.documentElement.classList.add('dark'); else document.documentElement.classList.remove('dark');
    } else if (m === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  useEffect(() => {
    applyMode(mode);
  }, []);

  useEffect(() => {
    const handler = () => setMode(localStorage.getItem('infra_pilot_theme_mode') as Mode || 'system');
    window.addEventListener('branding-variant-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('branding-variant-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const onChange = (val: Mode) => {
    setMode(val);
    applyMode(val);
  };

  return (
    <div className="inline-flex items-center space-x-1" aria-label="Theme mode selector">
      <select
        aria-label="Theme mode"
        value={mode}
        onChange={(e) => onChange(e.target.value as Mode)}
        className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 text-sm rounded px-2 py-1"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  );
};

export default ThemeModeSelector;
