/**
 * Best-effort client IP extraction for rate limiting. Trusts standard proxy
 * headers (`x-forwarded-for`, `x-real-ip`) since production traffic is
 * expected to arrive through a reverse proxy / load balancer. Falls back to
 * a constant so unauthenticated rate limiting still degrades to a single
 * shared bucket rather than throwing when headers are absent (e.g. in tests
 * or direct local requests).
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [first] = forwardedFor.split(",");
    const trimmed = first?.trim();
    if (trimmed) return trimmed;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) {
    return realIp.trim();
  }

  return "unknown";
}
