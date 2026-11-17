---
title: "Hearth: a tiny desk companion that notices when you've been staring at the screen too long"
published: false
tags: devchallenge, presagechallenge, electron, ai
cover_image: UPLOAD demo/out/cover.png
---

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04).*

Most of my day happens in front of a screen. I blink less, my breathing gets shallow, and hours pass without me getting up. My laptop already has a camera pointed at me all day, so I wondered: what if it could notice, and look after me, kindly?

So I built **Hearth**: a small, warm face that lives at the edge of your screen. It reads your pulse, breathing, heart rate variability and blinks through the webcam with Presage SmartSpectra, talks with you, and speaks up only when it matters.

> **[CLIP 1: hero GIF, 6–8 s]** The real widget on a desktop: idle (it blinks and glances), hover so the bar opens, hold Right Ctrl and the face turns green, it thinks (violet, dots circling), then answers (its mouth moves).

## What I Built

Hearth is a Windows desk companion built with Electron. It has two parts:

- **The widget:** a little face that floats above your other windows. At rest it breathes, blinks, looks around and occasionally hops. Hover it and it opens into a bar. Hold **Right Ctrl** (or click its face) to talk, and it answers out loud. Leave it alone and it dozes off. Shake it while dragging it and it gets dizzy.
- **The dashboard:** your live signals, Presage's insights, a timeline of everything Hearth did (and everything it decided *not* to do), reminders, memory, connected apps and privacy controls.

What it does with your signals:

- **Gentle nudges.** A break after long sitting, and a slower breath when your pulse rises above *your own* session baseline or your breathing runs quick.
- **Check-ins.** Say "keep an eye on my breathing every minute" and Hearth sets a reminder for itself. Each time, it re-reads the signal, stays quiet while things look fine, and speaks up when they don't.
- **Answers about you.** "How am I doing?" draws on your live signals and on Presage's own insights about them.
- **Reminders that respect you.** It waits until you've stopped talking. In quiet mode, it sends a Windows notification instead of speaking.
- **Your day, read-only.** Ask about your calendar or email. Connected apps (Gmail, Calendar and Drive through Composio, plus MCP servers like Notion and Linear) are read-only by construction.

Hearth is a wellness companion, not a medical device. Every number is a wellness estimate, and it never diagnoses.

## Demo

{% embed YOUTUBE_URL %}

Good moments to jump to:
- **0:00** Hearth introduces itself.
- **0:37** Drag it around, and shake it.
- **0:48** Consent and the camera preview.
- **1:15** Live SmartSpectra signals.
- **1:35** A breathing check-in, with Hearth speaking up.
- **2:02** Reminders and quiet mode.
- **2:21** Reading the calendar and inbox.

(Fix these once the final video is uploaded.)

## Code

{% github REPO_OWNER/REPO_NAME %}

To run it on Windows 10 or 11 with Node 22 and a webcam:

```bash
git clone https://github.com/REPO_OWNER/REPO_NAME
cd REPO_NAME
npm install
copy .env.example .env   # add SMARTSPECTRA_API_KEY, ASSEMBLYAI_API_KEY, OPENAI_API_KEY
npm run dev
```

- **No login is needed.** Hearth starts without any keys, and the dashboard tells you which ones are missing. Composio (for Google apps) is optional.
- **Typed chat:** if you'd rather not use a mic, the Today page has a typed chat box.
- **Demo mode:** `npm run demo` starts Hearth with a separate data folder and timers in minutes instead of hours, so nudges and check-ins happen while you watch.

## How It Responds to Human Signals

Everything starts with the SmartSpectra Node SDK running inside Hearth's dashboard window. The camera feed is processed on the laptop, and Hearth receives a stream of metric packets.

> **[IMAGE 1: architecture]** The "how it works" diagram: camera → SmartSpectra SDK (on this laptop) → signals → stable and baseline checks → Hearth speaks, notifies or stays quiet, with Presage Insights on a dotted "numbers only" branch. Ready: `demo/out/how-it-works.png`.

