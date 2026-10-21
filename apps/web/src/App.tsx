import { lazy, Suspense, useEffect } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { trackView } from './api';
import { useBoot } from './boot';
import { BottomTabs, ErrorBoundary, Footer, Maintenance, NotFound, PageLoader, Splash, TopNav } from './components/Chrome';
import { Overlays } from './components/Overlays';
import { useKonami } from './easter';
import Home from './pages/Home';
import { injectScripts } from './scripts';

// Route-level code splitting: the home directory ships in the main bundle; Feed and Search download on first visit.
const Feed = lazy(() => import('./pages/Feed'));
const Search = lazy(() => import('./pages/Search'));

export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Splash />}>
        <Shell />
      </Suspense>
    </ErrorBoundary>
  );
}

function Shell() {
  const boot = useBoot();
  const [location] = useLocation();
  useKonami();

  useEffect(() => { trackView(); }, [location]); // one pageview beacon per route

  useEffect(() => {
    // shortcut: meta tags are set client-side (Google renders JS, but social crawlers see index.html's
    // defaults); upgrade to build-time injection via a Pages deploy hook if share previews matter.
    document.title = boot.site.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', boot.site.description);
    injectScripts(boot.site.headScripts, boot.site.bodyScripts);
  }, [boot]);

  if (boot.site.maintenance.enabled) return <Maintenance message={boot.site.maintenance.message} />;

  return (
    <>
      <a href="#main" className="sr-only z-50 focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:bg-accent focus:p-3 focus:text-accent-ink">
        Skip to content
      </a>
      <TopNav />
      <main id="main">
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/c/:slug" component={Home} />
          <Route path="/feed"><Suspense fallback={<PageLoader />}><Feed /></Suspense></Route>
          <Route path="/search"><Suspense fallback={<PageLoader />}><Search /></Suspense></Route>
          <Route component={NotFound} />
        </Switch>
      </main>
      {location !== '/feed' && <Footer />}
      <BottomTabs />
      <Overlays />
    </>
  );
}
