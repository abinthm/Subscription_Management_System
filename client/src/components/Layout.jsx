import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/auth.jsx';
import { useLive } from '../hooks/live.jsx';
import { initials } from '../lib.js';
import Icon from './Icon.jsx';

const TEAM_NAV = [
  { label: 'Overview', items: [{ to: '/', icon: 'dashboard', text: 'Dashboard', end: true }] },
  {
    label: 'Sales',
    items: [
      { to: '/subscriptions', icon: 'repeat', text: 'Subscriptions' },
      { to: '/templates', icon: 'template', text: 'Quotation templates' },
      { to: '/customers', icon: 'users', text: 'Customers' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { to: '/invoices', icon: 'file', text: 'Invoices' },
      { to: '/payments', icon: 'wallet', text: 'Payments' },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { to: '/products', icon: 'box', text: 'Products' },
      { to: '/plans', icon: 'layers', text: 'Plans' },
      { to: '/discounts', icon: 'tag', text: 'Discounts' },
      { to: '/taxes', icon: 'percent', text: 'Taxes' },
      { to: '/team', icon: 'shield', text: 'Team', adminOnly: true },
    ],
  },
  { label: 'Account', items: [{ to: '/profile', icon: 'user', text: 'Profile' }] },
];

const CUSTOMER_NAV = [
  {
    label: 'My account',
    items: [
      { to: '/', icon: 'repeat', text: 'Subscriptions', end: true },
      { to: '/subscribe', icon: 'layers', text: 'Start a subscription' },
      { to: '/invoices', icon: 'file', text: 'Invoices' },
      { to: '/payments', icon: 'wallet', text: 'Payments' },
      { to: '/profile', icon: 'user', text: 'Profile' },
    ],
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { connected } = useLive();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => setOpen(false), [location.pathname]);

  const nav = (user.role === 'customer' ? CUSTOMER_NAV : TEAM_NAV)
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.adminOnly || user.role === 'admin') }));

  const onLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="logo"><span className="logo-mark" />Brightloop</div>
        <nav aria-label="Main">
          {nav.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
                  <Icon name={item.icon} />{item.text}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <div className="avatar">{initials(user.name)}</div>
            <div className="meta">
              <div className="name">{user.name}</div>
              <div className="role">{user.role}</div>
            </div>
          </div>
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            <span className={`live ${connected ? 'on' : ''}`} title="Live updates"><i />{connected ? 'Live' : 'Offline'}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}><Icon name="logout" />Sign out</button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="btn btn-ghost icon-btn" onClick={() => setOpen(true)} aria-label="Open menu"><Icon name="menu" /></button>
          <div className="logo" style={{ padding: 0 }}><span className="logo-mark" />Brightloop</div>
          <span className={`live ${connected ? 'on' : ''}`}><i /></span>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
