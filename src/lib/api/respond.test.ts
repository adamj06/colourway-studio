import { describe, expect, it } from 'vitest';
import { VamError } from '../vam/client';
import { errorBody, vamErrorToResponse } from './respond';

describe('errorBody', () => {
  it('wraps code and message in an error object', () => {
    expect(errorBody('not_found', 'No such design')).toEqual({
      error: { code: 'not_found', message: 'No such design' },
    });
  });
});

describe('vamErrorToResponse', () => {
  it.each([
    ['not_found', 404],
    ['invalid_input', 400],
    ['timeout', 504],
    ['upstream', 502],
    ['invalid_response', 502],
  ] as const)('maps VamError %s to HTTP %i', (code, status) => {
    const out = vamErrorToResponse(new VamError(code, 'internal detail'));
    expect(out.status).toBe(status);
    expect(out.body.error.code).toBe(code);
    expect(out.body.error.message.length).toBeGreaterThan(0);
  });

  it('maps an unknown error to 500 with a generic message that hides the original', () => {
    const out = vamErrorToResponse(new Error('connect ECONNREFUSED sk-secret-12345 at /srv/app/key.pem'));
    expect(out.status).toBe(500);
    const serialised = JSON.stringify(out.body);
    expect(serialised).not.toContain('sk-secret-12345');
    expect(serialised).not.toContain('ECONNREFUSED');
    expect(serialised).not.toContain('key.pem');
    expect(serialised).not.toContain(' at ');
    expect(out.body.error.code).toBe('internal');
  });

  it.each([null, undefined, 'a string', 42, { message: 'sk-secret-12345' }])(
    'maps the non-error %j to 500',
    (thrown) => {
      const out = vamErrorToResponse(thrown);
      expect(out.status).toBe(500);
      expect(JSON.stringify(out.body)).not.toContain('sk-secret-12345');
    },
  );

  it('does not leak the VamError message for upstream failures either', () => {
    const out = vamErrorToResponse(new VamError('upstream', 'upstream said sk-secret-12345', 503));
    expect(JSON.stringify(out.body)).not.toContain('sk-secret-12345');
  });
});
