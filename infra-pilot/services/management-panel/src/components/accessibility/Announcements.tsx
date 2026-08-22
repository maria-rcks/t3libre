import { useEffect, useState } from 'react';

let announcementQueue: string[] = [];
let listener: ((msg: string) => void) | null = null;

export function announce(message: string) {
  if (listener) {
    listener(message);
  } else {
    announcementQueue.push(message);
  }
}

export const Announcements = () => {
  const [message, setMessage] = useState('');

  useEffect(() => {
    listener = setMessage;
    announcementQueue.forEach((m) => setMessage(m));
    announcementQueue = [];
    return () => { listener = null; };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
};
