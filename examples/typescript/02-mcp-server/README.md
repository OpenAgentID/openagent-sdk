# Authenticated MCP server

Runs a real MCP server in a separate stdio process. It creates actual Ed25519 signer and receiver workspaces, pins the public identity at the receiver, proves an authenticated echo call, and rejects unsigned/revoked calls.

```sh
npm install
npm run typecheck
npm start
```

Requires Node.js 20+ and the released OpenAgentID packages pinned in package.json.
No hosted OpenAgentID account or API key is needed. Private keys and receiver state
remain in a new `.openagent-example/` directory under this example on every run.
Never commit that directory. These deliberately authorized local receiver pins
are local application trust, not claims of LifeID ownership or global registration.

The main SDK is `@openagentid/sdk@0.7.2` or its compatible patch. The integration
is `0.2.0`. Release qualification runs the same commands against packed artifacts
before publication.
