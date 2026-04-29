// Central dispatch: route a vector to the per-category handler.

import { runCrypto } from './handlers-crypto.mjs';
import { runOas } from './handlers-oas.mjs';
import { runArsenal } from './handlers-arsenal.mjs';
import { runAegis } from './handlers-aegis.mjs';
import { runOpenagent } from './handlers-openagent.mjs';

export function handleVector(category, vector) {
  switch (category) {
    case 'crypto':
      return runCrypto(vector);
    case 'oas':
      return runOas(vector);
    case 'arsenal':
      return runArsenal(vector);
    case 'aegis':
      return runAegis(vector);
    case 'openagent':
      return runOpenagent(vector);
    default:
      throw new Error(`unknown category: ${category}`);
  }
}
