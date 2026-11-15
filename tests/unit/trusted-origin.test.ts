import { describe, expect, it } from 'vitest';
import { isTrustedBypassTarget } from '../e2e/trusted-origin';

describe('isTrustedBypassTarget', () => {
  it.each(['https://colourway-studio-git-feat-x-adam.vercel.app', 'https://colourway.vercel.app/path?q=1'])(
    'trusts %s',
    (url) => {
      expect(isTrustedBypassTarget(url)).toBe(true);
    },
  );

  it.each([
    ['plain http', 'http://colourway.vercel.app'],
    ['a look-alike suffix', 'https://evilvercel.app'],
    ['vercel.app as a subdomain of another host', 'https://colourway.vercel.app.evil.test'],
    ['vercel.app only in the path', 'https://evil.test/colourway.vercel.app'],
    ['credentials in the URL', 'https://user:pw@colourway.vercel.app'],
    ['localhost', 'http://localhost:3000'],
    ['not a URL', 'not a url'],
    ['an empty string', ''],
  ])('rejects %s', (_why, url) => {
    expect(isTrustedBypassTarget(url)).toBe(false);
  });

  it('trusts an exact host from the allow list, case-insensitively and with spaces', () => {
    expect(isTrustedBypassTarget('https://colourway.example', ' colourway.example , other.test')).toBe(true);
    expect(isTrustedBypassTarget('https://COLOURWAY.example', 'colourway.example')).toBe(true);
  });

  it('does not trust a sibling or sub-domain of an allow-listed host', () => {
    expect(isTrustedBypassTarget('https://evil.colourway.example', 'colourway.example')).toBe(false);
    expect(isTrustedBypassTarget('https://colourway.example.evil.test', 'colourway.example')).toBe(false);
  });

  it('still requires https for an allow-listed host', () => {
    expect(isTrustedBypassTarget('http://colourway.example', 'colourway.example')).toBe(false);
  });

  it('ignores empty entries in the allow list', () => {
    expect(isTrustedBypassTarget('https://example.test', ',, ,')).toBe(false);
  });
});
