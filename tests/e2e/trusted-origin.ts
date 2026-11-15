/**
 * The Vercel Deployment Protection bypass secret may only be sent to a deployment we recognise. A wrong or
 * attacker-influenced BASE_URL (for example a malformed deployment event) must never receive it.
 *
 * Trusted: https on *.vercel.app, or an https host listed in BYPASS_ALLOWED_HOSTS (comma-separated, exact match).
 */
export function isTrustedBypassTarget(baseUrl: string, allowedHosts: string = ''): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase();
  const extra = allowedHosts
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '');
  return host.endsWith('.vercel.app') || extra.includes(host);
}
