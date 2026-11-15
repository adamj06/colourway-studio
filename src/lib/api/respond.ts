import { VamError, type VamErrorCode } from '../vam/client';

export type ErrorBody = { error: { code: string; message: string } };

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

// Fixed, user-safe messages. The original error message and stack are never sent to the client.
const KNOWN: Record<VamErrorCode, { status: number; message: string }> = {
  invalid_input: { status: 400, message: 'The request was not valid.' },
  not_found: { status: 404, message: 'That design could not be found.' },
  timeout: { status: 504, message: 'The V&A collection took too long to respond. Please try again.' },
  upstream: { status: 502, message: 'The V&A collection is unavailable right now. Please try again.' },
  invalid_response: { status: 502, message: 'The V&A collection sent something unexpected. Please try again.' },
};

export function vamErrorToResponse(error: unknown): { status: number; body: ErrorBody } {
  if (error instanceof VamError) {
    const known = KNOWN[error.code];
    return { status: known.status, body: errorBody(error.code, known.message) };
  }
  return { status: 500, body: errorBody('internal', 'Something went wrong on our side. Please try again.') };
}
