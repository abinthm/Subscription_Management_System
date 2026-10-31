import { api } from '../api/client.js';
import { useAuth } from '../hooks/auth.jsx';
import { useToast } from '../hooks/toast.jsx';
import { Card, PageHead, Input, FormError, useForm } from '../components/ui.jsx';
import { PasswordRules } from './auth/AuthPages.jsx';

function PasswordForm() {
  const notify = useToast();
  const form = useForm({ current_password: '', new_password: '' });
  const onSubmit = form.submit(async (v) => {
    const res = await api.post('/auth/change-password', v);
    form.setValues({ current_password: '', new_password: '' });
    notify(res.message);
  });
  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <FormError error={form.formError} />
      <Input label="Current password" type="password" autoComplete="current-password" {...form.bind('current_password')} />
      <div>
        <Input label="New password" type="password" autoComplete="new-password" {...form.bind('new_password')} />
        <PasswordRules value={form.values.new_password} />
      </div>
      <div className="full form-actions"><button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Change password'}</button></div>
    </form>
  );
}

export default function Profile() {
  const { user, setUser } = useAuth();
  const notify = useToast();
  const form = useForm({ name: user.name, phone: user.phone ?? '', address: user.address ?? '' });

  return (
    <>
      <PageHead title="Profile" subtitle={user.email} />
      <div className="stack">
        <Card title="Contact details">
          <form className="form-grid" onSubmit={form.submit(async (v) => { setUser(await api.put('/users/me', v)); notify('Profile saved'); })} noValidate>
            <FormError error={form.formError} />
            <Input label="Name" {...form.bind('name')} />
            <Input label="Phone" {...form.bind('phone')} />
            <Input label="Billing address" className="full" {...form.bind('address')} />
            <div className="full form-actions"><button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Save'}</button></div>
          </form>
        </Card>
        <Card title="Password"><PasswordForm /></Card>
      </div>
    </>
  );
}
