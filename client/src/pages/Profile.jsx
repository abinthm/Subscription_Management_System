import { api } from '../api/client.js';
import { useAuth } from '../hooks/auth.jsx';
import { useToast } from '../hooks/toast.jsx';
import { Card, PageHead, Input, FormError, useForm } from '../components/ui.jsx';

export default function Profile() {
  const { user, setUser } = useAuth();
  const notify = useToast();
  const form = useForm({ name: user.name, phone: user.phone ?? '', address: user.address ?? '' });

  return (
    <>
      <PageHead title="Profile" subtitle={user.email} />
      <Card title="Contact details">
        <form className="form-grid" onSubmit={form.submit(async (v) => { setUser(await api.put('/users/me', v)); notify('Profile saved'); })} noValidate>
          <FormError error={form.formError} />
          <Input label="Name" {...form.bind('name')} />
          <Input label="Phone" {...form.bind('phone')} />
          <Input label="Billing address" className="full" {...form.bind('address')} />
          <div className="full form-actions"><button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Save'}</button></div>
        </form>
      </Card>
    </>
  );
}
