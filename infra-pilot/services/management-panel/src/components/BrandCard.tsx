import React from 'react';

type Props = {
  title: string;
  children?: React.ReactNode;
};

export const BrandCard: React.FC<Props> = ({ title, children }) => {
  return (
    <div className="skeuo-card rounded-xl p-6">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <div className="text-sm text-gray-600 dark:text-gray-300">{children}</div>
    </div>
  );
};

export default BrandCard;
