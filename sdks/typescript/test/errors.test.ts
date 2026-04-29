import { describe, it, expect } from 'vitest';
import {
  OpenAgentError,
  ConfigError,
  InputValidationError,
  IdentityError,
  CredentialError,
  VerificationError,
  SkillDeniedError,
  ErrorCode,
  wrapError,
  getErrorMessage,
} from '../src/errors.js';

describe('errors', () => {
  it('OpenAgentError carries code and context', () => {
    const err = new OpenAgentError('boom', {
      code: ErrorCode.UNKNOWN,
      context: { a: 1 },
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(OpenAgentError);
    expect(err.code).toBe(ErrorCode.UNKNOWN);
    expect(err.context).toEqual({ a: 1 });
    expect(err.toJSON()).toMatchObject({ name: 'OpenAgentError', code: ErrorCode.UNKNOWN });
  });

  it('subclasses preserve instanceof chain', () => {
    const configErr = new ConfigError('bad');
    const inputErr = new InputValidationError('bad input');
    const identityErr = new IdentityError('x', { code: ErrorCode.IDENTITY_CREATE_FAILED });
    const credErr = new CredentialError('y', { code: ErrorCode.CREDENTIAL_FETCH_FAILED });
    const verErr = new VerificationError('z', { code: ErrorCode.VERIFICATION_FAILED });
    const skillErr = new SkillDeniedError('frontend-design');

    for (const e of [configErr, inputErr, identityErr, credErr, verErr, skillErr]) {
      expect(e).toBeInstanceOf(OpenAgentError);
      expect(e).toBeInstanceOf(Error);
    }
    expect(configErr.code).toBe(ErrorCode.INVALID_CONFIG);
    expect(inputErr.code).toBe(ErrorCode.INVALID_INPUT);
    expect(skillErr.code).toBe(ErrorCode.SKILL_DENIED);
    expect(skillErr.skill).toBe('frontend-design');
    expect(skillErr.context).toMatchObject({ skill: 'frontend-design' });
  });

  it('wrapError passes through OpenAgentError', () => {
    const orig = new ConfigError('orig');
    expect(wrapError(orig, 'x')).toBe(orig);
  });

  it('wrapError wraps native errors', () => {
    const native = new TypeError('bad');
    const wrapped = wrapError(native, 'fallback');
    expect(wrapped).toBeInstanceOf(OpenAgentError);
    expect(wrapped.cause).toBe(native);
    expect(wrapped.message).toBe('bad');
  });

  it('wrapError uses fallback for non-Error values', () => {
    const wrapped = wrapError({ random: true }, 'fallback-msg');
    expect(wrapped.message).toBe('fallback-msg');
  });

  it('getErrorMessage handles all types', () => {
    expect(getErrorMessage(new Error('hi'))).toBe('hi');
    expect(getErrorMessage('str')).toBe('str');
    expect(getErrorMessage(42)).toBe('Unexpected error');
    expect(getErrorMessage(null)).toBe('Unexpected error');
  });
});
