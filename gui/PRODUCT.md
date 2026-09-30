# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

<!-- Cowbell is a Tauri desktop app: a web UI inside a desktop shell, so the platform value is `web` (a native wrapper does not make the design language native). -->

## Users
One person: a solo developer who runs several coding agents (Claude Code and others) side by side and does Flutter and Android work, on Windows today. macOS is planned (`docs/phase1_7-plan.md`). This is the owner's own workflow; no team or other audience is confirmed.

## Product Purpose
Cowbell is "a desktop for herdr". It is a fast GUI over herdr, the agent-aware terminal multiplexer. herdr owns the terminals and the agent state. Cowbell shows them and adds the tools that belong next to an agent session. Success: the developer sees which agent is working, done or waiting without switching panes, and starts the window in under a second.

## Positioning
- **Agent-aware terminal.** Live agent status dots, done notifications and Claude usage sit in the window chrome, on top of herdr's panes.
- **Fast native start.** A small portable `.exe` with a first-paint budget of under 1000 ms (`docs/phase1-spec.md`, `npm run bench:startup`). It does not bundle herdr.

## Operating Context
- Windows 11 first; the app ships as a portable `Cowbell.exe` with no installer.
- Workspaces and tabs hold herdr panes. A workspace can be a Flutter project.
- The developer works with `adb`, `flutter`, `git` and a phone on a USB cable. Android tools (run toolbar, scrcpy mirror, APK drop, screenshot) live in the title-bar run toolbar.
- herdr is a separate install. Cowbell runs herdr's official installer from herdr.dev on request.

## Capabilities and Constraints
- Capabilities in the code today: split panes, tabs and workspaces with colours; agent status; Claude usage bar; Flutter run toolbar (device picker, flavor, run, hot reload, hot restart); Android mirror through scrcpy and APK install by drop; git panel MVP.
- Claude usage comes from the statusLine tap file, chosen over Anthropic OAuth for terms-of-service reasons (`docs/phase1-spec.md`). The data folders `%APPDATA%\herdr-gui` and `%LOCALAPPDATA%\herdr-gui\logs` keep their old names on purpose: the user's statusLine points at them (`docs/cowbell-rebrand-spec.md`).
- scrcpy and adb are user-installed tools. Cowbell does not bundle them.
- Licence: FSL-1.1-ALv2. herdr is © Herdr, Inc. and contributors, Apache-2.0. Cowbell is not affiliated with or endorsed by herdr or Herdr, Inc.
- Undecided: macOS scope and timing; native (non-Flutter) Android project support.

## Brand Commitments
The name is Cowbell. The tagline is "Cowbell — a desktop for herdr". The icon is the blue cow (`src-tauri/icons/cowbell.svg`). The non-affiliation line stays wherever herdr is named.

## Evidence on Hand
- Specs and plans in `docs/` (`phase1-spec.md`, `ui-polish-spec.md`, `flutter-run-spec.md`, `git-mvp-spec.md`, `screenshot-spec.md`).
- App screenshots in `docs/screenshots/`.
- No customers, testimonials, benchmarks beyond the startup bench, or pricing exist. Do not invent them.

## Product Principles
1. The terminal panes are the product. Chrome stays small and never covers the work.
2. Agent state is visible at a glance, without switching panes.
3. Start-up speed is a feature with a budget. A change that breaks the budget needs a reason.
4. Keep herdr separate and credit it plainly. Never imply it is Cowbell's own.
5. Developer tools that sit beside an agent (run, mirror, screenshot, git) use the user's own installed tools and never bundle them.
