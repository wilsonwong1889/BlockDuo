import { isValidRoomCode, randomRoomCode } from '@blokduo/engine';
import { RoomDO, type Env } from './RoomDO';

export { RoomDO };

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    // POST /api/room — mint a room and return its code.
    if (url.pathname === '/api/room' && request.method === 'POST') {
      // Codes are short enough to read aloud, so collisions are possible even
      // though they are unlikely. Claiming is atomic inside the room's own DO,
      // so retrying on a taken code is safe.
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = randomRoomCode();
        const claimed = await roomStub(env, code).claim(code);
        if (claimed) return json({ code });
      }
      return json({ error: 'Could not allocate a room, try again' }, 503);
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
