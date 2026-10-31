import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useLive } from './live.jsx';

export function useQuery(path, { topics = [], enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const { listen } = useLive();
  const latest = useRef(0);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!enabled || !path) return;
    const ticket = ++latest.current;
    if (!silent) setLoading(true);
    try {
      const result = await api.get(path);
      if (ticket === latest.current) { setData(result); setError(null); }
    } catch (err) {
      if (ticket === latest.current) setError(err);
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [path, enabled]);

  useEffect(() => { load(); }, [load]);

  const topicKey = topics.join(',');
  useEffect(() => {
    if (!topicKey) return undefined;
    let timer;
    const off = listen((event) => {
      if (!topicKey.split(',').includes(event.topic)) return;
      clearTimeout(timer);
      timer = setTimeout(() => load({ silent: true }), 250);
    });
    return () => { off(); clearTimeout(timer); };
  }, [topicKey, listen, load]);

  return { data, error, loading, reload: load, setData };
}
