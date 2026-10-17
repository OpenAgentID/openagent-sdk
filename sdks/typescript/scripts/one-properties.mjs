/** Closed One implementation keys and public/dynamic keys protected during minification. */
export const ONE_INTERNAL_PROPERTIES = /^(?:_one[A-Z]\w*|inputAt|reach|scrolling|replaced|waitForInput|stopWaiting|release|cancel|tick|follows|visible|motionAllowed|setState|step|pointer|scheduleCadence|cutCadence|drop|snap|setVisible|show|hide|setRenderedSize|setReduced|setPaint|curves|cur|mv|cut|raw|face|tier|timelineEnd|setBlink|moving|request|following|held|setFace|entrance|cadenceRequest|nextCadence|restartWindow|noteInput|setSize|setKind|setMotion|startTalk|peek|sample|frame|geometry|finished|priority|uncounted|draws|duration|twos|tail|noTempo|scaled|px|kind|reduced|look|lift|open|tilt|smile|mouth|squash|rotate|hop|strokeWidth|discOpacity|start|level|pose|root|motion|win|head)$/;

export const ONE_PUBLIC_PROPERTIES = ['shape', 'color', 'theme', 'size', 'label', 'expression', 'state', 'animated', 'reducedMotion', 'cadence', 'group', 'voiceLevel', 'follow', 'viewer',
  'update', 'setAppearance', 'play', 'setReducedMotion', 'getState', 'dispose', 'status', 'blink', 'gaze', 'x', 'y', 'id', 'path', 'eye', 'scale',
  'openScale', 'lookGain', 'liftGain', 'openMax', 'mouthMax', 'mouthDy', 'pivot', 'temperament', 'never', 'disc', 'keyline', 'rim', 'opacity', 'flat', 'light', 'dark',
  'neutral', 'attentive', 'surprised', 'excited', 'happy', 'laughing', 'angry', 'sad', 'scared', 'suspicious', 'confused', 'curious', 'proud', 'shy', 'unimpressed',
  'sleepy', 'thoughtful', 'concerned', 'idle', 'listening', 'reasoning', 'working', 'speaking', 'success', 'blocked', 'error', 'typing', 'attention', 'paused', 'offline', 'done', 'waiting', 'thinking', 'quick', 'bouncy', 'neat', 'slow', 'dry', 'XS', 'S', 'M', 'L',
  'linear', 'shut', 'snap', 'settle', 'glide', 'emerge', 'charge', 'exit', 'wind', 'pop', 'brake', 'rise', 'fall', 'ui',
  'firm', 'bounce', 'boing', 'jelly', 'soft', 'xmlns', 'viewBox', 'overflow', 'fill', 'stroke', 'd', 'maskUnits'];
