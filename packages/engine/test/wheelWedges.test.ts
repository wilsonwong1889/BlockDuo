import { describe, expect, it } from 'vitest';
import {
  nextUnmarkedWedge,
  wheelWedgeAt,
  WHEEL_SEGMENTS,
  WHEEL_TOTAL_WEIGHT,
  WHEEL_WEDGES,
  WHEEL_WEDGE_TOTAL,
} from '../src/powers';

const shareOf = (gems: number) =>
  WHEEL_WEDGES.filter((w) => w.gems === gems).reduce((sum, w) => sum + w.weight, 0) /
  WHEEL_WEDGE_TOTAL;

describe('the wheel as wedges', () => {
  it('splits prizes without changing what they are worth', () => {
    // The whole point of splitting is that it is only a drawing change.
    for (const segment of WHEEL_SEGMENTS) {
      expect(shareOf(segment.gems)).toBeCloseTo(segment.weight / WHEEL_TOTAL_WEIGHT, 10);
    }
  });

  it('draws the rare prize once and the rest several times', () => {
    const rare = WHEEL_WEDGES.filter((w) => w.rare);
    expect(rare).toHaveLength(1);
    expect(rare[0].gems).toBe(50);
    expect(WHEEL_WEDGES.filter((w) => w.gems === 1)).toHaveLength(5);
  });

  it('never puts a prize next to itself', () => {
    // Two adjacent wedges of one colour read as a single fat one, which undoes
    // the reason for splitting them at all. The wheel wraps, so check the seam.
    for (let i = 0; i < WHEEL_WEDGES.length; i++) {
      const next = WHEEL_WEDGES[(i + 1) % WHEEL_WEDGES.length];
      expect(WHEEL_WEDGES[i].gems).not.toBe(next.gems);
    }
  });

  it('covers the whole circle exactly once', () => {
    expect(WHEEL_WEDGES.reduce((sum, w) => sum + w.size, 0)).toBeCloseTo(360, 6);
    for (let i = 1; i < WHEEL_WEDGES.length; i++) {
      expect(WHEEL_WEDGES[i].start).toBeCloseTo(
        WHEEL_WEDGES[i - 1].start + WHEEL_WEDGES[i - 1].size,
        6,
      );
    }
  });

  it('lands every roll inside the wheel', () => {
    expect(wheelWedgeAt(0)).toBe(0);
    expect(wheelWedgeAt(WHEEL_WEDGE_TOTAL - 1)).toBe(WHEEL_WEDGES.length - 1);
    // Nonsense in, a real wedge out, rather than undefined somewhere later.
    expect(wheelWedgeAt(-5)).toBe(0);
    expect(wheelWedgeAt(Number.NaN)).toBe(0);
    expect(wheelWedgeAt(WHEEL_WEDGE_TOTAL * 10)).toBe(WHEEL_WEDGES.length - 1);
  });
});

describe('striking wedges off', () => {
  it('leaves an unstruck wedge where it fell', () => {
    expect(nextUnmarkedWedge(3, [])).toBe(3);
  });

  it('slides right past what has been struck', () => {
    expect(nextUnmarkedWedge(3, [3])).toBe(4);
    expect(nextUnmarkedWedge(3, [3, 4, 5])).toBe(6);
  });

  it('wraps rather than falling off the end', () => {
    const last = WHEEL_WEDGES.length - 1;
    expect(nextUnmarkedWedge(last, [last])).toBe(0);
    expect(nextUnmarkedWedge(last, [last, 0, 1])).toBe(2);
  });

  it('says so when there is nothing left', () => {
    const all = WHEEL_WEDGES.map((_, index) => index);
    expect(nextUnmarkedWedge(0, all)).toBe(-1);
  });

  it('hands the rare prize over once it is the only wedge standing', () => {
    // This is the promise the mechanic makes: keep spinning and the sliver
    // stops being a long shot.
    const rareIndex = WHEEL_WEDGES.findIndex((w) => w.rare);
    const everythingElse = WHEEL_WEDGES.map((_, i) => i).filter((i) => i !== rareIndex);
    for (let from = 0; from < WHEEL_WEDGES.length; from++) {
      expect(nextUnmarkedWedge(from, everythingElse)).toBe(rareIndex);
    }
  });

  it('ignores marks that are not wedges', () => {
    expect(nextUnmarkedWedge(0, [999, -1])).toBe(0);
  });
});
