# Development

## Prerequisites

Developing and packaging EasyMail requires Node.js and npm. VS Code is not required to create a VSIX, but it is required for interactive extension validation. Real Outlook checks require Windows, classic Outlook, `cscript.exe`, and a mailbox that Outlook COM can access.

## Install, compile, and test

Run from the repository root:

```powershell
npm install
npm run compile
npm test
```

`npm run compile` clears `out/` and runs TypeScript. `npm test` compiles first, then runs the Node built-in test suite.

## Package and inspect the VSIX

```powershell
npm run package:vsix
npx vsce ls --readme-path docs/marketplace-details.md
```

The package is written to `releases/easymail-<version>.vsix`. VSIX creation works without the VS Code desktop app; installing and exercising the extension does not.

## Sample validation

```powershell
npm run validate:sample
```

This exercises the sample digest data path without Outlook or Copilot. It is a complement to, not a substitute for, installing the VSIX and validating Outlook/Copilot integration.

## Runtime scripts

The packaged extension uses these four VBScript entry points:

- `collect-outlook-mails.vbs`
- `collect-outlook-meetings.vbs`
- `compose-outlook-mail.vbs`
- `open-outlook-mail.vbs`

The collector supports `--sample`; the sample-validation and cleanup scripts are development-only tooling.
