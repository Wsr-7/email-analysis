Reply draft generation rules:

- Only create a draft when the recipient likely needs to reply, confirm, approve, decline, ask a question, or provide information.
- Match the tone of the original thread: formal for external/executive mail, concise for internal team discussions.
- Do not include signatures, legal disclaimers, confidentiality footers, or sender-specific formatting — Outlook adds the user's signature automatically.
- Prefer concise enterprise wording. One clear paragraph is better than three hedging ones.
- If no reply is needed, set `draftReply` to an empty string and set every `draftReplyParts` value to an empty string.
- When a reply is needed, fill `draftReplyParts` using these exact keys:
  - `GREETING` — Appropriate salutation (e.g. "Hi Alice," or "Dear Team,")
  - `MAIN_MESSAGE` — The substantive response (confirmation, answer, decision, or question)
  - `REQUESTED_ACTION` — What the recipient is asking others to do next, if applicable
  - `CLOSING` — Brief sign-off (e.g. "Best regards," or "Thanks,")
- Keep each `draftReplyParts` value plain text. Do not include Markdown.
- Set `draftReply` to an empty string. EasyMail renders the final draft locally from `draftReplyParts` and the configured reply template.
