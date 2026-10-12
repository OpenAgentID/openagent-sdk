# Real OAS descendants with the OpenAgent SDK

```sh
npm install
npm start
```

Runs locally on Node 20+ with no account. The published OAS SDK generates and
signs a root and two descendant documents. `createOasIdentityProvider` connects
those real APIs to `OpenAgentRuntime`, while an explicit receiver-owned policy
allows only scopes held by the local parent. An amplification attempt must fail.

This example demonstrates signed portable lineage and local policy. It does not
claim public registration, LifeID ownership, broker capabilities or authenticated
HTTP requests. Production applications supply durable storage, signer custody
and their own owner/root authorization. No private keys are printed.
