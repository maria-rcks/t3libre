import React from 'react';

export const NavBar: React.FC = () => {
  const items = [
    { label: "Dashboard", tour: "monitoring" },
    { label: "Servers", tour: "apps" },
    { label: "Settings", tour: "settings" },
  ];
  return (
    <nav className="hidden md:flex justify-center gap-6 border-b bg-white/90 dark:bg-gray-900/90 px-4 py-2">
      {items.map((it) => (
        <a key={it.label} href="#" data-tour={it.tour} className="text-sm font-medium text-gray-700 hover:text-brand-primary">
          {it.label}
        </a>
      ))}
    </nav>
  );
};

export default NavBar;
