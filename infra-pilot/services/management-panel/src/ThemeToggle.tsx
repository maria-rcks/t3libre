import { useEffect, useState } from 'react';

export const ThemeToggle: React.FC = () => {
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const toggle = () => setIsDark(prev => !prev);

  return (
    <button onClick={toggle} aria-label="Toggle theme" className="px-3 py-2 rounded bg-brand-primary text-white shadow-sm hover:bg-brand-primary-dark" title="Toggle theme">
      {isDark ? 'Light' : 'Dark'}
    </button>
  );
};

export default ThemeToggle;
