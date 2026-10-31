import { useEffect, useState } from 'react';
import { api, qs } from '../api/client.js';
import { Field } from './ui.jsx';

export default function CustomerPicker({ value, initialName, onChange, error }) {
  const [q, setQ] = useState('');
  const [options, setOptions] = useState(value && initialName ? [{ id: value, name: initialName }] : []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.get(`/users${qs({ role: 'customer', q, limit: 20 })}`)
        .then((res) => setOptions((prev) => {
          const selected = prev.find((o) => String(o.id) === String(value));
          const list = res.data;
          return selected && !list.some((o) => o.id === selected.id) ? [selected, ...list] : list;
        }))
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Field label="Customer" error={error}>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input className="input" type="search" placeholder="Search customers…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" style={{ maxWidth: '45%' }} />
        <select className={`input ${error ? 'invalid' : ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label="Customer">
          <option value="">Select a customer</option>
          {options.map((c) => <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ''}</option>)}
        </select>
      </div>
    </Field>
  );
}
