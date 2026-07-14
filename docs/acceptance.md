# Acceptance Matrix

Use this matrix for a release candidate built from the current repository state.

## Automated checks

| Check | Command | Expected result |
| --- | --- | --- |
| Compile | `npm run compile` | TypeScript exits successfully. |
| Unit tests | `npm test` | All Node tests pass. |
| Sample flow | `npm run validate:sample` | Sample digest pipeline succeeds without Outlook or Copilot. |
| Package | `npm run package:vsix` | A VSIX is written under `releases/`. |
| Package contents | `npx vsce ls --readme-path docs/marketplace-details.md` | Runtime files are present; tests, archives, agent files, and development scripts are absent. |
| Diff hygiene | `git diff --check` | No whitespace errors. |

## Installed VSIX smoke test

Install the newly built VSIX in VS Code, then:

1. Confirm EasyMail activates and its Activity Bar icon is visible in both common light and dark themes.
2. Open the Sidebar and Workbench.
3. Run **Generate Sample Digest** and open mail, thread, and meeting details.
4. Open **EasyMail: Open User Guide**.
5. Confirm the Sidebar range/model settings save and that a configuration-dependent action uses the latest visible value.
6. Confirm the Workbench timeline control switches ascending and descending order.

## Real Outlook and Copilot checks

Run these only on Windows with classic Outlook and an approved Copilot account:

1. Fetch new mail from each configured Outlook folder and use More History once.
2. Validate sender/recipient direction with a CC-only message.
3. Collect meetings, including a recurring series when available.
4. Open a mail and meeting in Outlook.
5. Open reply, reply-all, and forward compose windows; confirm no action sends mail automatically.
6. Exercise an allowed item, a manual-confirm item, and a blocked item through the analysis gate.
7. Run single-mail, batch, and thread analysis using an available Copilot model.
8. Generate a draft, polish/refine it, and confirm the resulting Outlook compose window contains the expected text.

Record environment-specific failures separately. Sample mode and unit tests do not establish real Outlook COM, Exchange, recurring-calendar, or Copilot-policy compatibility.
