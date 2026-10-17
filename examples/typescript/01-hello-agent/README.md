# Hello Agent

Run real Ed25519 identity verification locally with no hosted service or private
repository. Node 20+ is required; this example uses SDK 0.8.0.

```sh
npm install
npm start
```

The example creates separate signer and receiving-application workspaces on the
first run, explicitly trusts the public identity, signs a real issued challenge,
verifies it and proves replay is refused. Subsequent runs preserve keys and
trust. No fake broker, human owner or remote credential is involved. Private
workspace directories contain their own Git ignore rules; preserve and protect
them rather than committing or serving their contents.

This program exercises the SDK directly. For a complete HTTP application and
live browser avatars, follow the [starter quickstart](../../../docs/getting-started/quickstart-typescript.md).
The verified identity does not itself grant application permissions.

Licensed under Apache-2.0 OR MIT.
