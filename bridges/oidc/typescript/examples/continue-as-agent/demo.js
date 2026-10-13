// Demo wiring for the review page. Each callback is a stand-in for the host's
// real `onContinue`; see README.md for the actual /oauth/start integration.
import { mountContinueAsAgent } from '@openagentid/oidc/button';
import { getCharacterSkins } from '@openagentid/sdk/characters';

const log = document.querySelector('#log');
const lines = [];
function note(message) {
  lines.push(new Date().toISOString().slice(11, 19) + '  ' + message);
  log.textContent = lines.slice(-8).join('\n');
}

const handles = {};
const deferred = {};
function card(variant, caption, options) {
  const host = document.querySelector(`[data-variant="${variant}"]`);
  const slot = document.createElement('div');
  host.append(slot);
  const handle = mountContinueAsAgent(slot, options);
  const small = document.createElement('small');
  small.textContent = `${caption} · ${handle.appearance.skin}/${handle.appearance.shape}`;
  host.append(small);
  handles[variant] = handle;
  return handle;
}

const demoContinue = variant => ({ button }) => {
  note(`[demo] ${variant}: onContinue called (would start your /oauth/start here); label "${button.querySelector('.oaid-continue__label').textContent}"`);
};

for (const n of [1, 2, 3]) {
  card(`light-${n}`, 'Random year-round character', { theme: 'light', onContinue: demoContinue(`light-${n}`) });
  card(`dark-${n}`, 'Random year-round character', { theme: 'dark', onContinue: demoContinue(`dark-${n}`) });
}
card('large', 'Large size', { theme: 'light', size: 'large', onContinue: demoContinue('large') });
card('full-width', 'Full container width', { theme: 'light', fullWidth: true, onContinue: demoContinue('full-width') });
card('disabled', 'Disabled until the host is ready', { theme: 'light', disabled: true, onContinue: demoContinue('disabled') });
card('loading', 'Async callback: resolves after 2.5 s, duplicate clicks ignored', {
  theme: 'light',
  onContinue: () => new Promise(resolve => {
    note('[demo] loading: pending (demo promise, no network)');
    deferred.loading = resolve;
    setTimeout(() => { resolve(); note('[demo] loading: resolved'); }, 2500);
  }),
});
card('error', 'Async callback that rejects (demo failure)', {
  theme: 'light',
  onContinue: () => Promise.reject(new Error('demo: start route unavailable')),
  onError: error => note(`[demo] error: onError received "${error.message}"`),
});
card('selected', 'Host-selected agent DID (shown, not authenticated)', {
  theme: 'light',
  appearance: { did: 'did:oas:openagent:agent:review-selected-agent', skin: 'autos', accessories: ['glasses'] },
  onContinue: demoContinue('selected'),
});

// Exposed for the browser verifier and for manual inspection in devtools.
window.oaidContinueDemo = { handles, lines, deferred, mountContinueAsAgent, catalog: getCharacterSkins().map(family => family.id) };
note('[demo] mounted ' + Object.keys(handles).length + ' Continue as Agent buttons');
