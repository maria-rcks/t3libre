import React from 'react';

type Props = {
  text: string;
  children: React.ReactNode;
};

export const Tooltip: React.FC<Props> = ({ text, children }) => {
  return (
    <span className="tooltip inline-block">
      {children}
      <span className="tooltiptext">{text}</span>
    </span>
  );
};

export default Tooltip;
