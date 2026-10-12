import type { AegisClient, AuthCredential, Session } from '@openagentid/aegis-sdk';
import { didSchema, scopeSchema } from '../config.js';
import { assertAncestor, assertScopes, type AuthContext, type VerifyRequestOptions } from '../verification.js';

/** Convert actual AEGIS credential authentication into a request authenticator.
 * Identity lookup is never used as proof of possession. The authorization
 * callback must use server-owned lineage/scopes and receives the real session. */
export function createAegisRequestAuthenticator(options: {
  client: AegisClient;
  readCredential(request: Request): Promise<AuthCredential>;
  authorizeSession(session: Session, request: Request): Promise<AuthContext>;
}): (request: Request, requirements?: VerifyRequestOptions) => Promise<AuthContext> {
  return async (request, requirements = {}) => {
    const session = await options.client.authenticate(await options.readCredential(request), 'agent');
    try {
      const context = await options.authorizeSession(session, request);
      const now = Math.floor(Date.now() / 1000);
      const sessionExpiry = Math.floor(Date.parse(session.expiresAt) / 1000);
      if (!options.client.isSessionValid(session.sessionId) || context.did !== session.did ||
          !Number.isSafeInteger(sessionExpiry) || sessionExpiry <= now ||
          !Number.isSafeInteger(context.expiresAt) || context.expiresAt <= now ||
          context.lineage.length === 0 || context.lineage[0] !== context.root || context.lineage.at(-1) !== context.did ||
          new Set(context.lineage).size !== context.lineage.length) throw new Error('Invalid AEGIS authorization binding');
      context.lineage.forEach(did => didSchema.parse(did));
      context.scopes.forEach(scope => scopeSchema.parse(scope));
      if (requirements.requiredScopes) assertScopes(context, requirements.requiredScopes);
      if (requirements.requiredAncestor) assertAncestor(context, requirements.requiredAncestor);
      if (requirements.requirePrivilegedAuthority || requirements.requiredAuthorityPath) {
        throw new Error('Use PrivilegedAuthorityVerificationClient for privileged authority checks');
      }
      return { ...context, expiresAt: Math.min(context.expiresAt, sessionExpiry) };
    } finally {
      // This adapter authenticates one request, not a new browser session.
      if (options.client.isSessionValid(session.sessionId)) options.client.revokeSession(session.sessionId);
    }
  };
}

