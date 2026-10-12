import { setActCryptoBinding } from '@openagentid/sdk';
import { act_verify } from './.generated/wasm.js';
import { handleAgentRequest, type ReceiverEnvironment } from '../shared/receiver.js';

setActCryptoBinding({ act_verify });
export default { fetch: (request: Request, env: ReceiverEnvironment) => handleAgentRequest(request, env) };
