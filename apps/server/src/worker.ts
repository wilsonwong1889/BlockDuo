import { DEFAULT_DUO_MODE, isDuoMode, isValidRoomCode, randomRoomCode } from '@blokduo/engine';
import {
  ProgressDO,
  type ProgressCredentials,
  type ProgressResult,
} from './ProgressDO';
import { RoomDO, type Env } from './RoomDO';

export { ProgressDO, RoomDO };

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/**
 * Route a code to its room. `idFromName` is deterministic, so the same code
 * always reaches the same object — that is what makes the code alone enough to
 * find a game, with nothing to look up anywhere else.
 */
const roomStub = (env: Env, code: string) => env.ROOM.get(env.ROOM.idFromName(code));
const progressStub = (env: Env) => env.PROGRESS.get(env.PROGRESS.idFromName('global'));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

const resultJson = <T>(result: ProgressResult<T>) =>
  result.ok ? json(result.value) : json({ error: result.error }, result.status);

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function credentialsOf(body: Record<string, unknown>): ProgressCredentials {
  const nested =
    body.credentials && typeof body.credentials === 'object'
      ? (body.credentials as Record<string, unknown>)
      : body;
  return {
    clientId: typeof nested.clientId === 'string' ? nested.clientId : '',
    token: typeof nested.token === 'string' ? nested.token : '',
  };
}

/** Google's certification authority ID, fixed for every AdSense ads.txt. */
const GOOGLE_TAG_ID = 'f08c47fec0942fa0';

/** What Google issues: `pub-` and sixteen digits. */
const PUB_ID_PATTERN = /^pub-\d{16}$/;

/**
 * The ads.txt body for a publisher ID, or null when there is not a valid one.
 *
 * Exported for the tests. A malformed ID has to mean no file rather than a
 * file naming a malformed publisher, because this is the record advert buyers
 * check to decide whether inventory sold as ours really is.
 */
export function adsTxtBody(pubId: string | undefined | null): string | null {
  const value = (pubId ?? '').trim();
  if (!PUB_ID_PATTERN.test(value)) return null;
  return `google.com, ${value}, DIRECT, ${GOOGLE_TAG_ID}\n`;
}

