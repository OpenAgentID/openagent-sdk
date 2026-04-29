# SKILLS.md

## draft-pr-comment
description: Draft a comment on a pull request.
scopes: [github:pulls:comment, openai:chat:invoke]
policy:
  allow: always

## merge-pr
description: Merge a pull request. High-risk — always deny unless policy is explicitly relaxed.
scopes: [github:pulls:merge]
policy:
  allow: never
