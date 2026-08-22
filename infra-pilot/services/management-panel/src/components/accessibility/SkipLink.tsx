import { useIntl } from 'react-intl';

export const SkipLink = () => {
  const intl = useIntl();
  const label = intl.formatMessage({ id: 'a11y.skipLink' });

  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-blue-600 focus:text-white focus:rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
    >
      {label}
    </a>
  );
};
