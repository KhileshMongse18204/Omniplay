import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from 'react';
import { Link, Route, Switch, useLocation } from 'wouter';
import { can, logout, refresh, useAuth, type Role } from './api';
import { Button, Toasts } from './ui';

// Each page is its own lazy chunk: signing in downloads only the login screen, and a moderator never
// downloads the settings code.
const Login = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Login })));
const AcceptInvite = lazy(() => import('./pages/Auth').then((m) => ({ default: m.AcceptInvite })));
const Register = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Register })));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Links = lazy(() => import('./pages/Links'));
const Categories = lazy(() => import('./pages/Categories'));
const Reports = lazy(() => import('./pages/Reports'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Settings = lazy(() => import('./pages/Settings'));
const Staff = lazy(() => import('./pages/Staff'));

const PAGES: { href: string; label: string; min: Role; page: ComponentType }[] = [
  { href: '/', label: 'Dashboard', min: 'moderator', page: Dashboard },
  { href: '/links', label: 'Links', min: 'moderator', page: Links },
  { href: '/categories', label: 'Categories', min: 'editor', page: Categories },
  { href: '/reports', label: 'Reports', min: 'moderator', page: Reports },
  { href: '/analytics', label: 'Analytics', min: 'editor', page: Analytics },
  { href: '/settings', label: 'Settings', min: 'owner', page: Settings },
  { href: '/staff', label: 'Staff', min: 'owner', page: Staff },
];

const Center = ({ children }: { children: ReactNode }) => <div className="grid min-h-dvh place-items-center text-muted">{children}</div>;

export function App() {
  const { status } = useAuth();
  useEffect(() => { void refresh(); }, []); // restore the session from the refresh cookie

  if (status === 'loading') return <Center>Loading…</Center>;
  if (status === 'out') {
    return (
      <Suspense fallback={<Center>Loading…</Center>}>
        <Switch>
          <Route path="/accept-invite" component={AcceptInvite} />
          <Route path="/register" component={Register} />
          <Route component={Login} />
        </Switch>
        <Toasts />
      </Suspense>
    );
  }
  return <Shell />;
}

function Shell() {
  const { user } = useAuth();
  const [location] = useLocation();
  const nav = PAGES.filter((p) => can(user, p.min));
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[216px_1fr]">
      <aside className="border-b border-line bg-surface md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-4 py-3.5">
          <span className="grid size-7 place-items-center rounded-md bg-ink text-xs text-white" aria-hidden="true">▶</span>
          <span className="text-[14px] font-semibold">OmniPlay <span className="font-normal text-muted">Admin</span></span>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
          {nav.map((p) => {
            const active = p.href === '/' ? location === '/' : location.startsWith(p.href);
            return (
              <Link key={p.href} href={p.href} aria-current={active ? 'page' : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium ${active ? 'bg-page text-ink' : 'text-secondary hover:bg-page hover:text-ink'}`}>
                {p.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto hidden border-t border-line p-3 md:block">
          <p className="truncate text-[13px] font-medium">{user?.name || user?.email}</p>
          <p className="text-xs capitalize text-muted">{user?.role}</p>
          <Button variant="ghost" className="mt-2 -ml-2" onClick={logout}>Sign out</Button>
        </div>
      </aside>
      <main className="min-w-0 px-4 py-6 md:px-8">
        <div className="mb-4 flex justify-end md:hidden"><Button variant="ghost" onClick={logout}>Sign out</Button></div>
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <Switch>
            {PAGES.map((p) => (
              <Route key={p.href} path={p.href}>
                {can(user, p.min) ? <p.page /> : <p className="text-secondary">Your role ({user?.role}) can't open this page.</p>}
              </Route>
            ))}
            <Route><p className="text-secondary">Page not found. <Link href="/" className="text-accent">Back to the dashboard</Link></p></Route>
          </Switch>
        </Suspense>
      </main>
      <Toasts />
    </div>
  );
}
