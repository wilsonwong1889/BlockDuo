import { describe, expect, it } from 'vitest';
import { adsenseClientFrom } from '../src/ads/adsense';

/**
 * The only branch that matters here is the one that decides whether a third
 * party's script goes on the page. Anything short of a well-formed publisher
 * ID has to come back null, because the failure it prevents — a live site
 * carrying a broken or someone else's ad tag — is not one a build error would
 * catch.
 */
describe('adsense publisher id', () => {
  it('accepts the shape Google issues', () => {
    expect(adsenseClientFrom('ca-pub-1234567890123456')).toBe('ca-pub-1234567890123456');
  });

  it('tolerates the whitespace an environment variable picks up', () => {
    expect(adsenseClientFrom('  ca-pub-1234567890123456\n')).toBe('ca-pub-1234567890123456');
  });

  it('treats unset as off', () => {
    expect(adsenseClientFrom(undefined)).toBeNull();
    expect(adsenseClientFrom(null)).toBeNull();
    expect(adsenseClientFrom('')).toBeNull();
  });

  it('refuses an ID that is the wrong length', () => {
    expect(adsenseClientFrom('ca-pub-123')).toBeNull();
    expect(adsenseClientFrom('ca-pub-12345678901234567')).toBeNull();
  });

  it('refuses the ads.txt form, which omits the ca- prefix', () => {
    expect(adsenseClientFrom('pub-1234567890123456')).toBeNull();
  });

  it('refuses a placeholder left in by accident', () => {
    expect(adsenseClientFrom('ca-pub-XXXXXXXXXXXXXXXX')).toBeNull();
    expect(adsenseClientFrom('your-adsense-id')).toBeNull();
  });
});
