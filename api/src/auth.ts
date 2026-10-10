import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { VerifyToken } from './types';

export function jwksVerifier(jwksUrl: string): VerifyToken {
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, jwks);
      if (typeof payload.sub !== 'string' || !payload.sub) return null;
      return { userId: payload.sub, name: typeof payload.name === 'string' ? payload.name : undefined };
    } catch {
      return null;
    }
  };
}