function adsTxt(env: Env): Response {
  const body = adsTxtBody(env.ADSENSE_PUB_ID);
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'max-age=3600' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // Served from here rather than from the assets directory so that a build
    // without a publisher ID cannot ship a file naming one. Google reads this
    // to confirm who is allowed to sell the site's inventory, so a placeholder
    // left in by accident is an authorisation claim, not a harmless stub.
    if (url.pathname === '/ads.txt') return adsTxt(env);

    // Progression endpoints all use POST so the bearer token never appears in
    // query strings, browser history, CDN cache keys or access logs.
    if (url.pathname === '/api/progress/player' && request.method === 'POST') {
      const body = await bodyOf(request);
      if (!body) return json({ error: 'Invalid JSON body' }, 400);
      // Cloudflare sets this on every real request; absent means local.
      const address = request.headers.get('CF-Connecting-IP') ?? '';
      return resultJson(
        await progressStub(env).createPlayer(String(body.name ?? 'Player'), address),
      );
    }

    // Moving a profile between origins. Both are POST for the same reason as
    // the rest: a transfer code is a bearer credential for somebody's whole
    // account, and a query string is the one place it must never appear.
    if (url.pathname === '/api/progress/transfer/create' && request.method === 'POST') {
      const body = await bodyOf(request);
      if (!body) return json({ error: 'Invalid JSON body' }, 400);
      return resultJson(await progressStub(env).createTransfer(credentialsOf(body)));
    }

    if (url.pathname === '/api/progress/transfer/claim' && request.method === 'POST') {
      const body = await bodyOf(request);
      if (!body) return json({ error: 'Invalid JSON body' }, 400);
      return resultJson(await progressStub(env).claimTransfer(String(body.code ?? '')));
    }

    // The one progression route with no credentials: a public profile, keyed by
    // the code players already hand out. GET because it is a public resource
    // with nothing secret in the path — the token never appears here.
    const publicProfileMatch = url.pathname.match(/^\/api\/progress\/player\/([A-Za-z0-9-]{1,16})$/);
    if (publicProfileMatch && request.method === 'GET') {
      return resultJson(await progressStub(env).publicProfile(publicProfileMatch[1]));
    }

    if (url.pathname.startsWith('/api/progress/') && request.method === 'POST') {
      const body = await bodyOf(request);
      if (!body) return json({ error: 'Invalid JSON body' }, 400);
      const credentials = credentialsOf(body);
      const progress = progressStub(env);

      if (url.pathname === '/api/progress/profile') {
        return resultJson(
          await progress.profile(credentials, typeof body.name === 'string' ? body.name : undefined),
        );
      }
      if (url.pathname === '/api/progress/friends/add') {
        return resultJson(await progress.addFriend(credentials, String(body.friendCode ?? '')));
      }
      if (url.pathname === '/api/progress/friends/remove') {
        return resultJson(await progress.removeFriend(credentials, String(body.friendCode ?? '')));
      }
      if (url.pathname === '/api/progress/leaderboard') {
        if (body.mode !== 'classic' && body.mode !== 'duo') {
          return json({ error: 'Unknown leaderboard mode' }, 400);
        }
        if (body.scope !== 'global' && body.scope !== 'friends') {
          return json({ error: 'Unknown leaderboard scope' }, 400);
        }
        return resultJson(
          await progress.leaderboard(credentials, body.mode, body.scope),
        );
      }
      if (url.pathname === '/api/progress/wheel/reset') {
        return resultJson(await progressStub(env).resetWheel(credentials));
      }

      if (url.pathname === '/api/progress/wheel') {
        // `watchedAd` is the client's word for now. When a network is wired
        // up its verification token arrives here and is checked instead.
        return resultJson(await progress.spinWheel(credentials, body.watchedAd === true));
      }

      if (url.pathname === '/api/progress/gems/spend') {
        return resultJson(await progress.spendGems(credentials, body.power as never));
      }

      if (url.pathname === '/api/progress/classic') {
        return resultJson(
          await progress.claimClassic(
            credentials,
            Number(body.seed),
            Array.isArray(body.moves) ? body.moves : [],
            body.ranked === true,
          ),
        );
      }
    }

    /**
     * Crash reports from the browser.
     *
     * Logged rather than stored: they show up in `wrangler tail` and in the
     * Workers dashboard, which is somewhere to look without standing up a
     * service or storing anything about anybody. Nothing is kept, so nothing
     * has to be pruned or protected.
     */
    if (url.pathname === '/api/telemetry/error' && request.method === 'POST') {
      const body = await bodyOf(request);
      if (!body) return new Response(null, { status: 204, headers: CORS });

      const clip = (value: unknown, max: number) =>
        typeof value === 'string' ? value.slice(0, max) : '';
      console.error('client-error', {
        message: clip(body.message, 300),
        stack: clip(body.stack, 2_000),
        screen: clip(body.screen, 100),
        version: clip(body.version, 40),
        agent: clip(request.headers.get('User-Agent'), 200),
      });
      return new Response(null, { status: 204, headers: CORS });
    }

    /**
     * Aggregate daily counts, for you rather than for players.
     *
     * Behind a secret so business numbers are not simply public, and refused
     * outright when no secret is configured — a metrics endpoint that opens
     * itself because nobody set a variable is the wrong default.
     */
    if (url.pathname === '/api/admin/metrics' && request.method === 'GET') {
      const expected = env.ADMIN_TOKEN;
      const given = url.searchParams.get('token') ?? '';
      if (!expected || given !== expected) return json({ error: 'Not found' }, 404);
      return resultJson(await progressStub(env).metrics(Number(url.searchParams.get('days') ?? 14)));
    }

    // POST /api/room — mint a room and return its code.
    if (url.pathname === '/api/room' && request.method === 'POST') {
      // A room is a Durable Object, so minting one is not free either.
      const address = request.headers.get('CF-Connecting-IP') ?? '';
      if (!(await progressStub(env).allowRoomCreate(address))) {
        return json({ error: 'Too many rooms from here. Try again later.' }, 429);
      }

      // The mode is fixed here and never changes: a joiner inherits whatever
      // the host picked, and an unreadable body is simply the default.
      const body = await request.json().catch(() => null);
      const wanted = (body as { mode?: unknown } | null)?.mode;
      const mode = isDuoMode(wanted) ? wanted : DEFAULT_DUO_MODE;

      // Codes are short enough to read aloud, so collisions are possible even
      // though they are unlikely. Claiming is atomic inside the room's own DO,
      // so retrying on a taken code is safe.
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = randomRoomCode();
        const claimed = await roomStub(env, code).claim(code, mode);
        if (claimed) return json({ code, mode });
      }
      return json({ error: 'Could not allocate a room, try again' }, 503);
    }

    const ticketMatch = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]+)\/ticket$/);
    if (ticketMatch && request.method === 'POST') {
      const code = ticketMatch[1].toUpperCase();
      if (!isValidRoomCode(code)) return json({ error: 'Bad room code' }, 400);
      const body = await bodyOf(request);
      if (!body) return json({ error: 'Invalid JSON body' }, 400);
      const authenticated = await progressStub(env).profile(
        credentialsOf(body),
        typeof body.name === 'string' ? body.name : undefined,
      );
      if (!authenticated.ok) return resultJson(authenticated);
      const ticket = await roomStub(env, code).issueTicket(
        authenticated.value.clientId,
        authenticated.value.name,
      );
      return ticket
        ? json({ ticket })
        : json({ error: 'That room is unavailable or full' }, 409);
    }

    const match = url.pathname.match(/^\/api\/room\/([A-Za-z0-9]+)(\/ws)?$/);
    if (match) {
      const code = match[1].toUpperCase();
      if (!isValidRoomCode(code)) return json({ error: 'Bad room code' }, 400);

      const stub = roomStub(env, code);

      if (match[2] === '/ws') {
        // Hand the upgrade straight to the room. Everything about the game —
        // seating, turn order, validation — is decided in there.
        return stub.fetch(request);
      }

      return json({ code, ...(await stub.status()) });
    }

    return json({ error: 'Not found' }, 404);
  },
};
