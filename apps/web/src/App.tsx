import { useEffect, useState } from 'react';
import { normalizedHash, parseHash, type Route } from './routes';
import { ClassicScreen } from './screens/ClassicScreen';
import { DuoLobby } from './screens/DuoLobby';
import { DuoScreen } from './screens/DuoScreen';
import { HomeScreen } from './screens/HomeScreen';
import { MoveScreen } from './screens/MoveScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SocialScreen } from './screens/SocialScreen';
import { WheelScreen } from './screens/WheelScreen';
import { loadName } from './storage';

export type { Route };

export function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // ClassicScreen has already consumed `fresh` by the time this runs, so put the
  // URL back to the plain route. Otherwise a reload — or a cold start from the
  // app switcher, which is the common one on a phone — would read `new` a second
  // time and throw away the game in progress. replaceState fires no hashchange
  // and adds no history entry, so Back still reaches Home in one press.
  useEffect(() => {
    if ((route.name !== 'classic' && route.name !== 'ranked') || !route.fresh) return;
    window.history.replaceState(null, '', normalizedHash(route));
    setRoute(route.name === 'ranked' ? { name: 'ranked', fresh: false } : { name: 'classic', fresh: false });
  }, [route]);

  const go = (hash: string) => {
    window.location.hash = hash;
    setRoute(parseHash(window.location.hash));
  };

  switch (route.name) {
    case 'classic':
      // Keyed so that clearing `fresh` above re-renders the screen in place
      // rather than remounting it and reloading the board it just replaced.
      return <ClassicScreen key="classic" fresh={route.fresh} onHome={() => go('/')} />;
    case 'ranked':
      return (
        <ClassicScreen key="ranked" mode="ranked" fresh={route.fresh} onHome={() => go('/')} />
      );
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
    case 'player':
      return (
        <ProfileScreen
          key={route.code ?? 'me'}
          code={route.code ?? null}
          onHome={() => go('/')}
        />
      );
    case 'move':
      // Keyed on the code: following a second transfer link without a reload is
      // a same-document hash change, and an unkeyed screen would keep the first
      // result on display without ever claiming the second.
      return (
        <MoveScreen
          key={route.code ?? 'none'}
          code={route.code ?? null}
          onHome={() => go('/')}
        />
      );
    case 'wheel':
      return <WheelScreen onHome={() => go('/')} />;
    case 'social':
      return <SocialScreen onHome={() => go('/')} onPlayer={(c) => go(`/player/${c}`)} />;
    default:
      return (
        <HomeScreen
          onClassic={() => go('/classic')}
          onNewClassic={() => go('/classic/new')}
          onRanked={() => go('/ranked')}
          onNewRanked={() => go('/ranked/new')}
          onProfile={() => go('/player')}
          onWheel={() => go('/wheel')}
          onDuo={() => go('/duo')}
          onSocial={() => go('/social')}
        />
      );
  }
}
