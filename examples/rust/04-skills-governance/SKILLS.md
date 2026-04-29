# SKILLS.md

## web-search
description: Search the web for factual information.
scopes: [tavily:search:invoke]
policy:
  allow: always

## delete-file
description: Delete a file from the repository. High-risk.
scopes: [github:repo:write]
policy:
  allow: never

## send-email
description: Send an email on behalf of the user.
scopes: [postmark:email:send]
policy:
  allow: if approval.active("human:alice", maxAgeSeconds=60)

## deploy-prod
description: Deploy to production.
scopes: [deploy:prod:invoke]
policy:
  allow: if rate.hourly("deploy-prod") < 3
  deny: if now().hour < 9 or now().hour > 17
