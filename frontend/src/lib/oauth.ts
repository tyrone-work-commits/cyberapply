'use client';

export type OAuthProvider = 'google' | 'apple';
export type ProviderStatus = 'ready' | 'not_configured' | 'disabled' | 'unavailable';
export type AuthCapabilities = {
  auth_mode: 'local' | 'supabase'; google: boolean; apple: boolean; phone: boolean;
  providers?: Partial<Record<OAuthProvider | 'phone', ProviderStatus>>;
  email_delivery: 'capture' | 'smtp' | 'provider';
};
type OAuthAttempt = { verifier: string; provider: OAuthProvider; redirectUrl: string; createdAt: number };
const attemptKey = 'cyberapply-oauth-attempt';
const lifetime = 10 * 60 * 1000;

export function clearOAuthAttempt() {
  sessionStorage.removeItem(attemptKey);
  sessionStorage.removeItem('cyberapply-pkce');
}

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export async function prepareOAuth(provider: OAuthProvider) {
  clearOAuthAttempt();
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const redirectUrl = `${location.origin}/auth/callback`;
  // Only a short-lived verifier is kept here. Provider access tokens remain in memory until verified.
  sessionStorage.setItem(attemptKey, JSON.stringify({ verifier, provider, redirectUrl, createdAt: Date.now() }));
  return { code_challenge: base64url(new Uint8Array(hash)), redirect_url: redirectUrl };
}

export function consumeOAuthAttempt(): OAuthAttempt {
  const stored = sessionStorage.getItem(attemptKey);
  clearOAuthAttempt();
  let attempt: OAuthAttempt | null = null;
  try { attempt = stored ? JSON.parse(stored) : null; } catch { /* Invalid or obsolete browser state. */ }
  if (!attempt || !['google', 'apple'].includes(attempt.provider) || typeof attempt.verifier !== 'string'
      || !/^[A-Za-z0-9_-]{64}$/.test(attempt.verifier)
      || attempt.redirectUrl !== `${location.origin}/auth/callback` || typeof attempt.createdAt !== 'number'
      || !Number.isFinite(attempt.createdAt) || Date.now() - attempt.createdAt > lifetime || attempt.createdAt > Date.now() + 5000) {
    throw new Error('This sign-in attempt expired or started in another browser. Please start Google or Apple sign-in again in this tab.');
  }
  return attempt;
}

export function authorizationUrl(raw: unknown, provider: OAuthProvider, body: { redirect_url: string; code_challenge: string }) {
  if (typeof raw !== 'string') throw new Error('The sign-in service returned an invalid link. Please try again.');
  const url = new URL(raw);
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  if (!secure || url.username || url.password || url.hash || url.pathname !== '/auth/v1/authorize'
      || url.searchParams.get('provider') !== provider || url.searchParams.get('redirect_to') !== body.redirect_url
      || url.searchParams.get('code_challenge') !== body.code_challenge || url.searchParams.get('code_challenge_method') !== 's256') {
    throw new Error('The sign-in service returned an invalid link. Please try again.');
  }
  return url.href;
}

export function providerMessage(provider: OAuthProvider, capabilities: AuthCapabilities | null) {
  const name = provider === 'google' ? 'Google' : 'Apple';
  if (capabilities?.providers?.[provider] === 'unavailable') return `${name} sign-in is temporarily unavailable. Please try again.`;
  return `${name} sign-in isn’t set up for this app yet. You can use email while it is being connected.`;
}
