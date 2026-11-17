# Setup

[Back to the README](../README.md)

## Install

You need Windows 10 or 11, Node 22 LTS and a webcam.

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
npm run build:win    # build a Windows installer
npm run build:unpack # unpacked build for a quick test
```

## Talking to Hearth

| To | Do this |
| --- | --- |
| Talk | Hold **Right Ctrl**, speak, let go. Right Alt or Ctrl + Win also work; choose in Settings. |
| Talk hands-free | **Right Ctrl + Space** to start, the talk key again to send, **Esc** to cancel |
| Use the mouse | Click Hearth's face to talk, click again to send. Drag the face to move it. |
| Type | Use the box on the Today page |

The microphone opens only while you talk. Presses shorter than 250 ms are ignored.
