# Hearth

Hearth is a small desk companion for Windows. A glowing orb sits in a pill at the bottom of your screen. It breathes with you and listens only when you hold the talk keys. It answers out loud, using your live wellness signals from the webcam, Presage's own insights about them, your reminders, and any read-only apps you have connected.

Built for the DEV.to Presage SmartSpectra challenge. Hearth is a wellness companion, not a medical device.

## Features

- **Live signals from the webcam.** The SmartSpectra SDK measures pulse, breathing rate, HRV (RMSSD), blinks, talking and presence on the device, with a confidence value for each reading.
- **Presage Insights.** Presage's vitals model writes plain-language insights about the session. Hearth can also ask it a question when you want to know how you're doing.
- **Push-to-talk voice.** Hold the talk keys, speak, and let go. AssemblyAI streams the transcript, the model answers, and AssemblyAI voices the reply.
- **A considerate observer.** Hearth suggests a break after long sitting, and a slower breath when your pulse rises above your own session baseline or your breathing runs quick. It also speaks reminders when they come due. It stays silent for the first 5 minutes of a session, waits at least 15 minutes between nudges, allows 3 an hour at most, and never speaks first in quiet mode. The Timeline records every time it held back, and why.
- **Memory and reminders.** Hearth keeps a rolling summary of your conversations and pins facts you ask it to remember. It can set spoken reminders and cancel them.
- **Read-only connectors.** MCP servers such as Notion, Linear, Atlassian, Todoist, GitHub, Sentry, Vercel and Linkup, plus your own. A gate exposes only tools that cannot write. Gmail, Google Calendar and Google Drive, and Composio's wider app catalog, come through a read-only Composio session.
- **Dashboard.** Pages for Today, Signals, Insights, Timeline, Memory, Reminders, Connectors, Voice and model, and Privacy.

## How SmartSpectra and Presage Insights are used

- The dashboard window captures the camera at 640x480 and runs a `SmartSpectraSDK` session from `@smartspectra/node-sdk/renderer`. It requests the breathing, cardio and face metrics. The main process does the processing through `bindSmartSpectraIpc` (`src/renderer/src/lib/sensing.ts`).
- Metric packets go to the main process (`src/main/vitals.ts`). There they become the live snapshot, 5-minute averages, session baselines and the history for the charts. The orb's breathing animation follows your measured breathing rate.
- Presage Insights arrive as protobuf `Insight` buffers. The Node SDK ships no decoder for them, so Hearth decodes them with `protobufjs` using the schema from the SmartSpectra docs (`src/main/insights.ts`). Each insight is saved locally. When an LLM key is set, the configured model also turns the insight into structured fields: a headline, metrics, observations and suggestions.
- The agent (`src/main/agent.ts`) has these tools for the signals:
  - `get_vitals` reads the live signals.
  - `recent_insights` reads the latest automatic insights.
  - `ask_presage_insight` sends your question to Presage through `sdk.requestInsight` and waits up to 30 seconds for the answer.

## Architecture

```
main (Node)                                  renderer (React 19 + Mantine 9)
  index.ts      windows, IPC, consent gate     pill/Pill.tsx         orb, captions, hold-to-talk
  hub.ts        state, settings, event log     dashboard/Dashboard   pages listed above
  vitals.ts     SmartSpectra metrics           lib/sensing.ts        camera + SmartSpectra session
  insights.ts   Presage Insight decoding       lib/mic.ts, player.ts microphone and reply audio
  conversation.ts, agent.ts, llm.ts            components/Consent    first-run consent
  observer.ts   when Hearth may speak first
  memory.ts, reminders.ts, mcp.ts, mcpAuth.ts
  composio.ts   Google apps and Composio's catalog
  voice/stt.ts, voice/tts.ts   AssemblyAI
  hotkey.ts     global talk keys (uiohook-napi)
```

Hearth has two windows. The **pill** is frameless, transparent and always on top, and it plays reply audio. The **dashboard** owns the SmartSpectra camera session. Both talk to the main process through `window.hearth`, which is defined in `src/preload`. The main process holds all state and pushes snapshots to both windows. The language model runs through the AI SDK with OpenAI or Anthropic.

## Setup

Requirements: Windows 10 or 11, Node 22 LTS, and a webcam.

```bash
cd hearth
npm install
```

Copy `.env.example` to `.env` in the same folder, next to `package.json`, and fill in your keys:

