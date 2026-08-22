import React from 'react';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
};

export const BrandButton: React.FC<Props> = ({ label, ...rest }) => {
  return (
    <button
      className="px-4 py-2 rounded-md bg-gradient-to-b from-brand-primary to-brand-primary-dark text-white transition-all shadow-[0_8px_16px_rgba(37,99,235,0.35),inset_0_1px_0_rgba(255,255,255,0.35)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-[inset_0_2px_6px_rgba(15,23,42,0.35)]"
      {...rest}
    >
      {label}
    </button>
  );
};

export default BrandButton;
