import { useEffect, useState } from 'react';
import { ClassicScreen } from './screens/ClassicScreen';
import { HomeScreen } from './screens/HomeScreen';

export type Route = { name: 'home' } | { name: 'classic' } | { name: 'duo'; code?: string };

/**
 * Hash routing, so a duo invite is just a link: opening /#/duo/ABCDEF drops you
 * straight into that room. Hash rather than history API because the same build
 * is served from a static host and from inside the native app shell, where
 * there is no server to rewrite paths.
 */
function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [head, arg] = hash.split('/');
  if (head === 'classic') return { name: 'classic' };
  if (head === 'duo') return { name: 'duo', code: arg ? arg.toUpperCase() : undefined };
  return { name: 'home' };
}

export function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const go = (hash: string) => {
    window.location.hash = hash;
    setRoute(parseHash());
  };

  switch (route.name) {
    case 'classic':
      return <ClassicScreen onHome={() => go('/')} />;
    case 'duo':
      return (
        <div className="screen home">
          <h1 className="home-title">Duo</h1>
          <p className="home-tagline">Two players, one board. Wiring up next.</p>
          <button className="btn" onClick={() => go('/')}>
            Home
          </button>
        </div>
      );
    default:
      return <HomeScreen onClassic={() => go('/classic')} onDuo={() => go('/duo')} />;
  }
}
