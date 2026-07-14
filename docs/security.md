# Security and Privacy

## Local-first boundary

EasyMail has no product cloud service. Outlook collection uses local VBScript COM automation, and runtime data is stored beneath VS Code's `ExtensionContext.globalStorageUri`.

EasyMail does not automatically send, delete, move, or modify Outlook messages. Opening a reply, reply-all, or forward action creates an Outlook compose window only; the user reviews and sends it in Outlook.

## Copilot analysis boundary

Mail content is sent to a model only when the user starts an EasyMail analysis or draft-assistance action. The request goes through the VS Code Language Model API to the selected GitHub Copilot model. Model availability, consent, data handling, subscription, and organization policy are governed by VS Code, Copilot, and the user's environment.

Do not treat generated analysis, a suggested deadline, or a draft reply as authoritative. Review the original Outlook item before acting.

## Classification and gate

EasyMail classifies content using configured levels and keywords. The security gate makes one of three decisions before model analysis:

- **Allow**: the item is within the configured automatic-analysis threshold.
- **Manual confirmation**: the item is visible but requires the user to explicitly confirm analysis.
- **Block**: the item is not sent to the model.

The configurable classification and security keyword settings can strengthen, relax, or disable individual keyword rules. Review these settings before using EasyMail on sensitive mail.

## Redaction

The redaction policy transforms configured sensitive patterns in model payloads. Built-in handling covers common email addresses, URLs, IP addresses, phone numbers, money amounts, and custom patterns. Thread and stored-mail redaction also covers attachment names where applicable.

Redaction reduces exposure; it is not a guarantee that every sensitive value is removed. Use the security gate and organization-approved Copilot configuration for sensitive material.

## Webview and package boundary

Sidebar, Workbench, and Guide HTML use nonce-based Content Security Policy and event listeners instead of inline handlers. The VSIX is an explicit runtime allow-list: it contains compiled runtime modules, four Outlook VBS scripts, prompts, runtime icons, the user guide, default configuration, license, and Marketplace README; it excludes tests, local archives, agent instructions, and development scripts.

## Operational checklist

1. Confirm the mailbox, Outlook profile, Copilot account, and organization policy are appropriate for the data being analyzed.
2. Set folder scope, retention, classification, keyword, and redaction settings before a first live pull.
3. Use Sample mode to validate the local UI before a live mailbox test.
4. Verify manual-confirm and blocked behavior with representative content before relying on automatic analysis.
5. Keep VS Code and Outlook access controlled because local stored data can contain mail-derived content.
