import React from 'react';

// Global Demo flag badge: indicates if the per-env demo feature is enabled.
export const DemoFlagBadge: React.FC = () => {
  // Read from frontend env (set by Vite at build/start time)
  const enabled = (import.meta?.env?.VITE_DEMO_FEATURE_ENABLED === 'true') as boolean;
  const label = enabled ? 'Demo: On' : 'Demo: Off';
  const className = enabled
    ? 'bg-green-100 text-green-700'
    : 'bg-gray-100 text-gray-700';
  return (
    <span
      className={`text-xs px-3 py-1 rounded-full ${className}`}
      title={enabled ? 'Demo features enabled' : 'Demo features disabled'}
      style={{ display: 'inline-flex', alignItems: 'center' }}
    >
      {label}
    </span>
  );
};

export default DemoFlagBadge;
