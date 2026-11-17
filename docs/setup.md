# Setup

[Back to the README](../README.md)

## Install

You need Node 22 LTS and a webcam. Hearth is tested on Windows 10 and 11; macOS and Linux are experimental (see [below](#macos-and-linux)).

```bash
git clone https://github.com/md-abid-hussain/hearth.git
cd hearth
npm install
```

## Keys

Copy `.env.example` to `.env` next to `package.json` and fill it in. Hearth starts without any keys, and the dashboard shows which ones are missing.

| Variable | What it is for |
| --- | --- |
| `SMARTSPECTRA_API_KEY` | Camera vitals and Presage Insights. Register at [physiology.presagetech.com](https://physiology.presagetech.com/auth/register). |
| `ASSEMBLYAI_API_KEY` | Push-to-talk speech-to-text and Hearth's voice |
| `LLM_PROVIDER` | `openai` (the default) or `anthropic` |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MODEL_REASONING` | The model, when the provider is `openai`. Lower reasoning gives faster spoken replies. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Only when `LLM_PROVIDER=anthropic` |
| `COMPOSIO_API_KEY` | Optional. Gmail, Calendar and Drive, see [Apps and connectors](connectors.md). |
| `HEARTH_TTS_VOICE`, `HEARTH_MCP_CONFIG` | Optional. Another voice, or another path to `mcp.json`. |

## Run and build

```bash
npm run dev          # run with hot reload
npm run typecheck
npm run lint
npm run smoke        # after a build: start Hearth, check both windows render, then quit
npm run build:win    # Windows installer
npm run build:mac    # macOS disk image (Apple Silicon)
npm run build:linux  # AppImage and .deb
npm run build:unpack # unpacked build for a quick test
```

## Talking to Hearth

| To | Do this |
| --- | --- |
| Talk | Hold **Right Ctrl** (**Right Option** on a Mac), speak, let go. Other keys are in Settings. |
| Talk hands-free | The talk key **+ Space** to start, the talk key again to send, **Esc** to cancel |
| Use the mouse | Click Hearth's face to talk, click again to send. Drag the face to move it. |
| Type | Use the box on the Today page |

The microphone opens only while you talk. Presses shorter than 250 ms are ignored.

## macOS and Linux

These are experimental. On every push, [CI](../.github/workflows/ci.yml) builds Hearth on macOS (Apple Silicon) and Ubuntu, starts it, checks that both windows render and packages it. Nobody has tried sensing on them with a real camera yet.

**macOS**
- Apple Silicon only: SmartSpectra has no Intel build.
- Hearth asks for the camera and microphone after you agree to the consent screen.
- For the talk key to work in other apps, allow Hearth under **System Settings > Privacy & Security > Accessibility**, then restart it. Clicking the face works without this.
- A build you make yourself is unsigned, so the first launch needs right-click > Open.

**Linux**
- Ubuntu 22.04 or newer, or any distribution with glibc 2.35 or later.
- The talk key from other apps needs an X11 session. On Wayland, click Hearth's face to talk instead.
- App sign-ins are encrypted with your keyring, so you need GNOME Keyring or KWallet running.
- The widget needs a desktop with a compositor for its transparent window, which most have.