| Signal from SmartSpectra | What Hearth does with it |
| --- | --- |
| Pulse | Compared with your own session baseline; a sustained rise brings a gentle "three slow breaths?" nudge. |
| Breathing rate | Quick breathing brings a slower-breath nudge, and it drives the breathing check-in. Hearth ignores it while you talk and for 20 s after, since speech makes it unreliable. |
| HRV (RMSSD) | Part of Hearth's answer when you ask how you're doing, and part of Presage's insights. |
| Blinks | Blink rate per minute; a low rate (under 8) during an eye check-in means your eyes are locked on the screen. |
| Talking | Hearth never interrupts you: nudges and reminders wait until you've stopped talking. |
| Presence | 3 minutes away resets the sitting timer, counting as a break. After 10 seconds with no face, sensing pauses itself, and it resumes at your next key press. |
| Expressions (opt-in) | Smile at Hearth and it smiles back. The expression stays on your machine, and the language model never sees it. |
| Validation status | SmartSpectra's own guidance, like "move closer" or "not enough light", appears on the widget. |

> **[IMAGE 2: Signals page]** The real dashboard Signals page with live pulse, breathing, HRV and blink numbers and the charts filled in.

> **[CLIP 2: live signals, 6–8 s]** On the Signals page: blink a few times and the count moves; talk and "Talking" turns on; lean away and SmartSpectra's hint appears.

**Only stable readings count.** The SDK marks each reading stable once its confidence clears Presage's accuracy floor. Hearth ignores anything else, so the first wobbly seconds of a session never trigger a nudge:

```ts
// SmartSpectra's documented floors: pulse 40, breathing 45, HRV 50
const STABLE_AT = { pulse: 40, breathing: 45, hrv: 50 } as const

const isStable = (m: Measured | undefined, floor: number): boolean =>
  m?.stable === true || (m?.stable == null && (m?.confidence ?? 0) >= floor)
```

**Only the metrics it uses.** Hearth asks the SDK for breathing and cardio. Blinks and talking come only if you allow them, and expressions only if you switch them on:

```ts
function requestedMetrics(settings: Settings): number[] {
  const metrics: number[] = [...breathingMetrics, ...cardioMetrics]
  if (settings.measureBlinks) metrics.push(MetricType.BLINKING, MetricType.TALKING)
  if (settings.measureExpressions) metrics.push(MetricType.EXPRESSIONS)
  return metrics
}
```

**Check-ins: the agent watches over time.** When you ask Hearth to keep an eye on something, the language model calls a `watch_signal` tool. From then on, plain code takes over: each check-in reads the signal again, stays silent while it's fine, and ends by itself when the camera loses you:

```ts
function eyes(windowMs: number): CheckResult {
  const blinks = vitals.average('blinks', windowMs)
  if (blinks == null) return { status: 'warming', facts: 'Blink rate is still settling.' }
  if (blinks < LOW_BLINKS_PER_MIN)
    return { status: 'concern', facts: `Blinking about ${round(blinks)} times a minute lately…` }
  return { status: 'ok', facts: `Blinking about ${round(blinks)} times a minute.` }
}
```

> **[CLIP 3: check-in, 8–10 s, sped up]** The Reminders page logging "Checked your breathing: fine" rows, then Hearth speaking up when breathing picks up.

**Polite by design.** Hearth may speak first only when nothing blocks it. It stays quiet:
- during the first minutes of a session;
- in quiet mode;
- while you're talking, or right after you've chatted;
- if it nudged you recently.

It also allows at most three nudges an hour. Every time it holds back, the Timeline records why, so you can see the restraint, not just the nudges.

> **[IMAGE 3: Timeline]** A Timeline row reading "Held back … user appears to be talking".

