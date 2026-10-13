import { setActCryptoBinding } from '@openagentid/sdk';
import { act_verify } from '@openagentid/crypto-wasm';
// Node conditional exports load the actual packaged WASM.
setActCryptoBinding({ act_verify });
