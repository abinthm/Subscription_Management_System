import { useSearchParams } from 'react-router-dom';

export function useFilters(defaults = {}) {
  const [params, setParams] = useSearchParams();
  const filters = { page: '1', ...defaults, ...Object.fromEntries(params) };

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === '' || value === null || value === undefined || value === false) next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  return [filters, setFilter];
}
