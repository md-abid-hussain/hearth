# Hearth: demo video and DEV post plan

Deadline: **November 22, 2026, 11:59 PM PST.**

## What the judges look for

Taken from the challenge page and the contest rules:

- **Three criteria for every prize:** use of the underlying technology, usability and user experience, and originality and creativity. Ties go to the post with the most positive reactions.
- **The video must show SmartSpectra with at least one live signal.** Judges check the video and the public repo for a real integration. An entry without one can be disqualified.
- **Required pieces:** a DEV post with the `#presagechallenge` tag, a public repo with setup steps, a demo video, and a "Consent and Data Handling" section in the post.
- **No length limit.** We aim for about 2:50.
- **Two prize categories, and we enter both:** Best Thoughtful Real-World Use (a clear need, usability, consent and data handling) and Most Creative or Delightful Use (original, playful, unexpected).
- **No diagnosis or treatment claims** in the video or the post. Hearth gives wellness estimates, not medical readings.
- **AI use is allowed.** We say in the video and the post that the narration voice comes from ElevenLabs.

## The story in one line

We stare at screens all day and forget our bodies. Hearth is a small companion on your desk. Through your webcam it reads your pulse, breathing and blinks with Presage SmartSpectra, looks after you kindly, and speaks up only when it matters.

The video has to prove three things, in this order:

1. **It's alive and cute.** The face, its moods, and it smiling back at you.
2. **The signals are real and live.** SmartSpectra numbers move as you blink, talk, breathe and lean away.
3. **It acts on them by itself, politely.** Check-ins, reminders, break nudges and the away pause, all without bothering you while you talk.

## Who does what

| You | Me |
| --- | --- |
| Record the screen clips in the shot list below with OBS. | Add a demo mode to the app, so its timers run in minutes, not hours. |
| Say the few lines to Hearth that the script needs. | Clean your mic track with ElevenLabs Voice Isolator. |
| Optional: 2 or 3 phone clips of you at the desk. | Narration with ElevenLabs Text to Speech; captions from ElevenLabs Speech to Text. |
| Pick the narrator voice from 3 samples. | A music bed from ElevenLabs Music. |
| Upload the final video to YouTube and publish the post. | Edit everything in Remotion; ffmpeg for cuts, audio and GIFs. |
| | Cover image, thumbnail, figures, GIFs, and a draft of the DEV post. |

## Before recording

### My part

1. **Demo mode.** With `HEARTH_DEMO=1`, Hearth uses its own data folder (`hearth-demo-data`). That gives a fresh consent screen and an empty Timeline, and your real data stays untouched. It also shortens the timers. The signal thresholds stay real.

   | Timer | Normally | In demo mode |
   | --- | --- | --- |
   | Quiet warm-up at session start | 5 min | 30 s |
   | Break nudge after sitting | 50 min | 3 min |
   | Gap between nudges | 15 min | 1 min |
   | Same nudge again | 45 min | 2 min |
   | Falls asleep when idle | 5 min | 45 s |

   The video says "timers shortened for this demo" on screen.
2. **Voice shortlist.** I'll send 3 ElevenLabs narrator samples for you to choose from. They will sound clearly different from Hearth's own voice, AssemblyAI's `aai-kyla`.

### Your part

1. **Install OBS:** `winget install OBSProject.OBSStudio`. The NVIDIA App also works if you turn on its separate mic track, but OBS is easier to set up as below.
2. **OBS settings:**
   - **Video:** base and output resolution = your screen's native resolution, 60 fps. I zoom into the widget a lot, so the extra pixels matter.
   - **Output → Recording:**
     - Output Mode: Advanced.
     - Format: Hybrid MP4, or MKV.
     - Encoder: NVIDIA NVENC.
     - Rate control: CQP 18.
     - Audio tracks: tick **1 and 2**.
   - **Edit → Advanced Audio Properties:** Desktop Audio on **Track 1 only**, Mic on **Track 2 only**. This keeps Hearth's voice and yours apart, so I can clean your mic without touching Hearth.
   - Don't use OBS noise filters on the mic. The isolator works better on raw audio.
   - **Sources:** one Display Capture source.
   - Set a start/stop recording hotkey, for example Ctrl+Shift+F9, and keep OBS minimized.
3. **Desktop:**
   - Plain dark wallpaper, no desktop icons, and only VS Code or similar open behind Hearth.
   - Close chat apps.
   - Keep Windows notifications **on**, since one clip needs Hearth's notification, but turn them off for other apps.
4. **Room and mic:**
   - Light in front of your face and a plain background.
   - Mic close, fans off.
   - Start every clip with **5 seconds of silence**, which gives the isolator a room-noise sample.
