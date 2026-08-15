/**
 * Hash routing, so a duo invite is just a link: opening /#/duo/ABCDEF drops you
 * straight into that room. Hash rather than history API because the same build
 * is served from a static host and from inside the native app shell, where
 * there is no server to rewrite paths.
 *
 * Parsing takes the hash as an argument rather than reading `window`, which is
 * what lets the rules be tested without a DOM.
 */

export type Route =
  | { name: 'home' }
  | { name: 'classic'; fresh: boolean }
  | { name: 'ranked'; fresh: boolean }
  | { name: 'duo'; code?: string }
  | { name: 'social' }
  | { name: 'wheel' }
  /** Redeeming a transfer code minted on the origin the game used to live on. */
  | { name: 'move'; code?: string }
  /** No code means "whoever is playing on this device". */
  | { name: 'player'; code?: string };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  const [head, arg] = path.split('/');
  if (head === 'classic') return { name: 'classic', fresh: arg === 'new' };
  if (head === 'ranked') return { name: 'ranked', fresh: arg === 'new' };
  if (head === 'duo') return { name: 'duo', code: arg ? arg.toUpperCase() : undefined };
  if (head === 'player') return { name: 'player', code: arg ? arg.toUpperCase() : undefined };
  if (head === 'social') return { name: 'social' };
  if (head === 'wheel') return { name: 'wheel' };
  // Lower-cased rather than upper: this one is hex from the server, not a code
  // anybody reads aloud.
  if (head === 'move') return { name: 'move', code: arg ? arg.toLowerCase() : undefined };
  return { name: 'home' };
}

/**
 * Where a route should sit in the URL once it has been entered.
 *
 * `#/classic/new` is an instruction — discard the saved board — and not a place.
 * Once it has been carried out the URL has to stop saying it, or a reload starts
 * yet another new game on top of the one being played.
 */
export function normalizedHash(route: Route): string {
  switch (route.name) {
    case 'classic':
      return '#/classic';
    case 'ranked':
      return '#/ranked';
    case 'duo':
      return route.code ? `#/duo/${route.code}` : '#/duo';
    case 'player':
      return route.code ? `#/player/${route.code}` : '#/player';
    case 'social':
      return '#/social';
    case 'wheel':
      return '#/wheel';
    // Like `#/classic/new`, this is an instruction and not a place: the code is
    // spent the moment it is redeemed, so leaving it in the URL would mean a
    // reload retrying a claim that can only fail the second time.
    case 'move':
      return '#/';
    default:
      return '#/';
  }
}
