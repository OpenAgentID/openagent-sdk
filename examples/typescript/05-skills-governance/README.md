# Contextual skills governance

```sh
npm install
npm start
```

Runs the actual published `@openagentid/skills-policy` engine through
`createSkillsPolicyInvoker`. The example proves unknown-skill denial, JSON
argument validation, invocation quota enforcement, and a verified audit chain.
Only the authorized callback runs. Edit `policy.yaml` to change the policy.

The context comes from the host application: bind it to the authenticated agent
and session, and pass consent only after the application's actual approval flow.
A SKILLS.md discovery manifest is not an authorization policy. This workflow
uses the package's supported policy YAML rather than inventing manifest fields.