5. **App:**
   - Run with `HEARTH_DEMO=1`, dark theme, Hearth at the bottom center.
   - Dashboard window about 1400×900, centered.
   - In Privacy, switch on both **blinks** and **expressions**.
   - Use a Google account whose inbox you're happy to show and have read aloud, or a spare one.

## Shot list: what you record

Record each clip as its own file, named `C01`, `C02` and so on. Start recording, wait 2 s, do the action, wait 2 s, stop. Retakes are fine: name them `C07b`. Don't rush, because I can cut pauses. When Hearth talks, let it finish.

Keep Hearth running, with sensing on, from C06 through C15. The check-in in C10 compares your breathing with your calm readings from earlier in the same session, and restarting the app starts a new session. Any time you leave the frame, except in C11, come back within 10 seconds, or sensing pauses itself.

| Clip | What to do | What to say | About |
| --- | --- | --- | --- |
| C01 | Hearth idle on a work screen. Don't touch anything for 90 s, so it blinks, glances, hops and tilts. Then hover over it for 5 s, move away, and hover again. | nothing | 2 min |
| C02 | Drag Hearth to the right side of the screen, then back. Open its menu and use "Move back to the bottom". | nothing | 30 s |
| C03 | Click Hearth's face and ask your question. Then hold Right Ctrl and ask the second one. | "Hi Hearth, what can you do?" then "What's on my calendar today?" | 1 min |
| C04 | Leave Hearth alone until it falls asleep (about 45 s), then click it to wake it. | nothing | 1.5 min |
| C05 | First run in the demo profile: the consent screen appears. Scroll through it slowly, then click **I agree**. | nothing | 40 s |
| C06 | Click the camera button on Hearth. Show the preview, lean back so the light and face guide react, then come back and click **Start sensing**. | nothing | 40 s |
| C07 | **Live signals.** After sensing has run for 3 minutes (don't record that wait), open the Signals page. Sit still for 15 s. Then blink a few times on purpose, talk out loud for a few seconds, and lean out of frame and back. Then open the Today page, then Insights. | talk about anything, for example count to ten | 2 min |
| C08 | Look at Hearth and smile big. It smiles back. Go neutral, then smile again. | nothing | 30 s |
| C09 | Hold Right Ctrl and ask. | "Hearth, how am I doing?" | 40 s |
| C10 | **Check-in (the main moment).** Open the Reminders page next to the widget and ask. Sit calmly and keep recording for 2 to 3 minutes; the page should log "all fine". Then breathe quickly, about one breath every 2 seconds, without talking, until Hearth speaks up. That should take 2 to 3 minutes. | "Keep an eye on my breathing every minute." | 6 min |
| C11 | With the check-in still running, stand up and walk out of frame for 20 s. Come back, sit down, and move the mouse. Keep Reminders and the widget on screen. | nothing | 1 min |
| C12 | Ask, then wait about a minute. Just as the reminder comes due, talk out loud for 20 seconds, for example read something; Hearth holds back and the Timeline logs it. Then go quiet until Hearth reminds you. | "Remind me to drink some water in one minute." | 2 min |
| C13 | Turn on quiet mode and set a reminder. Wait until the Windows notification appears, then click it. Afterwards, turn quiet mode off. | "Turn on quiet mode." then "Remind me to stretch in one minute." then "Turn off quiet mode." | 2 min |
| C14 | **Break nudge.** Work normally, typing in the editor, until Hearth suggests a break. With the 3-minute demo timer, that's about 3 minutes. | nothing | 4 min |
| C15 | Hold Right Ctrl and ask. | "Anything important in my email today?" | 40 s |
| C16 | Scroll slowly through the Timeline page, which has the "held back" entries, then the Privacy page. Don't click delete. | nothing | 40 s |
| C17 (optional) | Phone on a shelf, landscape, side angle: you working at the laptop, stretching, and drinking water. 3 clips of 15 s. | nothing | 1 min |

That's about 25 minutes of footage, or roughly 60 to 90 minutes with setup and retakes. You only say 9 short lines, and every one of them also appears as a caption.

## Script, about 2:50

**N** is the narrator (ElevenLabs), **H** is Hearth live (its real reply, recorded), **U** is you (your cleaned mic, with captions).

| Time | On screen | Sound |
| --- | --- | --- |
| 0:00–0:10 | Close-up of the Hearth face idling on a busy screen (C01). It blinks, then the bar opens and it speaks (C14). | **H:** "You've been at it for a while. Want to stand up and stretch for a minute?" |
| 0:10–0:13 | Title card: Hearth's face and the line "a tiny desk companion that notices". | Music fades in. |
| 0:13–0:27 | The phone clip or a sped-up C14 with a clock spinning. Kinetic words: *blink less*, *breathe shallow*, *forget to move*. | **N:** "Most of us spend the day staring at a screen. We blink less, breathe shallow, and forget to get up. Your laptop already has a camera. What if it could notice, and look after you, kindly?" |
| 0:27–0:48 | Mood montage with small labels: idle actions (C01), hover opens the bar, drag (C02), listening with the voice meter, thinking, speaking (C03), asleep (C04). | **N:** "This is Hearth. It lives at the edge of your screen. It blinks, looks around, and hops when it's bored. Hover, and it opens up. Drag it anywhere. Click it, or hold right Control, and it listens, thinks, and answers out loud." |
| 0:48–1:02 | Consent screen (C05), then the camera preview with the face guide (C06). A camera badge appears on Hearth. | **N:** "Nothing starts without your say. Hearth asks for consent first, and the camera button shows exactly what it sees before you begin." |
| 1:02–1:24 | The Signals page live (C07). Callouts follow the numbers. A "LIVE · Presage SmartSpectra" badge stays on screen. The blink count ticks as you blink, the talking dot lights up, and leaning away brings up the SDK's hint. | **N:** "Then Presage's SmartSpectra SDK reads your pulse, breathing, heart rate variability and blinks from the camera, live, on this laptop. Hearth only trusts a reading once the SDK marks it stable, and compares it with your own earlier readings, not a textbook." |
| 1:24–1:31 | You smile and Hearth smiles back (C08), with an "expressions, opt-in" label. | Music only, plus a soft chime. |
| 1:31–1:42 | Ask "how am I doing" (C09). | **U:** "Hearth, how am I doing?" **H:** live answer. |
| 1:42–2:14 | **Check-in** (C10): ask, then the Reminders page logs "all fine" during a 4× time-lapse with a clock. You breathe quickly and Hearth speaks up. Then the away pause (C11): an empty chair, the widget says "camera paused while you were away", the page logs "stopped", you come back and sensing resumes. | **U:** "Keep an eye on my breathing every minute." **H:** live reply. **N:** "Hearth sets a reminder for itself. Every minute it reads the signal again, and while things look fine, it stays quiet." **H:** live concern line. **N:** "When something's off, it says so. And when you walk away, it stops watching and pauses the camera until you're back." |
| 2:14–2:35 | The water reminder (C12), quiet mode with its Windows notification (C13), and the Timeline row "Held back … user appears to be talking" (C16). To get that row, talk out loud while a reminder is due in C12 or C13. | **U:** "Remind me to drink some water in one minute." **H:** the reminder, live. **N:** "It waits until you're not talking, keeps nudges rare, and in quiet mode it never speaks. It sends a notification instead." |
| 2:35–2:44 | The email question (C15), with subject lines blurred if needed. | **U:** "Anything important in my email today?" **H:** short answer. **N:** "It can read your mail, calendar and notes too. Read-only, and only when you ask." |
| 2:44–2:58 | The Privacy page (C16), then the outro card: Hearth's face, "Built with Presage SmartSpectra", `#presagechallenge` and the repo link. Small print: "Narration voice: ElevenLabs. Timers shortened for this demo." | **N:** "Video never leaves your laptop. Only the numbers go to Presage for insights. It's a wellness companion, not a medical device, and one button deletes everything. This is Hearth." |

Every claim in that narration matches the code and the README's consent section:
- Frames are processed on the device.
- Pulse, HRV and breathing values go to Presage for insights.
- Nudges are capped at 3 an hour.
- Check-ins stop when the signal is lost.

## Audio

- **Narration:** ElevenLabs `eleven_v4`, in the voice you pick. I generate one file per line so the edit can time each one exactly.
- **Your voice:** the OBS mic track goes through ElevenLabs Voice Isolator, then gets leveled. If it's still rough, the captions carry your words and your audio stays low under them. I'd rather not swap your voice for a synthetic one, since the video shows a real conversation.
- **Hearth's voice:** comes clean from the OBS desktop track.
- **Captions:** burned in for every spoken line, yours and Hearth's, with word timings from ElevenLabs Speech to Text. Many people watch with the sound off.
- **Music:** ElevenLabs Music, a soft, warm instrumental of about 3 minutes, lowered whenever someone speaks.
- **Loudness:** the final mix is normalized to -14 LUFS, which is YouTube's target.

## Edit and build (me)

- **Remotion 4** project in `demo/video`, written in TypeScript. Compositions:
  - `Demo`: 1920×1080 at 60 fps.
  - `Cover`: 1000×420, the DEV cover image.
  - `Thumb`: 1280×720, the YouTube thumbnail.
  - `Figures`: still images for the post.
- **Building blocks:**
  - zooms and pans onto the widget, which is small on a large screen;
  - callouts tied to the live numbers;
  - mood labels;
  - a time-lapse clock for the waits we skip;
  - captions;
  - title and outro cards in Hearth's amber, with its face.
- **ffmpeg**, from the `ffmpeg-static` npm package, so nothing is installed system-wide: split the OBS audio tracks, trim, speed up, pull stills for screenshots, make GIFs, and do the final loudness pass.
- **Output:** `demo/out/hearth-demo.mp4`, H.264 with AAC audio. You upload it to YouTube as Public or Unlisted, and the post embeds it.
- Raw footage and renders stay out of git.

## DEV post plan

**Title**, one of:
1. "Hearth: a tiny desk companion that notices when you stop blinking"
2. "My webcam now reminds me to breathe: Hearth, built on Presage SmartSpectra"

**Tags** (DEV allows 4): `devchallenge`, `presagechallenge`, `electron`, `ai`.

**Sections**, in the template's order:

1. **Opening line.** "This is a submission for the Presage SmartSpectra SDK Challenge".
2. **What I Built.**
   - The problem, in two sentences.
   - Hearth, in one.
   - The hero GIF of the widget's moods.
   - Five bullets: live signals, check-ins, polite nudges and reminders, voice, read-only apps.
3. **Demo.** The YouTube embed, plus a list of moments with timestamps: live signals at about 1:02, the check-in at about 1:42, and so on.
4. **Code.**
   - The repo link.
   - Setup in five lines: clone, `npm install`, copy `.env.example`, add the SmartSpectra, AssemblyAI and OpenAI keys, `npm run dev`.
   - No login is needed, and Composio is optional.
   - Judges without a mic can use typed chat.
5. **How It Responds to Human Signals.**
   - A table with each signal, what Hearth does with it, and when:
     - pulse against your baseline leads to a breathing nudge;
     - fast breathing leads to a slower-breath nudge;
     - HRV feeds Hearth's answers and Presage's insights;
     - low blink rate drives eye check-ins;
     - talking keeps Hearth quiet and holds back the breathing reading;
     - presence means break detection and the away pause;
     - expressions, opt-in, make Hearth smile back.
   - The signal-to-response figure.
   - Integration notes with two short snippets: which metrics Hearth requests, and gating on `stable`.
   - Presage Insights: automatic each minute, plus on demand.
   - Check-ins, where the agent schedules its own next look.
6. **Architecture.** One diagram.
7. **Prize Categories.** One paragraph each:
   - **Best Thoughtful Real-World Use:** people at screens all day; a zero-setup widget and voice; consent first; local data.
   - **Most Creative or Delightful Use:** a face with moods that smiles back, and an agent that sets its own reminders to look after you.
8. **Consent and Data Handling.** Required. Adapted from the README section, which already lists:
   - the consent gate;
   - what stays local;
   - what goes to Presage, AssemblyAI, the LLM and Composio;
   - telemetry, which is off by default;
   - retention and deletion;
   - plus a no-diagnosis line.
9. **What's next and credits.** Credits: SmartSpectra, AssemblyAI, OpenAI, Composio, MCP, ElevenLabs for the narration, Remotion.
10. **Agent Session.** Optional but encouraged. A short slice of this Claude Code session, with every key and personal detail scrubbed before upload. It must be made **public** or judges can't open it.

**Figures:**

| # | What | How |
| --- | --- | --- |
| F1 | Cover, 1000×420: Hearth's face, the title, and a soft pulse line. | Remotion still |
| F2 | Hero GIF of the moods: idle, listening, thinking, speaking, asleep. Under 8 MB. | From C01, C03 and C04 |
| F3 | Architecture: camera → SmartSpectra (renderer) → vitals (main) → observer, check-ins and agent → voice, LLM and read-only tools, with Presage Insights in the cloud. | SVG drawn by me, exported to PNG |
| F4 | Signal to response: reading → stable? → compared with your baseline → nudge or check-in → held back if you're talking or quiet mode is on → spoken or notified. | SVG to PNG |
| F5 | Screenshots: Signals live, Today, an Insights card, Reminders with check-ins, Consent, the camera panel, a Timeline "held back" row, Privacy. | Stills pulled from your clips, so no separate screenshots needed |
| F6 | GIF of a check-in going from "all fine" to speaking up. | From C10 |

## Timeline

| Day | What |
| --- | --- |
| Nov 17 | Demo mode in the app. You set up OBS. Narrator voice samples. |
| Nov 18 | You record all the clips and tell me the folder. |
| Nov 19 | Rough cut with narration, for you to review. |
| Nov 20 | Final cut, cover, figures, and the post draft. |
| Nov 21 | Upload the video, publish the post. |
| Nov 22 | Spare day. |

## Questions for you

1. Your face appears in the camera preview (C06) and the smile shot (C08). Is that fine, or should I crop or blur it? The live numbers prove the signals either way.
2. Should the email shown on screen be your real inbox, or a spare account?
3. What's the public GitHub repo URL, for the post and the outro card?
