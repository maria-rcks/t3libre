import React from 'react';

export const LogoVariantToggle: React.FC = () => {
  const apply = (val: string) => {
    localStorage.setItem('branding_logo_variant', val);
    // force reload of image by toggling a dummy attribute on body
    document.body.setAttribute('data-brand-variant', val);
    // trigger a re-render by dispatching a storage event (for simple demo)
    window.dispatchEvent(new Event('branding-variant-changed'));
  };

  const current = typeof window !== 'undefined' ? (localStorage.getItem('branding_logo_variant') ?? 'default') : 'default';
  return (
    <div className="inline-flex items-center space-x-2" aria-label="Brand logo variant selector">
      <span className="text-xs text-gray-600 dark:text-gray-300">Logo</span>
      <button
        className={`px-2 py-1 rounded border text-sm ${current === 'default' ? 'border-brand-primary text-brand-primary' : 'border-gray-400'}`}
        onClick={() => apply('default')}
        aria-pressed={current === 'default'}
      >
        Default
      </button>
      <button
        className={`px-2 py-1 rounded border text-sm ${current === 'alt' ? 'border-brand-primary text-brand-primary' : 'border-gray-400'}`}
        onClick={() => apply('alt')}
        aria-pressed={current === 'alt'}
      >
        Alt
      </button>
    </div>
  );
};

export default LogoVariantToggle;
