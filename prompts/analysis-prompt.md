Analyze every mail in the digest below. For each mail, determine category, priority, and produce a structured analysis.

## Category assignment rules

Evaluate in this order — assign the FIRST category that clearly fits:

1. **mustHandleToday** — The latest actionable mail explicitly requests the recipient's action today, contains a same-day hard deadline, or describes an active incident requiring immediate response. Do not use this only because the thread contains an older request.
2. **risk** — Contains contractual obligation, financial exposure, security concern, compliance issue, customer escalation, SLA breach, or missed-deadline consequence. The risk must be concrete, not hypothetical.
3. **importantSender** — Sender, recipient group, or subject matches a configured important sender/keyword. Use this unless a more urgent category (mustHandleToday, risk) clearly applies.
4. **waitingForMe** — The latest mail is explicitly waiting for the recipient's reply, approval, review, decision, or sign-off, but it is not clearly due today. Look for phrases like "please confirm", "awaiting your", "need your input", "could you review".
5. **followUp** — Useful information that may need tracking later but requires no immediate reply now. Do not use `followUp` for an older message in a thread when a later message already supersedes it or the recipient has already replied; use `ignored` or `notice` if no current action remains.
6. **notice** — Informational only: newsletters, automated notifications, system alerts (non-critical), distribution list broadcasts, read-only updates.
7. **ignored** — Clearly irrelevant: out-of-office auto-replies, duplicate notifications, spam-like internal broadcasts, already-handled items.
8. **uncertain** — Not enough context to classify confidently. Always set `needsOriginalMailCheck: true`.

## Priority assignment criteria

- **P0** — Must act within hours. Active incident, same-day hard deadline, executive escalation, customer-facing outage, contractual penalty trigger.
- **P1** — Must act within 1-2 business days. Approaching deadline, important approval pending, risk that worsens if delayed.
- **P2** — Should act this week. Useful follow-up, non-urgent review request, information that informs upcoming decisions.
- **P3** — No time pressure. Informational notices, newsletters, FYI items.

## Summary requirements

The `summary` field must be 2-3 sentences that answer:
1. **What**: What is this email about? (topic, request, or event)
2. **Why**: Why does it matter to the recipient? (impact, deadline, dependency)
3. **Action**: What specific action is needed, if any? (reply, approve, review, escalate, or none)

Do not merely restate the subject line. Extract the substantive content.

## Due date extraction

Set `dueDate` to `YYYY-MM-DD` only when the mail explicitly states a deadline. If the date is uncertain or only inferred, leave `dueDate` empty.

Attachment fields provide only the count and file names; attachment contents are not available — never claim to have read an attachment.

## Confidence scoring

- 0.9-1.0: Category, priority, and summary are well-supported by the mail content.
- 0.7-0.89: Reasonable inference but some ambiguity. Consider `needsOriginalMailCheck: true`.
- Below 0.7: Insufficient evidence. Use `uncertain` category and set `needsOriginalMailCheck: true`.

Return valid JSON only.
