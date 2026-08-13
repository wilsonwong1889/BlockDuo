import { useEffect, useState } from 'react';
import { ClassicScreen } from './screens/ClassicScreen';
import { DuoLobby } from './screens/DuoLobby';
import { DuoScreen } from './screens/DuoScreen';
import { HomeScreen } from './screens/HomeScreen';
import { SocialScreen } from './screens/SocialScreen';
import { loadName } from './storage';

export type Route =
  | { name: 'home' }
  | { name: 'classic'; fresh?: boolean }
  | { name: 'duo'; code?: string }
  | { name: 'social' };

/**
 * Hash routing, so a duo invite is just a link: opening /#/duo/ABCDEF drops you
 * straight into that room. Hash rather than history API because the same build
 * is served from a static host and from inside the native app shell, where
 * there is no server to rewrite paths.
 */
function parseHash(): Route {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const [head, arg] = hash.split('/');
  if (head === 'classic') return { name: 'classic', fresh: arg === 'new' };
  if (head === 'duo') return { name: 'duo', code: arg ? arg.toUpperCase() : undefined };
  if (head === 'social') return { name: 'social' };
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
      return <ClassicScreen fresh={route.fresh} onHome={() => go('/')} />;
    case 'duo':
      // A code in the URL means the player followed an invite, so skip the
      // lobby and take them straight into the room.
      return route.code ? (
        <DuoScreen
          key={route.code}
          code={route.code}
          name={loadName() || 'Player'}
          onHome={() => go('/')}
        />
      ) : (
        <DuoLobby onEnter={(code) => go(`/duo/${code}`)} onHome={() => go('/')} />
      );
    case 'social':
      return <SocialScreen onHome={() => go('/')} />;
    default:
      return (
        <HomeScreen
          onClassic={() => go('/classic')}
          onNewClassic={() => go('/classic/new')}
          onDuo={() => go('/duo')}
          onSocial={() => go('/social')}
        />
      );
  }
}
