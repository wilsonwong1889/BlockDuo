import { describe, expect, it } from 'vitest';
import { PIECES, TOTAL_WEIGHT, getPiece, pieceForRoll } from '../src/pieces.js';
import { SIZE } from '../src/board.js';

describe('piece catalog', () => {
  it('contains 37 fixed-orientation pieces', () => {
    expect(PIECES).toHaveLength(37);
  });

  it('has unique ids', () => {
    const ids = new Set(PIECES.map((p) => p.id));
    expect(ids.size).toBe(PIECES.length);
  });

  it('normalises every piece to the origin', () => {
    for (const p of PIECES) {
      expect(Math.min(...p.cells.map((c) => c[0])), p.id).toBe(0);
      expect(Math.min(...p.cells.map((c) => c[1])), p.id).toBe(0);
    }
  });

  it('reports a bounding box that matches its cells', () => {
    for (const p of PIECES) {
      expect(p.h, p.id).toBe(Math.max(...p.cells.map((c) => c[0])) + 1);
      expect(p.w, p.id).toBe(Math.max(...p.cells.map((c) => c[1])) + 1);
    }
  });

  it('has no duplicate cells within a piece', () => {
    for (const p of PIECES) {
      const keys = new Set(p.cells.map(([r, c]) => `${r},${c}`));
      expect(keys.size, p.id).toBe(p.cells.length);
    }
  });

  it('fits every piece inside the board', () => {
    for (const p of PIECES) {
      expect(p.w, p.id).toBeLessThanOrEqual(SIZE);
      expect(p.h, p.id).toBeLessThanOrEqual(SIZE);
    }
  });

  it('gives every piece a positive deal weight', () => {
    for (const p of PIECES) expect(p.weight, p.id).toBeGreaterThan(0);
  });

  it('covers the whole weight range when rolling', () => {
    const seen = new Set<string>();
    for (let roll = 0; roll < TOTAL_WEIGHT; roll++) {
      seen.add(pieceForRoll(roll).id);
    }
    expect(seen.size).toBe(PIECES.length);
  });

  it('throws on an unknown piece id', () => {
    expect(() => getPiece('nope')).toThrow(/Unknown piece/);
  });

  it('keeps the tetromino family at the expected cell counts', () => {
    const four = ['L', 'J', 'T', 'S', 'Z'];
    for (const p of PIECES) {
      if (four.some((f) => p.id.startsWith(`${f}-`))) {
        expect(p.cells.length, p.id).toBe(4);
      }
      if (p.id.startsWith('BC-')) expect(p.cells.length, p.id).toBe(5);
      if (p.id.startsWith('C3-')) expect(p.cells.length, p.id).toBe(3);
    }
  });

  it('has four distinct orientations for each rotating family', () => {
    for (const family of ['C3', 'L', 'J', 'T', 'BC']) {
      const members = PIECES.filter((p) => p.id.startsWith(`${family}-`));
      expect(members, family).toHaveLength(4);
      const shapes = new Set(
        members.map((p) => p.cells.map(([r, c]) => `${r},${c}`).sort().join(' ')),
      );
      expect(shapes.size, family).toBe(4);
    }
  });
});
