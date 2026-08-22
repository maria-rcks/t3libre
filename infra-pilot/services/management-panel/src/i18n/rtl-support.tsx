import { useEffect, type ReactNode } from 'react';
import { useI18n } from './index';

export const RTLProvider = ({ children }: { children: ReactNode }) => {
  const { direction } = useI18n();

  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.setAttribute('data-direction', direction);
  }, [direction]);

  return <>{children}</>;
};
