# Continue as Agent review page

A self-contained page showing the canonical `@openagentid/oidc/button` control:
several randomly generated year-round characters, light and dark, sizes, and
the disabled, loading, error and host-selected states. All variants are the same
recognizable button; only the avatar slot differs.

```sh
npm install @openagentid/oidc@0.3.0 @openagentid/sdk@0.7.2
npx serve .
```

Open `index.html` over HTTP. The import map resolves the installed packages
without a bundler. **Every callback here is a demo** that writes to the on-page
log; nothing contacts a server and no authorization flow starts. In a real
host, `onContinue` navigates to the application's own start route, for example
`/oauth/start`.

`tools/public-onboarding/verify-button.mjs` in the repository runs this page
against the packed archives in real Chromium and saves screenshots.
