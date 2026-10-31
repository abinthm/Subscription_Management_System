import { api } from '../api/client.js';
import { useToast } from '../hooks/toast.jsx';
import { Input, Select, FormError, useForm } from './ui.jsx';
import { PASSWORD_RULES } from '../lib.js';

export default function UserForm({ roles, onDone }) {
  const notify = useToast();
  const form = useForm({ name: '', email: '', password: '', role: roles[0], phone: '', address: '' });
  const onSubmit = form.submit(async (v) => {
    const user = await api.post('/users', v);
    notify(`${user.name} added`);
    onDone(user);
  });
  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <FormError error={form.formError} />
      <Input label="Name" autoFocus {...form.bind('name')} />
      <Input label="Email" type="email" {...form.bind('email')} />
      <Input label="Temporary password" type="password" autoComplete="new-password"
        help={PASSWORD_RULES.map(([t]) => t).join(' · ')} {...form.bind('password')} />
      {roles.length > 1
        ? <Select label="Role" options={roles.map((r) => ({ value: r, label: r[0].toUpperCase() + r.slice(1) }))} {...form.bind('role')} />
        : <Input label="Phone" {...form.bind('phone')} />}
      {roles.length === 1 && <Input label="Address" className="full" {...form.bind('address')} />}
      <div className="full form-actions">
        <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
        <button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Add'}</button>
      </div>
    </form>
  );
}
