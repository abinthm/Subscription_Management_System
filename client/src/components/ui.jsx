import { useEffect, useState } from 'react';
import { ApiError } from '../api/client.js';
import { STATUS_TONE, label } from '../lib.js';

export function PageHead({ title, subtitle, crumb, children }) {
  return (
    <div className="page-head">
      <div>
        {crumb && <div className="breadcrumb">{crumb}</div>}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', flush = false }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {flush ? children : <div className="card-body">{children}</div>}
    </section>
  );
}

export function Badge({ tone = '', children }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export const StatusBadge = ({ status }) => <Badge tone={STATUS_TONE[status]}>{label(status)}</Badge>;

export function Field({ label: text, error, help, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span>{text}</span>
      {children}
      {error ? <small className="err">{error}</small> : help && <small className="help">{help}</small>}
    </label>
  );
}

export function Input({ label: text, error, help, className, ...props }) {
  return (
    <Field label={text} error={error} help={help} className={className}>
      <input className={`input ${error ? 'invalid' : ''}`} aria-invalid={Boolean(error)} {...props} />
    </Field>
  );
}

export function Select({ label: text, error, help, options, placeholder, className, ...props }) {
  return (
    <Field label={text} error={error} help={help} className={className}>
      <select className={`input ${error ? 'invalid' : ''}`} aria-invalid={Boolean(error)} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

export function Checkbox({ label: text, ...props }) {
  return (
    <label className="check">
      <input type="checkbox" {...props} />
      {text}
    </label>
  );
}

export const Spinner = () => <div className="center"><div className="spinner" aria-label="Loading" /></div>;

export function ErrorState({ error, onRetry }) {
  return (
    <div className="empty">
      <h3>{error.status === 404 ? 'Not found' : 'Could not load this'}</h3>
      <p>{error.message}</p>
      {onRetry && <button type="button" className="btn" onClick={() => onRetry()}>Try again</button>}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function Loadable({ query, children }) {
  if (query.error && !query.data) return <ErrorState error={query.error} onRetry={query.reload} />;
  if (!query.data) return <Spinner />;
  return children(query.data);
}

export function Pager({ page, pages, total, onPage }) {
  if (!total) return null;
  return (
    <div className="pager">
      <span>{total.toLocaleString()} records</span>
      <div className="row">
        <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span>Page {page} of {Math.max(pages, 1)}</span>
        <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function Modal({ title, onClose, wide, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-head">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="card-body">{children}</div>
      </div>
    </div>
  );
}

export function FormError({ error }) {
  if (!error) return null;
  return <div className="alert alert-error full" role="alert">{error}</div>;
}

export function useForm(initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (key) => (e) => {
    const value = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((er) => (er[key] ? { ...er, [key]: undefined } : er));
  };

  const submit = (fn) => async (e) => {
    e?.preventDefault();
    setBusy(true);
    setFormError('');
    setErrors({});
    try {
      await fn(values);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.details).length) setErrors(err.details);
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const bind = (key) => ({ value: values[key] ?? '', onChange: set(key), error: errors[key], name: key });

  return { values, setValues, set, errors, formError, busy, submit, bind };
}

export function SearchBox({ value, onChange, placeholder = 'Search…' }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  useEffect(() => {
    if (text === (value ?? '')) return undefined;
    const t = setTimeout(() => onChange(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  return <input className="input search" type="search" placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} aria-label="Search" />;
}
