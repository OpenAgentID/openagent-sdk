/**
 * Error types for the OIDC bridge.
 */

/** Error codes for OIDC bridge errors. */
export type OidcErrorCode =
  | 'DISCOVERY_ERROR'
  | 'JWKS_ERROR'
  | 'JWT_VALIDATION_ERROR'
  | 'UNKNOWN_ISSUER'
  | 'MAPPING_ERROR'
  | 'EXCHANGE_ERROR'
  | 'SIGNING_ERROR'
  | 'CONFIG_ERROR'
  | 'TRANSPORT_ERROR';

/** Base error class for all OIDC bridge errors. */
export class OidcBridgeError extends Error {
  readonly code: OidcErrorCode;

  constructor(code: OidcErrorCode, message: string) {
    super(message);
    this.name = 'OidcBridgeError';
    this.code = code;
  }

  /** Create a configuration error. */
  static config(message: string): OidcBridgeError {
    return new OidcBridgeError('CONFIG_ERROR', message);
  }

  /** Create a discovery error. */
  static discovery(message: string): OidcBridgeError {
    return new OidcBridgeError('DISCOVERY_ERROR', message);
  }

  /** Create a JWKS error. */
  static jwks(message: string): OidcBridgeError {
    return new OidcBridgeError('JWKS_ERROR', message);
  }

  /** Create a JWT validation error. */
  static jwtValidation(message: string): OidcBridgeError {
    return new OidcBridgeError('JWT_VALIDATION_ERROR', message);
  }

  /** Create an unknown issuer error. */
  static unknownIssuer(issuer: string): OidcBridgeError {
    return new OidcBridgeError('UNKNOWN_ISSUER', `Unknown issuer: ${issuer}`);
  }

  /** Create a mapping error. */
  static mapping(message: string): OidcBridgeError {
    return new OidcBridgeError('MAPPING_ERROR', message);
  }

  /** Create a token exchange error. */
  static exchange(message: string): OidcBridgeError {
    return new OidcBridgeError('EXCHANGE_ERROR', message);
  }

  /** Create a signing error. */
  static signing(message: string): OidcBridgeError {
    return new OidcBridgeError('SIGNING_ERROR', message);
  }

  /** Create a transport error. */
  static transport(message: string): OidcBridgeError {
    return new OidcBridgeError('TRANSPORT_ERROR', message);
  }
}
