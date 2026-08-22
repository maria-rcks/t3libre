import React from 'react';

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
};

export const BrandInput: React.FC<Props> = ({ label, ...rest }) => {
  return (
    <div>
      {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
      <input className="w-full px-3 py-2 rounded-md border-2 border-slate-200 focus:outline-none focus:border-brand-accent" {...rest} />
    </div>
  );
};

export default BrandInput;
