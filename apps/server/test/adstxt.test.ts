import { describe, expect, it } from 'vitest';
import { adsTxtBody } from '../src/worker';

/**
 * ads.txt is an authorisation record: it tells advert buyers which publisher
 * is allowed to sell this site's inventory. Publishing one with a wrong or
 * placeholder ID does not fail loudly — it quietly vouches for the wrong
 * account — so the guard that refuses to write anything is worth pinning down.
 */
describe('ads.txt', () => {
  it('names the publisher, direct, with Google’s certification ID', () => {
    expect(adsTxtBody('pub-1234567890123456')).toBe(
      'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n',
    );
  });

  it('serves nothing until a publisher ID is set', () => {
    expect(adsTxtBody(undefined)).toBeNull();
    expect(adsTxtBody('')).toBeNull();
  });

  it('refuses the client form, which carries a ca- prefix the file must not', () => {
    expect(adsTxtBody('ca-pub-1234567890123456')).toBeNull();
  });

  it('refuses a placeholder rather than vouching for nobody', () => {
    expect(adsTxtBody('pub-XXXXXXXXXXXXXXXX')).toBeNull();
  });

  it('tolerates surrounding whitespace from a pasted value', () => {
    expect(adsTxtBody(' pub-1234567890123456 ')).toBe(
      'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n',
    );
  });
});
