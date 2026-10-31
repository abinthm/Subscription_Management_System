import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useFilters(defaults = {}) {
  const [params, setParams] = useSearchParams();
  const filters = { ...defaults, ...Object.fromEntries(params) };

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === '' || value === null || value === undefined || value === false) next.delete(key);
    else next.set(key, value);
    if (key !== 'cursor') next.delete('cursor');
    setParams(next, { replace: true });
  };

  return [filters, setFilter];
}

export function usePaging(filters, setFilter) {
  const [trail, setTrail] = useState([]);
  const total = useRef(null);
  const { cursor, ...rest } = filters;
  const key = JSON.stringify(rest);

  useEffect(() => {
    setTrail([]);
    total.current = null;
  }, [key]);

  return {
    page: trail.length + 1,
    total: (res) => {
      if (res.total !== null) total.current = { value: res.total, capped: res.total_capped };
      return total.current;
    },
    next: (nextCursor) => {
      setTrail((t) => [...t, cursor ?? '']);
      setFilter('cursor', nextCursor);
    },
    prev: () => {
      setFilter('cursor', trail.at(-1) || '');
      setTrail((t) => t.slice(0, -1));
    },
  };
}
