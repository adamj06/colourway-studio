// Shared by the server-side param validation (params.ts, zod) and the client search box. Kept in its own
// dependency-free file so client components can import it without pulling zod into the first-load bundle.
export const MAX_QUERY_LENGTH = 100;
// The Morris & Co. set is 769 designs = 33 pages of 24 (api.vam.ac.uk, checked 2026-11-15). 40 leaves headroom for
// growth while bounding the number of distinct cache keys (and V&A calls) a client can generate per query.
export const MAX_PAGE = 40;
