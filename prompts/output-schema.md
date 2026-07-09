Allowed priorities: P0, P1, P2, P3

Required top-level fields:
- generatedAt (ISO 8601 timestamp)
- overview
- items

Required overview fields:
- totalMails
- mustHandleToday
- risks
- waitingForMe
- notices

Required item fields:
- mailId (exact ID from the digest — do not modify)
- category
- priority
- subject
- sender
- receivedTime
- summary (2-3 sentences: what, why, action needed)
- reason (one sentence: why this category and priority were chosen)
- suggestedAction (specific next step, e.g. "Reply to confirm budget approval by EOD" not just "Reply")
- draftReply (plain text draft or empty string)
- confidence (0.0-1.0)
- needsOriginalMailCheck (boolean)

Optional item fields:
- source (mailId, internetMessageId, entryId, folder)
- evidence (array of {sourceMailId, quote, reason} — short excerpts that directly support the classification)
- draftReplyParts (GREETING, MAIN_MESSAGE, REQUESTED_ACTION, CLOSING)

Evidence rules:
- Only quote text that actually appears in the mail body or metadata.
- Use evidence to justify non-obvious classifications (e.g., why a seemingly routine mail is P0).
- Omit evidence when the classification is self-evident from the subject/sender.
- If evidence is uncertain, omit it and set `needsOriginalMailCheck: true`.

Return valid JSON only.
