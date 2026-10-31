import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

const LiveContext = createContext({ connected: false, listen: () => () => {} });

export function LiveProvider({ children }) {
  const listeners = useRef(new Set());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener('change', (e) => {
      const event = JSON.parse(e.data);
      listeners.current.forEach((fn) => fn(event));
    });
    return () => source.close();
  }, []);

  const listen = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  return <LiveContext.Provider value={{ connected, listen }}>{children}</LiveContext.Provider>;
}

export const useLive = () => useContext(LiveContext);