**Presage Insights.** About once a minute, Presage's vitals model writes a plain-language insight from the session's numbers. Hearth decodes the protobuf, keeps it locally, and lays it out as a headline, metrics and suggestions. When you ask "how am I doing?", the agent can also send your question to Presage with `requestInsight`.

> **[IMAGE 4: Insights card]** One structured Presage insight on the Insights page.

**And a little personality.** Hearth has moods (idle, listening, thinking, speaking, asleep), each with its own color and motion. Shake it while dragging and it gets dizzy, with `> <` eyes and "Whoa! Slow down, buddy." That line is recorded in Hearth's own voice and plays offline, with no API call.

> **[CLIP 4: shake, 3–4 s]** Drag the widget, wiggle it, and the face goes dizzy and says its line.

## Prize Categories

I'm entering **Best Thoughtful Real-World Use** and **Most Creative or Delightful Use**.

**Best Thoughtful Real-World Use.**
- **The need:** people who spend their day at a screen. Developers, students and remote workers all sit for hours, blink less, and forget to move.
- **Usability:** Hearth needs no wearable and no setup beyond a webcam. You talk to it like a person, and it stays out of your way.
- **Responsibility:** consent comes first. Video stays on the device. It only ever gives wellness estimates, never diagnoses. It holds back more than it speaks, and the Timeline shows you why.

**Most Creative or Delightful Use.** Most vitals apps are dashboards. Hearth is a character:
- it breathes, blinks, glances, smiles back when you smile, falls asleep, and gets dizzy when you shake it;
- the agent schedules its own check-ins, then looks again later to see how you're doing.

## Consent and Data Handling

- **Consent first.** The first time Hearth opens, it shows a consent screen. It explains what is measured, where each piece of data goes, and that Hearth is not a medical device. Until you agree, the camera, microphone and chat stay off, and the main process refuses camera and microphone access. You can review it any time from Privacy.

  > **[IMAGE 5: consent screen]**

- **You see what the camera sees.** The camera button on the widget opens a live preview with a face guide, a light check and the frame rate before you start. While the camera is in use, a badge shows on Hearth's face.

  > **[IMAGE 6: camera panel]**

- **Video stays on this device.** SmartSpectra processes camera frames locally. Frames are never stored or sent. This matches Presage's docs: metric computation runs on the device, and the backend is contacted only to check the API key and subscription.
- **Derived numbers go to Presage for insights.** About once a minute, your pulse, HRV and breathing values (and your question, if you ask one) go to Presage, whose language model writes the insight. No raw video or facial images are sent.
- **SDK telemetry is off by default** in Hearth, though the SDK's own default is on. If you turn it on in Privacy, it sends session summaries and device diagnostics, never video or vital-sign values.
- **Voice:** your voice goes to AssemblyAI only while you hold the talk keys (or in hands-free mode until you send). AssemblyAI also voices Hearth's replies.
- **Language model:** your words go to the provider you configure, OpenAI or Anthropic, with a short summary of your signals. Each Presage insight is also sent once, to be laid out as a headline, metrics and suggestions. Facial expressions are never included.
- **Apps are read-only.** Hearth sees only the services you sign into, and only through their read tools. Google apps go through Composio, which stores that Google sign-in.
- **Everything else stays local:** settings, memory, reminders, insights and the event log. Connector tokens are stored encrypted. **Privacy → Delete all local data** removes all of it, including your consent, and disconnects your linked apps.
- **One caveat:** Presage's general privacy policy is broader than its technical docs. It describes collecting biometric information from use of its SDK, for research. Read it before registering for an API key; the README links it.

## How I built it (and what I learned)

**Stack:**
- **App:** Electron 44, React 19 and Mantine, with TypeScript throughout.
- **Signals:** `@smartspectra/node-sdk` 3.5.
- **Voice:** AssemblyAI streaming speech-to-text and text-to-speech.
- **Agent:** the AI SDK with OpenAI by default.
- **Apps:** Composio and MCP.

The first half was built in Cursor, the rest with Claude Code.

