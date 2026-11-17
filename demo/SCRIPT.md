# Hearth demo video: script

The full demo is built in Remotion (`Demo` composition, about **3:39**). Every scene exists now.

- **Generated** scenes are animation: the problem, Hearth's moods, how it works, privacy.
- **Recreated** scenes rebuild Hearth's real screens (the widget, the dashboard pages, the consent card, the camera panel) on a stand-in desktop. Each one is meant to be swapped for your real recording of the same moment. Every behavior they show exists in the app.
- **Signals must be real footage before you submit.** Judges look for a live Presage signal in the video.
- **N** is the narrator: ElevenLabs `eleven_v4`, voice "Carolyn - Warm Grounded Narrator" (`public/voice/n*.mp3`).
- **H** is Hearth's own voice: AssemblyAI text-to-speech, the voice the app uses, made with `tools/hearth-voice.mjs` (`public/voice/h*.wav`). Hearth's mouth follows the real loudness of each line.
- **You** are shown as the words in Hearth's caption while it listens. No voice is needed.

| # | Scene | Length | Kind | What happens | Voices |
| --- | --- | --- | --- | --- | --- |
| 1 | Opening | 13.5 s | Generated | Hearth wakes on a dark screen, blinks, glances, hops and introduces itself; then the title. | **H:** "Oh, hi there. I'm Hearth. You've been at it for a while. Want to stand up and stretch with me?" |
| 2 | Problem | 16.5 s | Generated | A workday clock; cards for blinking less, shallow breathing and not moving; a laptop camera; Hearth pops out. | **N:** n01 |
| 3 | Moods | 16.5 s | Generated | One big Hearth through idle, listening, thinking, speaking and asleep. | **N:** n02 |
| 4 | Drag | 13 s | Recreated | The cursor hovers the widget (it opens), drags it to a corner, shakes it (the face goes dizzy) and drags it back. | **N:** n03 · **H:** "Whoa! Slow down, buddy." |
| 5 | Consent and camera | 13 s | Recreated | The consent card scrolls, then "I agree"; the camera panel with the face guide and "30 fps"; then "Start sensing", and a camera dot appears on the widget. | **N:** n04 |
| 6 | How it works | 21.5 s | Generated | Camera, SmartSpectra SDK on this laptop, signals, the stable and baseline checks, then Hearth speaks, notifies or stays quiet. | **N:** n05 |
| 7 | Live signals | 12.5 s | Recreated, **must be real** | The Signals page: pulse, breathing, HRV and blinks, with charts. The blink count ticks on "Blink", Talking turns yes on "Talk", and the SDK hint shows on "Lean away". | **N:** n06 |
| 8 | Smile, how am I doing | 12 s | Recreated | You smile and Hearth smiles back (a note says expressions are opt-in). Then "Hearth, how am I doing?": listening, then thinking ("checking your signals"), then the answer. | **H:** "You look calm. Your pulse is steady, and your breathing is slow and even." |
| 9 | Check-in | 33.5 s | Recreated | "Keep an eye on my breathing every minute." Hearth replies. The Reminders page logs "all fine" checks while time passes. Breathing climbs and Hearth speaks up. Then you leave: "camera paused while you were away", and the check-in shows "stopped". | **H:** "Sure. Your breathing looks calm right now. I'll check again in a minute." · **N:** n07 · **H:** "Your breathing has picked up a bit. Want to take three slow breaths with me?" · **N:** n08 |
| 10 | Reminders | 24.5 s | Recreated | "Remind me to drink some water in one minute." Time passes; a note shows Hearth holding the reminder while you talk; then it speaks. Quiet mode turns on, and a reminder arrives as a Windows notification. | **H:** "Okay. I'll remind you in a minute." · **N:** n09, first half · **H:** "A little water might be nice right now, if you'd like." · **N:** n09, second half |
| 11 | Apps | 24.5 s | Recreated | The Apps page (Gmail, Calendar and Drive through Composio, plus Notion, Linear and GitHub, all read-only). Then "What's on my calendar today?" and "Anything important in my email?" | **N:** n10 · **H:** "You have a design review at three, and the gym at six thirty." · **H:** "Your flight check-in is open, and invoice ten forty-two is due Friday." |
| 12 | Privacy | 12.5 s | Generated | Four promises, styled like the consent rows. | **N:** n11 |
| 13 | Outro | 7 s | Generated | Hearth hops over the wordmark, "Built with Presage SmartSpectra" and `#presagechallenge`. | **N:** n12 |

## Narration lines (Carolyn)

| File | Line | Length |
| --- | --- | --- |
| n01-problem | Most of us spend the day staring at a screen. We blink less, our breathing gets shallow, and hours pass without getting up. Your laptop already has a camera. What if it could notice, and look after you, kindly? | 14.5 s |
| n02-meet | This is Hearth. It lives at the edge of your screen. It blinks, looks around, and hops when it's bored. Talk to it, and it listens, thinks, and answers out loud. Leave it alone, and it dozes off. | 14.1 s |
| n03-widget | Hover, and it opens up. Drag it anywhere. | 3.4 s |
| n04-consent | Nothing starts without your say. Hearth asks for consent first, and shows exactly what the camera sees before you begin. | 8.1 s |
| n05-how | Under the hood, Presage's SmartSpectra SDK turns the camera feed into pulse, breathing, heart rate variability and blinks, right on this laptop. Hearth only trusts a reading once the SDK marks it stable, and compares it with your own earlier readings, not a textbook. | 17.8 s |
| n06-live | Here it is, live. Blink, and the count moves. Talk, and Hearth notices. Lean away, and the SDK asks you to come back into view. | 10.1 s |
| n07-checkin | Ask Hearth to keep an eye on something, and it sets a reminder for itself. Every minute it reads the signal again, and while things look fine, it stays quiet. | 9.8 s |
| n08-away | When something's off, it says so. And when you walk away, it stops watching, and pauses the camera until you're back. | 7.4 s |
| n09-gentle | It waits until you're not talking, keeps nudges rare, and in quiet mode it never speaks. It sends a notification instead. | 8.6 s |
| n10-apps | It can read your mail, calendar and notes too. Read-only, and only when you ask. | 6.1 s |
| n11-privacy | Video never leaves your laptop. Only the numbers go to Presage for insights. It's a wellness companion, not a medical device, and one button deletes everything. | 10.6 s |
| n12-outro | Hearth. A little warmth on your desk. | 2.9 s |

## Checked claims

These are checked against the code and Presage's docs (see the README's consent section):
- frames are processed on the device;
- only the derived numbers and the prompt go to Presage for insights;
- telemetry carries no video or vitals;
- Hearth gates readings on the SDK's stable flag and compares them with your session baseline;
- check-ins stop when the signal is lost;
- nudges are capped at 3 an hour outside demo mode;
- the shake reaction is in the app (`wisp/src/main/index.ts`, `isShake`).

## Replacing recreations with footage

After your session, each recreated scene becomes a clip from your recording with the same voices on top:
- Signals is required.
- The rest are better real but optional.

Your recording also gives real lines from Hearth (its WAVs), which can replace the generated ones.
