/**
 * A SYNTHETIC grok auth.json — the real shape, a fabricated credential. Shared by the probes that
 * must make grok open a session without being able to spend anything: grok starts the session (and
 * its MCP servers), then the first model request is rejected (401) because nothing here is a real
 * token. Used by probe-expired-session.mjs (contract §7 path C) and worker-marker-probe.mjs (§14).
 *
 * Only ever write this into a THROWAWAY GROK_HOME — GROK_HOME is the authoritative knob and
 * outranks HOME/USERPROFILE (contract §8) — and delete XAI_API_KEY / GROK_CODE_XAI_API_KEY from the
 * child env, or a rejected session could fall back to a real, metered key.
 */
import { randomBytes } from 'node:crypto';

// The auth.json entry key is `<oidc_issuer>::<oidc_client_id>` — MEASURED: the UUID equals the
// entry's own `oidc_client_id` field and matches no user/principal/team id. It identifies the
// grok CLI as an OAuth client (public by design, identical for every install), so it is a
// constant here, not a credential.
//
// It also has to be right: with any other UUID the CLI finds no entry for its client and every
// variant collapses into the plain "Not signed in" path B — which silently turned
// probe-expired-session.mjs into a duplicate of probe-unauth-device-flow.mjs. That happened, and
// only comparing against the real file's field caught it.
const OIDC_ISSUER = 'https://auth.x.ai';
const OIDC_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const rand = (n) => randomBytes(n).toString('base64url').slice(0, n);
const iso = (sec) => new Date(sec * 1000).toISOString().replace('Z', '000Z');

/** Real auth.json shape (grok 1.0.13, oidc): ES256 at+jwt access token + opaque refresh token. */
export function syntheticAuth(expSec) {
  const header = { typ: 'at+jwt', alg: 'ES256', kid: 'oauth2-production-2026-02-19' };
  const payload = {
    iss: OIDC_ISSUER, sub: '00000000-0000-4000-8000-000000000000',
    aud: 'https://api.x.ai', exp: expSec, iat: expSec - 21600, scope: 'api',
    principal_type: 'User', principal_id: '00000000-0000-4000-8000-000000000000',
    client_id: OIDC_CLIENT_ID,
    jti: '00000000-0000-4000-8000-000000000002', tier: 'free',
    team_id: '00000000-0000-4000-8000-000000000003',
  };
  return {
    [`${OIDC_ISSUER}::${OIDC_CLIENT_ID}`]: {
      key: `${b64u(header)}.${b64u(payload)}.${rand(86)}`,
      auth_mode: 'oidc',
      create_time: iso(expSec - 21600),
      user_id: '00000000-0000-4000-8000-000000000000',
      email: 'probe@example.com', first_name: 'Probe', last_name: 'Xx',
      profile_image_asset_id: rand(80),
      principal_type: 'User',
      principal_id: '00000000-0000-4000-8000-000000000000',
      team_id: '00000000-0000-4000-8000-000000000003',
      coding_data_retention_opt_out: false,
      refresh_token: rand(86),
      expires_at: iso(expSec),
      oidc_issuer: OIDC_ISSUER,
      oidc_client_id: OIDC_CLIENT_ID,
    },
  };
}
