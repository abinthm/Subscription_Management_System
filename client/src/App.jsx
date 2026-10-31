import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth, isTeam } from './hooks/auth.jsx';
import { LiveProvider } from './hooks/live.jsx';
import { Spinner, Empty } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import { Login, Signup, ForgotPassword, ResetPassword } from './pages/auth/AuthPages.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Growth from './pages/Growth.jsx';
import SubscriptionList from './pages/subscriptions/SubscriptionList.jsx';
import SubscriptionDetail from './pages/subscriptions/SubscriptionDetail.jsx';
import SubscriptionForm from './pages/subscriptions/SubscriptionForm.jsx';
import Subscribe from './pages/subscriptions/Subscribe.jsx';
import InvoiceList from './pages/invoices/InvoiceList.jsx';
import InvoiceDetail from './pages/invoices/InvoiceDetail.jsx';
import Payments from './pages/Payments.jsx';
import CustomerList from './pages/customers/CustomerList.jsx';
import CustomerDetail from './pages/customers/CustomerDetail.jsx';
import Products from './pages/catalog/Products.jsx';
import Plans from './pages/catalog/Plans.jsx';
import Taxes from './pages/catalog/Taxes.jsx';
import Discounts from './pages/Discounts.jsx';
import Templates from './pages/Templates.jsx';
import Team from './pages/Team.jsx';
import Profile from './pages/Profile.jsx';

function Guard({ allow, children }) {
  const { user } = useAuth();
  if (!allow(user)) return <Empty title="No access">Your account cannot open this page.</Empty>;
  return children;
}

const team = (u) => isTeam(u);
const admin = (u) => u.role === 'admin';

export default function App() {
  const { user } = useAuth();
  if (user === undefined) return <Spinner />;

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <LiveProvider key={user.id}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={team(user) ? <Dashboard /> : <SubscriptionList />} />
          <Route path="growth" element={<Guard allow={team}><Growth /></Guard>} />
          <Route path="subscriptions" element={<SubscriptionList />} />
          <Route path="subscribe" element={<Guard allow={(u) => u.role === 'customer'}><Subscribe /></Guard>} />
          <Route path="subscriptions/new" element={<Guard allow={team}><SubscriptionForm /></Guard>} />
          <Route path="subscriptions/:id" element={<SubscriptionDetail />} />
          <Route path="subscriptions/:id/edit" element={<Guard allow={team}><SubscriptionForm /></Guard>} />
          <Route path="invoices" element={<InvoiceList />} />
          <Route path="invoices/:id" element={<InvoiceDetail />} />
          <Route path="payments" element={<Payments />} />
          <Route path="profile" element={<Profile />} />
          <Route path="customers" element={<Guard allow={team}><CustomerList /></Guard>} />
          <Route path="customers/:id" element={<Guard allow={team}><CustomerDetail /></Guard>} />
          <Route path="templates" element={<Guard allow={team}><Templates /></Guard>} />
          <Route path="products" element={<Guard allow={team}><Products /></Guard>} />
          <Route path="plans" element={<Guard allow={team}><Plans /></Guard>} />
          <Route path="taxes" element={<Guard allow={team}><Taxes /></Guard>} />
          <Route path="discounts" element={<Guard allow={team}><Discounts /></Guard>} />
          <Route path="team" element={<Guard allow={admin}><Team /></Guard>} />
          <Route path="login" element={<Navigate to="/" replace />} />
          <Route path="signup" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Empty title="Page not found">Use the menu to find your way.</Empty>} />
        </Route>
      </Routes>
    </LiveProvider>
  );
}
