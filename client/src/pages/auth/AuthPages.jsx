import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth } from '../../hooks/auth.jsx';
import { Input, FormError, useForm } from '../../components/ui.jsx';
import { PASSWORD_RULES } from '../../lib.js';

function AuthFrame({ title, subtitle, children }) {
  return (
    <div className="auth">
      <div className="auth-art">
        <div className="logo" style={{ color: '#fff', padding: 0 }}><span className="logo-mark" style={{ borderColor: '#fff' }} />Brightloop</div>
        <div>
          <h2>Plans, subscriptions and recurring billing in one place.</h2>
          <p>Quotes become subscriptions, invoices write themselves on billing day, and every payment lands against the right invoice.</p>
        </div>
        <p className="small">© Brightloop Software</p>
      </div>
      <div className="auth-panel">
        <div className="auth-card">
          <h1>{title}</h1>
          {subtitle && <p className="muted" style={{ margin: 0 }}>{subtitle}</p>}
          {children}
        </div>
      </div>
    </div>
  );
}

export function PasswordRules({ value }) {
  return (
    <ul className="pw-rules" aria-label="Password requirements">
      {PASSWORD_RULES.map(([text, test]) => <li key={text} className={test(value) ? 'ok' : ''}>{text}</li>)}
    </ul>
  );
}

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const form = useForm({ email: '', password: '' });

  return (
    <AuthFrame title="Welcome back" subtitle="Sign in to manage subscriptions and billing.">
      <form onSubmit={form.submit(async (v) => { await login(v.email, v.password); navigate('/'); })} noValidate>
        <FormError error={form.formError} />
        <Input label="Email" type="email" autoComplete="email" autoFocus required {...form.bind('email')} />
        <Input label="Password" type="password" autoComplete="current-password" required {...form.bind('password')} />
        <div className="right small"><Link to="/forgot-password">Forgot password?</Link></div>
        <button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>New to Brightloop? <Link to="/signup">Create an account</Link></p>
      </form>
    </AuthFrame>
  );
}

export function Signup() {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const form = useForm({ name: '', email: '', password: '', confirm: '' });

  const onSubmit = form.submit(async ({ confirm, ...v }) => {
    if (confirm !== v.password) throw Object.assign(new Error('Passwords do not match'), { details: { confirm: 'Passwords do not match' } });
    await signup(v);
    navigate('/');
  });

  return (
    <AuthFrame title="Create your account" subtitle="See and manage your subscriptions without emailing anyone.">
      <form onSubmit={onSubmit} noValidate>
        <FormError error={form.formError} />
        <Input label="Full name or company" autoComplete="name" autoFocus {...form.bind('name')} />
        <Input label="Email" type="email" autoComplete="email" {...form.bind('email')} />
        <Input label="Password" type="password" autoComplete="new-password" {...form.bind('password')} />
        <PasswordRules value={form.values.password} />
        <Input label="Confirm password" type="password" autoComplete="new-password" {...form.bind('confirm')}
          error={form.errors.confirm ?? (form.values.confirm && form.values.confirm !== form.values.password ? 'Passwords do not match' : undefined)} />
        <button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Creating account…' : 'Create account'}</button>
        <p className="muted small" style={{ textAlign: 'center', margin: 0 }}>Already have an account? <Link to="/login">Sign in</Link></p>
      </form>
    </AuthFrame>
  );
}

export function ForgotPassword() {
  const [sent, setSent] = useState('');
  const form = useForm({ email: '' });

  return (
    <AuthFrame title="Reset your password" subtitle="We will email you a link to choose a new one.">
      <form onSubmit={form.submit(async (v) => setSent((await api.post('/auth/forgot-password', v)).message))} noValidate>
        <FormError error={form.formError} />
        {sent && <div className="alert alert-success">{sent}</div>}
        <Input label="Registered email" type="email" autoComplete="email" autoFocus {...form.bind('email')} />
        <button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Sending…' : 'Send reset link'}</button>
        <p className="muted small" style={{ textAlign: 'center', margin: 0 }}><Link to="/login">Back to sign in</Link></p>
      </form>
    </AuthFrame>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const form = useForm({ password: '' });
  const token = params.get('token') ?? '';

  return (
    <AuthFrame title="Choose a new password">
      <form onSubmit={form.submit(async (v) => { await api.post('/auth/reset-password', { token, ...v }); navigate('/login'); })} noValidate>
        {!token && <div className="alert alert-error">This link is missing its reset token. Request a new one.</div>}
        <FormError error={form.formError} />
        <Input label="New password" type="password" autoComplete="new-password" autoFocus {...form.bind('password')} />
        <PasswordRules value={form.values.password} />
        <button className="btn btn-primary" disabled={form.busy || !token}>{form.busy ? 'Saving…' : 'Update password'}</button>
        <p className="muted small" style={{ textAlign: 'center', margin: 0 }}><Link to="/forgot-password">Request a new link</Link></p>
      </form>
    </AuthFrame>
  );
}
