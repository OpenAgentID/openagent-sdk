/** Aggregate component adapters for applications using all optional peers.
 * Import a specific @openagentid/sdk/integrations/<component> entry when using
 * one component, so its types do not require unrelated optional packages.
 * Runtime component instances are always explicitly injected. */
export { createOasIdentityProvider, type OasIdentityProvider, type OasIdentityStore,
  type OasIdentityRegistration } from './integrations/oas.js';
export { createAegisRequestAuthenticator } from './integrations/aegis.js';
export { createArsenalCapabilityFetch, type ArsenalIdentityBinding } from './integrations/arsenal.js';
export { createSkillsPolicyInvoker } from './integrations/skills-policy.js';
