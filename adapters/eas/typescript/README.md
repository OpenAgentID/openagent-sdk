# @openagentid/anchor-eas

Ethereum Attestation Service (EAS) adapter for the OAS lineage anchor seam — resolution via EAS GraphQL, publishing via the maintained EAS SDK.

- **Resolution** (verifier path): reads lineage authority from attestations over native fetch. Root anchors are attestations under the OAS lineage schema; the latest attestation for a subject wins; a `revoked` latest attestation means the subject is revoked.
- **Publishing** (issuer path): writes anchors as attestations through the maintained EAS SDK with a viem-compatible signer.

The recipient of every attestation is `didRecipient(did)` — `BLAKE3(did)[0..20]`, deterministic and normative, so "all attestations about this DID" is an exact-match query.

## Install

```sh
npm install @openagentid/anchor-eas
```

## Resolve lineage anchors

```ts
import { EasAnchorResolver } from '@openagentid/anchor-eas';

const resolver = new EasAnchorResolver({
  schemaUid: '0x…', // OAS lineage schema UID on this chain
  graphqlUrl: 'https://base.easscan.org/graphql',
  rpcUrl: 'https://mainnet.base.org',
  confirmationDepth: 64, // default
});

const root = await resolver.getRoot('did:oas:l1fe:hmr:alice', 'hmr');
const revocation = await resolver.checkRevocation('did:oas:l1fe:hmr:alice');
```

## Publish lineage anchors

```ts
import { EasAnchorPublisher } from '@openagentid/anchor-eas';

const publisher = new EasAnchorPublisher({
  schemaUid: '0x…',
  easContractAddress: '0x…',
  signer, // any viem-compatible signer the EAS SDK accepts
});

const uid = await publisher.publishAnchor({
  did: 'did:oas:l1fe:hmr:alice',
  kind: 'hmr',
  status: 'active',
  metadataCommitment: '0x…',
  anchoredAtBlock: 12345678n,
});

await publisher.revoke(uid);
```

## Links

- [openagent.id](https://openagent.id)
- [GitHub repository](https://github.com/OpenAgentID/openagent-sdk)

## License

Apache-2.0 OR MIT © L1fe AI
