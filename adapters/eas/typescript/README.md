# @openagentid/anchor-eas

Ethereum Attestation Service (EAS) adapter for the OAS lineage anchor seam — resolution via EAS GraphQL, publishing via the maintained EAS SDK.

- **Resolution** (verifier path): reads lineage authority from attestations over native fetch. Root anchors are attestations under the OAS lineage schema; the latest attestation for a subject wins; a `revoked` latest attestation means the subject is revoked.
- **Publishing** (issuer path): writes anchors as attestations through the maintained EAS SDK with its typed signer/provider. An arbitrary viem wallet is not automatically adapted.

The recipient of every attestation is `didRecipient(did)` — `BLAKE3(did)[0..20]`. A public schema and recipient are not proof of authority: the resolver requires an explicit trusted-attester allowlist and checks the decoded DID before returning a result. Native EAS revocation and expiration make an otherwise active anchor unusable.

## Install

```sh
npm install @openagentid/anchor-eas
```

## Resolve lineage anchors

```ts
import { EasAnchorResolver } from '@openagentid/anchor-eas';

const resolver = new EasAnchorResolver({
  schemaUid: process.env.OAS_SCHEMA_UID!, // 32-byte registered schema UID
  trustedAttesters: [process.env.OAS_ATTESTER!], // authorized 20-byte attester address
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
import { JsonRpcProvider, Wallet } from 'ethers';

// Install ethers for this example. Supply your authorized chain and signer.
const signer = new Wallet(process.env.EAS_SIGNING_KEY!, new JsonRpcProvider(process.env.EAS_RPC_URL!));

const publisher = new EasAnchorPublisher({
  schemaUid: process.env.OAS_SCHEMA_UID!,
  easContractAddress: process.env.EAS_CONTRACT_ADDRESS!,
  signer, // for example an ethers Signer connected to the intended chain
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

`signer` is typed from `EAS.connect`; use the maintained EAS SDK's documented
adapter if your wallet library exposes another shape. Schema registration,
chain selection, attester authorization and transaction funding remain explicit.
The package never chooses a chain or spends funds automatically.

## Compatibility test

```sh
npm install
npm run typecheck
npm test
npm run build
```

The integration test starts a local Hardhat EVM, deploys the released EAS
and SchemaRegistry bytecode, registers this schema, publishes a signed
attestation and revokes it. Its local HTTP index reads actual contract
state and proves the resolver recognizes the native revocation. No public
chain, funded wallet or external hosted account is needed.

## Links

- [openagent.id](https://openagent.id)
- [GitHub repository](https://github.com/OpenAgentID/openagent-sdk)

## License

Copyright © 2026 [L1fe Labs, Inc.](https://l1fe.ai)

Licensed under either of [Apache License 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT), at your option.
