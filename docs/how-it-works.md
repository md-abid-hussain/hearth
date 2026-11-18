# How it works

[Back to the README](../README.md)

## SmartSpectra in the code

- **Sensing.** The dashboard window runs a `SmartSpectraSDK` session from `@smartspectra/node-sdk/renderer` on 640x480 camera frames. It asks only for the readings switched on under **Signals > Readings**: pulse, breathing, HRV, blinks and talking, and facial expressions (off by default). At least one stays on; to stop the camera, stop sensing. The main process does the processing through `bindSmartSpectraIpc` ([`src/renderer/src/lib/sensing.ts`](../src/renderer/src/lib/sensing.ts)).
- **Signals.** Metric packets go to [`src/main/vitals.ts`](../src/main/vitals.ts), which keeps the live snapshot, 5-minute averages, a baseline for the session and the history for the charts. Hearth uses a reading only once the SDK marks it stable. The face breathes at your measured breathing rate.
- **Away.** When no face has been in view for 10 seconds, sensing pauses. It resumes the same session at your next key press or mouse move.

## Presage Insights in the code

- Insights arrive as protobuf `Insight` buffers. The Node SDK has no decoder for them, so Hearth decodes them with `protobufjs` using the schema from the SmartSpectra docs ([`src/main/insights.ts`](../src/main/insights.ts)).
- The agent ([`src/main/agent.ts`](../src/main/agent.ts)) has three tools for them:
  - `get_vitals` reads the live signals.
  - `recent_insights` reads the latest automatic insights.
  - `ask_presage_insight` sends your question to Presage through `sdk.requestInsight` and waits up to 30 seconds for the answer.
- Each new insight is sent to the language model once, to be laid out as a headline, metrics and suggestions. The latest one is also included with each question you ask, and `recent_insights` can return up to five.

## When Hearth speaks first

The observer ([`src/main/observer.ts`](../src/main/observer.ts)) suggests a break after 50 minutes of sitting, and a slower breath when your pulse rises above your own baseline or your breathing runs quick. It also says reminders when they come due.

To keep it from nagging:

- It stays silent for the first 5 minutes of a session.
- It waits at least 15 minutes between nudges, and 45 minutes before repeating the same one.
- It makes at most 3 nudges an hour.
- In quiet mode it never speaks first.
- If you start talking or press the talk key while it is writing a line, it stays quiet and tries again later.

When one nudge is waiting out its cooldown, another that is free to go still can. The Timeline page records when it held back, and why; a reason that lasts is logged once, not on every check.

## Reminders

Ask "remind me to stretch in 20 minutes" for a one-off, or "remind me to drink water every hour" for a repeat. A repeat is said up to 10 times, then stops; Hearth schedules each one itself, and cancelling stops the whole series ([`src/main/reminders.ts`](../src/main/reminders.ts)). Reminders survive a restart: a repeat skips the times it missed and carries on. A repeat said late keeps its rhythm, skipping to the next slot. Up to 20 reminders can wait at once.

## Check-ins

Ask "keep an eye on my eye strain every 10 minutes". Hearth tells you how it looks now, then sets a reminder for itself ([`src/main/checks.ts`](../src/main/checks.ts)).

Each time the reminder comes due, Hearth reads the signal again: blink rate for eyes, breathing, pulse, or all of them. If all is well, it stays silent and checks again later. If something is off, it tells you. If the camera has lost you, the check-in stops.

Up to 3 check-ins can run at once. Each runs for 2 hours unless you ask for another length (up to 4 hours, at most 24 checks), and none of them survive a restart.

## Architecture

```
main (Node)                                renderer (React 19 + Mantine 9)
  index.ts      windows, IPC, consent        pill/Pill.tsx          the face, captions, talking
  hub.ts        state, settings, log         dashboard/Dashboard    the pages
  vitals.ts     SmartSpectra metrics         lib/sensing.ts         camera + SmartSpectra session
  insights.ts   Presage Insights             lib/mic.ts, player.ts  microphone and reply audio
  agent.ts      the model and its tools      components/Consent     the consent screen
  observer.ts   when Hearth may speak first
  voice/        AssemblyAI speech in and out
  mcp.ts, composio.ts   read-only connectors
```

Hearth has two windows. The **widget** is Hearth itself: transparent and always on top. It plays Hearth's voice. The **dashboard** owns the camera session. Both talk to the main process through `window.hearth` ([`src/preload`](../src/preload)). The language model runs through the AI SDK with OpenAI or Anthropic.

Text read from your apps is treated as data, not instructions. Once Hearth has read an app during a reply, it cannot pin facts, set or cancel reminders, start check-ins or change quiet mode until your next message.
