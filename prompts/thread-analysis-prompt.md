Analyze the thread timeline below and produce a thread-level work summary.

## Analysis focus areas

1. **Current status** — Where does this thread stand right now? Is it waiting for someone, resolved, or stalled? (2-3 sentences)
2. **Key decisions** — What has been agreed or decided? Cite the sourceMailId and who made the decision.
3. **Open questions** — What is still unresolved or under discussion?
4. **Action items** — Who needs to do what, by when? Only include items with clear evidence in the timeline.
5. **Waiting on** — Is someone blocking progress? Who?
6. **Risks** — Concrete risks visible in the conversation (missed deadlines, conflicting instructions, scope changes, resource gaps). Rate as low/medium/high.
7. **Need my reply** — Does the recipient need to respond? Be specific about what they should say or decide.
8. **Draft reply** — When a reply is clearly needed, draft a concise plain-text response. When not needed, leave empty.

## Summary requirements

The `oneLineSummary` should capture the thread essence in one sentence.
The `currentStatus` should be 2-3 sentences answering: what is the current state, who is the ball with, and what happens next.

## Confidence and partial context

- If some messages are blocked by security classification, acknowledge the gap and lower confidence.
- Set `partialContext: true` when the visible timeline alone is insufficient for a complete picture.
- Prefer `needsOriginalMailCheck: true` over confident wrong conclusions.

Treat blocked or partial security context as incomplete evidence.
