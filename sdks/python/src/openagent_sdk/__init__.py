"""OpenAgent SDK — identity, authentication, and ACT verification for agents.

Four lines to verify a capability token:

```python
from openagent_sdk import Verifier, Scope

verifier = Verifier(
    [broker_public_key],
    "arsenal:broker:prod-1",
    "my-service",
    required_scopes=[Scope.parse("tools:calendar:invoke")],
)
claims = verifier.verify(token_bytes)
```

The façade (`Agent`, `Session`) covers identity, the Core Protocol
challenge-response flow, and grant requests; `act`, `keys`, and
`middleware` stay reachable underneath — the façade is the front door, not
a reduced API.
"""

from .act import (
    ALGORITHM_ED25519,
    FORMAT_VERSION,
    MAX_ACT_BYTES,
    ActClaims,
    ActEnvelope,
    Verifier,
    decode_unverified,
    verify,
    verify_builder,
)
from .agent import Agent, Session
from .errors import (
    ActError,
    AudienceMismatch,
    ClaimsDecode,
    ConfigError,
    EnvelopeDecode,
    Expired,
    IssuerMismatch,
    MalformedScope,
    MalformedSignature,
    MissingScope,
    NotYetValid,
    OpenAgentError,
    SignatureInvalid,
    TooLarge,
    UnsupportedAlgorithm,
    UnsupportedVersion,
)
from .keys import (
    AgentKeys,
    from_env,
    from_seed,
    from_seed_file,
    from_seed_hex,
    generate,
    save_seed,
    seed_to_hex,
)
from .scope import Scope

__version__ = "0.1.0"

__all__ = [
    "ALGORITHM_ED25519",
    "FORMAT_VERSION",
    "MAX_ACT_BYTES",
    "ActClaims",
    "ActEnvelope",
    "ActError",
    "Agent",
    "AgentKeys",
    "AudienceMismatch",
    "ClaimsDecode",
    "ConfigError",
    "EnvelopeDecode",
    "Expired",
    "IssuerMismatch",
    "MalformedScope",
    "MalformedSignature",
    "MissingScope",
    "NotYetValid",
    "OpenAgentError",
    "Scope",
    "Session",
    "SignatureInvalid",
    "TooLarge",
    "UnsupportedAlgorithm",
    "UnsupportedVersion",
    "Verifier",
    "decode_unverified",
    "from_env",
    "from_seed",
    "from_seed_file",
    "from_seed_hex",
    "generate",
    "save_seed",
    "seed_to_hex",
    "verify",
    "verify_builder",
    "__version__",
]