| Variable                                                   | Needed for                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `SMARTSPECTRA_API_KEY`                                     | camera vitals and Presage Insights                                                         |
| `ASSEMBLYAI_API_KEY`                                       | push-to-talk speech-to-text and Hearth's voice                                             |
| `LLM_PROVIDER`                                             | `openai` (default) or `anthropic`                                                          |
| `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MODEL_REASONING` | the model when the provider is `openai`; reasoning is `none` to `max`, and lower is faster |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`                     | only when `LLM_PROVIDER=anthropic`                                                         |
| `COMPOSIO_API_KEY`                                         | optional, Gmail, Calendar and Drive through Composio; see Connectors below                 |
| `HEARTH_TTS_VOICE`, `HEARTH_MCP_CONFIG`                    | optional overrides for the voice and the path to `mcp.json`                                |

Hearth starts without any of these keys, and the dashboard shows which ones are missing.

## Run and build

```bash
npm run dev          # development with hot reload
npm run typecheck    # node + web TypeScript checks
npm run lint
npm run build:win    # typecheck, build, then package with electron-builder
npm run build:unpack # unpacked build for a quick local test
```

`build:mac` and `build:linux` are also defined, but Hearth is developed and tested on Windows.

## Talk keys

| Action       | Keys                                                                               |
| ------------ | ---------------------------------------------------------------------------------- |
| Hold to talk | **Right Ctrl** (or Right Alt or Ctrl + Win, chosen in Voice and model)             |
| Hands-free   | **Right Ctrl + Space** to start, the talk keys again to send, **Esc** to cancel    |
| Mouse        | hold the orb in the pill                                                           |

Hands-free always uses the chosen talk keys plus Space.

The microphone opens only for those moments. Presses shorter than 250 ms are ignored.

## Connectors

- **OAuth sign-in.** On the Connectors page, click Sign in for a hosted server such as Notion, Linear, Atlassian, Todoist, Sentry or Vercel. Your browser opens the provider's sign-in page. Hearth registers itself and stores the tokens encrypted with Electron `safeStorage` (DPAPI on Windows).
- **API-key servers.** GitHub, Linkup and custom servers without OAuth take a pasted key, which is stored encrypted the same way. Use a read-only token for GitHub.
- **Read-only gate.** Every tool is denied unless it looks read-only. Hearth blocks a tool when the server marks it destructive or not read-only, or when its name contains a write verb such as send, create, update or delete. The Connectors page shows each tool with the reason it was allowed or blocked. In `mcp.json`, `allowTools` can allow a tool explicitly and `requireReadOnlyHint` can make the gate stricter.
- **Google (Gmail, Calendar, Drive) through Composio.** Hearth uses the official Composio SDK (`@composio/core` with the `@composio/vercel` AI SDK provider, in `src/main/composio.ts`). Composio supplies the Google OAuth app and keeps the tokens, so you don't need a Google Cloud client:
  1. In the [Composio dashboard](https://dashboard.composio.dev), choose **Platform**, open your project, then **Settings > API Keys > Create API Key**. Give it **Session management: Read and write**, **Session tool execution: Write only** and **Connected accounts: Read and write**, and nothing else. The For You key (`ck_...`) does not work here.
  2. Put the key (`ak_...`) in `COMPOSIO_API_KEY` and restart Hearth.
  3. On the Connectors page, click **Sign in** next to Gmail, Google Calendar or Google Drive and finish in your browser. **Sign out** deletes the connection on Composio.
- **How the Composio session stays read-only.** Hearth opens one session with tools tagged create, update or destructive turned off, so Composio hides them from search and refuses them if called. Raw API calls, the remote code sandbox and in-chat sign-in are off too. `GMAIL_FETCH_EMAILS`, `GOOGLECALENDAR_EVENTS_LIST` and `GOOGLEDRIVE_FIND_FILE` are loaded directly so everyday questions skip the search step. For anything else, the model uses Composio's search and executor, and Hearth checks every tool name the executor is asked to run against the same write-verb list as the MCP gate. Results are cut to 8,000 characters.
- **Composio Instant tools.** If you turn on **Instant Toolkits** in your Composio project settings, Composio's search can also run paid tools, such as web search or weather, on Composio's own accounts. They are charged to your Composio balance, and Hearth records each charge in the Timeline. They are off until you turn them on.
- **Google's sign-in screen asks for more than Hearth uses.** Composio's Google app requests full Gmail (`https://mail.google.com/`), Calendar and Drive access, plus basic profile and contacts. Hearth can only use read tools, as described above.
- **Your own servers.** Add any HTTP MCP server from the Connectors page. You can also list stdio or HTTP servers in `mcp.json`, which Hearth looks for in the project root or at `HEARTH_MCP_CONFIG`.

## Consent and Data Handling

Hearth shows a consent screen the first time you open it, before the camera or microphone can start. Until you choose **I agree**, three things stay off: sensing, push-to-talk and typed chat. The pill's orb opens the dashboard instead. The check runs in the dashboard, in the pill and in the main process. Without consent, the main process also refuses camera and microphone permission. You can open the screen again from **Privacy > Review consent** and withdraw consent there.

What the consent screen says, and what the code does:

- **Video stays on this device.** The SmartSpectra SDK processes camera frames locally. Frames are never stored or sent.
- **Derived numbers go to Presage.** Pulse, breathing and HRV values go to Presage to write insights and to answer your questions about them.
- **Your voice goes to AssemblyAI** only while you hold the talk keys or the orb, or in hands-free mode until you send. AssemblyAI also turns Hearth's replies into speech.
- **Your words go to the language model.** What you say or type goes to the provider in `LLM_PROVIDER`, along with a short summary of your signals, your memory and your reminders. Nudge lines and insight structuring use the same provider.
- **Connectors are read-only.** Hearth sees only the services you sign into, and it can only use their read tools.
- **Google apps go through Composio.** If you sign in to Gmail, Calendar or Drive, Composio stores that Google sign-in on its servers and relays the data Hearth reads. If Instant Toolkits are on in your Composio project, Composio's paid web tools use your Composio credits.
- **Everything else stays local.** Settings, memory, reminders, insights, the last exchange and the event log are saved in `%APPDATA%\hearth\hearth-data`. Connector tokens and keys are saved there too, encrypted.
- **Deletion.** **Privacy > Delete all local data** removes that folder, including your consent. That clears memory, reminders, insights and logs, and signs you out of every connector. It also asks Composio to delete this install's Google connections and its session.
- **SDK telemetry** is off by default. It never includes frames or vitals, and you can switch it on in Privacy.
- **Retention.** Data stays until you delete it. There are no servers or accounts beyond the providers above, Composio included.

## Wellness disclaimer

Hearth's signals are wellness estimates from a webcam. They are not medical readings. Hearth does not diagnose, treat or give medical advice. If you are worried about your health, talk to a professional.

## License

There is no license file yet, so all rights are reserved by the author.
