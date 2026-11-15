// Shared by the server-side param validation (params.ts, zod) and the client search box. Kept in its own
// dependency-free file so client components can import it without pulling zod into the first-load bundle.
export const MAX_QUERY_LENGTH = 100;
export const MAX_PAGE = 100;