A few things I learned along the way:
- **Frame rate is everything.** SmartSpectra needs a steady 25 fps or more. Each frame crosses from the renderer to the main process, so I capture at 640×480, not 1280×720. The camera preview now shows the real frame rate, because low light and Wi-Fi cameras quietly drop frames.
- **Don't measure breathing while someone talks.** Speech moves the chest, so Hearth skips breathing readings while you talk and for 20 seconds after.
- **Restraint is a feature.** The hardest part wasn't making Hearth speak. It was deciding when *not* to: warm-up, cooldowns, an hourly budget, and never interrupting.
- **Read-only, by construction.** Every MCP tool is denied unless it looks read-only. Composio's session has write tools switched off, and Hearth double-checks each tool it actually runs.

**The demo video:**
- **Narration:** ElevenLabs.
- **Hearth's lines:** its real app voice.
- **Explainer scenes:** animated in Remotion.
- **App footage:** screen recordings of Hearth itself. (Update this line once the final cut is done.)

## Agent Session

AGENT_SESSION_EMBED

The whole build as one session. Part 1 is the Cursor chat that scaffolded Hearth: the idea, the Electron app, SmartSpectra, voice and the first connectors. Part 2 is the Claude Code session that added check-ins, the away pause, the shake reaction and the demo tooling. DEV doesn't read Cursor's format yet, so that half is converted, and Cursor's export doesn't keep tool results. Keys and personal details are removed, and long tool outputs are trimmed.

---

Thanks to Presage for a genuinely fun SDK, and to the DEV team for the challenge. If Hearth made you blink just now, it's already working.

<!--
============================================================
BEFORE PUBLISHING: delete everything below this line.
============================================================

Fill in:
- cover_image: upload demo/out/cover.png (1000×420) and paste its URL.
- YOUTUBE_URL: upload the final video (Public or Unlisted).
- REPO_OWNER/REPO_NAME: the public GitHub repo (twice).
- Demo timestamps: check them against the final video.
- AGENT_SESSION_EMBED: run `node tools/agent-session.mjs merge` in demo/ right before uploading
  (it joins Cursor's half and Claude Code's half, removes keys, and stays under 10 MB). Upload
  agent-session/hearth-build.jsonl at https://dev.to/agent_sessions/new, curate it, Save & Upload,
  then Make Public. Paste exactly what the session page gives you to embed or share; DEV hasn't
  documented an embed tag, so don't guess one. Or delete the section; it is optional.
- "The demo video" paragraph: say which scenes are recreations if any remain.

Media to capture (all from your recording session in RECORDING.md, unless noted):
| # | What | Source | Format |
| --- | --- | --- | --- |
| CLIP 1 | Widget idle, hover, listening, thinking, speaking | Steps 2–3 and 10 | GIF, ≤ 8 s, 800 px wide |
| CLIP 2 | Signals page reacting to blink, talk, lean away | Step 8 | GIF, 6–8 s |
| CLIP 3 | Check-in: "all fine" rows, then Hearth speaks up | Steps 12–14 (speed up 4×) | GIF, 8–10 s |
| CLIP 4 | Shake the widget, dizzy face plus line | Drag and wiggle (new) | GIF, 3–4 s |
| IMAGE 1 | How-it-works diagram | Done: demo/out/how-it-works.png | PNG |
| IMAGE 2 | Signals page with live numbers and charts | Step 24 | PNG |
| IMAGE 3 | Timeline "Held back … talking" row | Step 16, then the Timeline page | PNG, cropped |
| IMAGE 4 | One Presage insight card | Step 11 | PNG, cropped |
| IMAGE 5 | Consent screen | Step 1 | PNG |
| IMAGE 6 | Camera panel with face guide and fps | Step 7 | PNG |

Keep GIFs under about 5 MB each so DEV loads them quickly. I can cut them from the recording
with ffmpeg once you've recorded.
-->
