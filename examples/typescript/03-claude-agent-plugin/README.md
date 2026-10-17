# Native Claude Agent SDK hooks

Runs the actual typed options.hooks contract without a model call. Every capability check verifies possession with a real SDK signer/receiver workspace; the example proves allowed Read, denied Bash and revocation. Use the resulting options.hooks in query() for your authenticated model session.

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

The main SDK is `@openagentid/sdk@0.8.0`. The integration is `0.2.1`. Release qualification runs the same commands against packed artifacts
before publication.
