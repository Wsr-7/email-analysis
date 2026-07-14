# Release v1.0.0: EasyMail - Outlook-to-VS-Code Mail Triage Platform

## Overview

This release marks the first stable version of **EasyMail**, a Windows-native VS Code extension that brings intelligent mail triage and analysis directly into your development workspace. EasyMail leverages GitHub Copilot's language models to help users efficiently manage, prioritize, and respond to email from classic desktop Outlook.

## Key Features

### 📧 Local Mail Collection & Organization
- **Non-invasive collection**: Connects to Outlook via Windows COM automation without requiring API integrations
- **Flexible filtering**: Collect mail by recent-hours window or maximum item count across selected Outlook folders
- **Calendar awareness**: Automatically syncs upcoming meetings alongside email data
- **Local-first storage**: All data persists in VS Code workspace storage for privacy and performance
- **Sample mode**: Explore the full workflow with generated sample data before connecting real Outlook instance

### 🤖 Copilot-Assisted Triage & Analysis
- **Smart threading**: Automatically groups related messages and trims redundant quoted histories
- **Classification-aware**: Analyzes mail with configurable confirmation gates for high-priority items
- **Batch and selective analysis**: Process queued items, specific threads, or entire mail batches
- **Real-time feedback**: Analysis results display directly within the extension sidebar and workbench

### ✍️ Draft & Response Management
- **AI-powered drafting**: Generate, polish, and refine reply proposals using Copilot
- **Safe composition**: Drafts are handed to Outlook's native compose window; EasyMail never sends mail automatically
- **Bilingual support**: Switch UI and analysis between English and Simplified Chinese
- **Full mail context**: Dedicated workbench pane displays complete mail, thread, meeting, and analysis details

## Technical Highlights

### Architecture
- **Modular design**: Clear separation between collection, analysis, triage, and UI layers (see [Architecture](./docs/architecture.md))
- **Non-invasive COM automation**: Uses VBScript and Windows Script Host for Outlook integration with no external service dependencies
- **Copilot API integration**: Integrates with GitHub's Language Model API for flexible model selection
- **Persistence layer**: Structured data storage with support for incremental updates and history retention

### Security & Privacy
- **Zero external uploads**: Mail content remains on the user's machine; only analysis excerpts are sent to Copilot
- **Redaction boundaries**: Configurable excerpt length and analysis scope to control data exposure
- **Local classification**: All data classification and filtering occurs within VS Code
- Detailed security model documented in [Security Guide](./docs/security.md)

### Configuration & Extensibility
- **VS Code Settings integration**: All settings use the `easyMail.*` namespace for consistency
- **Folder selection UI**: Interactive QuickPick for selecting Outlook folders with visual feedback
- **Model flexibility**: Support for any Copilot model available in the current VS Code environment
- **Adjustable gating**: Fine-tune automatic analysis triggers based on mail classification level

## Changes in This Release

### Additions (+1,513 lines)
- Complete extension scaffolding and activation logic
- Sidebar triage view with category counts and queue visualization
- Workbench reading pane for mail, threads, and analysis details
- Copilot model loading and selection interface
- VBScript COM collectors for Outlook mail and meetings
- Reply draft generation, editing, and Outlook composition bridge
- Comprehensive command palette with user-facing commands
- Sample data generator for testing without Outlook
- Configuration schema and settings validation

### Removals & Refactoring (-19,489 lines)
- Cleaned up prototype and experimental code paths
- Removed development-only utilities and debug scripts
- Consolidated legacy interfaces and data structures
- Simplified manifest and dependency declarations

### Changed Files
- **145 files modified** across UI components, collectors, API layers, and configuration

## Documentation

Complete documentation is available in the `docs/` directory:
- **[User Guide](./docs/user-guide.md)** — Commands, UI components, and configuration reference
- **[Development](./docs/development.md)** — Build, test, sample validation, and packaging instructions
- **[Architecture](./docs/architecture.md)** — Runtime flow, module boundaries, and persistence model
- **[Security](./docs/security.md)** — Data handling, privacy boundaries, and redaction controls
- **[Acceptance Testing](./docs/acceptance.md)** — Automated and manual test procedures

## Getting Started

1. **Install**: Download the latest VSIX package from [Releases](./releases)
2. **Explore**: Run `EasyMail: Generate Sample Digest` to test without Outlook
3. **Connect**: Run `EasyMail: Select Outlook Folders` to configure mail sources
4. **Fetch**: Use `EasyMail: Fetch New Mail` to collect inbox data
5. **Analyze**: Load a Copilot model and run `Analyze Next Batch` to begin triage

## System Requirements

- **OS**: Windows only (Outlook COM automation not available on macOS/Linux)
- **Mail Client**: Classic Outlook desktop application (not Outlook on Web or new Outlook client)
- **VS Code**: Latest stable version with Language Model API support
- **GitHub Copilot**: Active subscription

## Known Limitations

- **Windows-only**: Relies on Outlook COM automation not available on other platforms
- **Classic Outlook only**: Supports desktop Outlook, not Web or new client versions
- **Mail body truncation**: Configurable limit (default 1500 characters, minimum 100)
- **Copilot availability**: Model selection depends on VS Code runtime and subscription status
- **Outlook profile variability**: Folder enumeration and recipient resolution behavior varies with profile configuration

## Contributing

Issues, suggestions, and pull requests are welcome. For development setup and contribution guidelines, see [Development](./docs/development.md).

---

**Version**: 1.0.0  
**Author**: [@Wsr-7](https://github.com/Wsr-7)  
**License**: [MIT](./LICENSE)
