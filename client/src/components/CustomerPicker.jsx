import { useEffect, useId, useRef, useState } from 'react';
import { api, qs } from '../api/client.js';
import { Field } from './ui.jsx';

export default function CustomerPicker({ value, initialName = '', onChange, error }) {
  const [text, setText] = useState(initialName);
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const listId = useId();
  const latest = useRef(0);

  useEffect(() => setText(initialName), [initialName]);
  useEffect(() => {
    if (!value) setText((t) => (open ? t : ''));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const ticket = ++latest.current;
    setLoading(true);
    const t = setTimeout(() => {
      api.get(`/users${qs({ role: 'customer', q: text.trim(), limit: 8 })}`)
        .then((res) => {
          if (ticket !== latest.current) return;
          setOptions(res.data);
          setActive(0);
        })
        .catch(() => ticket === latest.current && setOptions([]))
        .finally(() => ticket === latest.current && setLoading(false));
    }, 200);
    return () => clearTimeout(t);
  }, [text, open]);

  const choose = (customer) => {
    onChange(String(customer.id));
    setText(customer.name);
    setOpen(false);
  };

  const onType = (e) => {
    setText(e.target.value);
    setOpen(true);
    if (value) onChange('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open && options[active]) {
      e.preventDefault();
      choose(options[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <Field label="Customer" error={error}>
      <div className="combo">
        <input
          className={`input ${error ? 'invalid' : ''}`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${options[active].id}` : undefined}
          placeholder="Search by name or email…"
          value={text}
          onChange={onType}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />
        {value && <span className="combo-check" aria-hidden="true">✓</span>}
        {open && (
          <ul className="combo-list" id={listId} role="listbox">
            {options.map((c, i) => (
              <li
                key={c.id}
                id={`${listId}-${c.id}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); choose(c); }}
                onMouseEnter={() => setActive(i)}
              >
                <span>{c.name}</span>
                <span className="muted small">{c.email}</span>
              </li>
            ))}
            {!options.length && <li className="combo-empty">{loading ? 'Searching…' : 'No customers match'}</li>}
          </ul>
        )}
      </div>
    </Field>
  );
}
