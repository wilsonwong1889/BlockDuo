/**
 * A stand-in second player, for exercising duo against a real browser.
 *
 * Two browser tabs cannot both be visible in one preview pane, and a hidden tab
 * reports a zero-sized viewport, so the partner is driven from here instead.
 *
 * It deliberately knows nothing about the rules: it proposes placements and lets
 * the server's validation tell it which are legal. That keeps the script tiny
 * and doubles as a check that rejection actually rejects.
 *
 *   node scripts/partner-bot.ts <ROOMCODE> [moves]
 */

const [, , codeArg, movesArg] = process.argv;
if (!codeArg) {
  console.error('usage: node scripts/partner-bot.ts <ROOMCODE> [moves]');
  process.exit(1);
}
const code = codeArg.toUpperCase();
const maxMoves = Number(movesArg ?? 3);

const socket = new WebSocket(
  `ws://localhost:8787/api/room/${code}/ws?clientId=partner-bot&name=Robin`,
);

let seat: number | null = null;
let played = 0;
let seq = 0;
let rejections = 0;
/** Candidate placements still untried for the turn in progress. */
let candidates: Array<{ slot: number; row: number; col: number }> = [];
let awaiting = false;

function buildCandidates() {
  const list: Array<{ slot: number; row: number; col: number }> = [];
  for (let row = 7; row >= 0; row--) {
    for (let col = 7; col >= 0; col--) {
      for (let slot = 0; slot < 3; slot++) list.push({ slot, row, col });
    }
  }
  return list;
}

function tryNext() {
  const move = candidates.shift();
  if (!move) {
    console.log('bot found no legal move');
    awaiting = false;
    return;
  }
  seq += 1;
  awaiting = true;
  socket.send(JSON.stringify({ t: 'place', seq, ...move }));
}

function onTurn(snapshot: { phase: string; turn: number }) {
  if (snapshot.phase !== 'playing' || snapshot.turn !== seat || played >= maxMoves || awaiting) return;
  candidates = buildCandidates();
  // A beat of delay so the browser side is visibly waiting on a partner rather
  // than having moves appear instantly.
  setTimeout(tryNext, 400);
}

socket.addEventListener('open', () => console.log('bot connected to', code));

socket.addEventListener('message', (event) => {
  const msg = JSON.parse(String(event.data));

  if (msg.t === 'welcome') {
    seat = msg.seat;
    console.log(`bot seated at ${seat}, phase ${msg.snapshot.phase}`);
    onTurn(msg.snapshot);
    return;
  }

  if (msg.t === 'rejected') {
    rejections += 1;
    tryNext();
    return;
  }

  if (msg.t === 'applied') {
    if (msg.by === seat) {
      awaiting = false;
      played += 1;
      candidates = [];
      console.log(
        `bot placed slot ${msg.slot} at (${msg.row}, ${msg.col}) for +${msg.scoreDelta}` +
          (msg.clears ? ` — cleared ${msg.clears.rows.length + msg.clears.cols.length} line(s)` : '') +
          ` after ${rejections} rejected probes`,
      );
      rejections = 0;
    } else {
      console.log(`partner (browser) placed slot ${msg.slot} at (${msg.row}, ${msg.col}) for +${msg.scoreDelta}`);
    }
  }

  if ('snapshot' in msg) onTurn(msg.snapshot);

  if (msg.t === 'over') {
    console.log('game over');
    socket.close();
  }
});

socket.addEventListener('close', () => {
  console.log(`bot done after ${played} move(s)`);
  process.exit(0);
});

setTimeout(() => {
  console.log('bot finished its moves, disconnecting');
  socket.close();
}, 45_000);
