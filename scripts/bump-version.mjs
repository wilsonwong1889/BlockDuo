#!/usr/bin/env node
// Move the version on by one update.
//
// The number lives in version.json rather than being counted from git history
// at build time, because the deploy builds from a shallow clone: `git rev-list
// --count` there sees one commit and every deploy came out as .1, whichever
// update it actually was. A committed file is part of the checkout, so it
// survives any clone depth and any build machine.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../version.json', import.meta.url);

/** Same day carries on counting; a new day starts again at one. */
export function nextVersion(current, today) {
  const build = current?.date === today ? Number(current.build ?? 0) + 1 : 1;
  return { date: today, build };
}

export function versionString({ date, build }) {
  const [, month, day] = date.split('-');
  // Unpadded, so August is 8 rather than 08 — and the dots are what keep
  // Jan 12 and Nov 2 from both reading 1.112.
  return `1.${Number(month)}.${Number(day)}.${build}`;
}

export function todayISO(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function main() {
  let current = null;
  try {
    current = JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    // No file yet, or an unreadable one. Either way, start the day at one.
  }

  const next = nextVersion(current, todayISO());
  writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);
  console.log(versionString(next));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
