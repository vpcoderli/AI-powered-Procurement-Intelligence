/** Sessions, reset tokens and invitations require a readable expiry strictly after the current instant. */
export function isTokenUnexpired(expiresAt: string, now = Date.now()): boolean {
  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) && expiry > now;
}
