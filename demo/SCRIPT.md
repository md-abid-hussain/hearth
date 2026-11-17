# Hearth demo video: script

Target length: about **3:10**.

- **Generated** scenes are animated in Remotion and need no footage. They are built, and their animation beats are timed to the narration's words.
- **Footage** scenes come from your recording session.
- **N** is the narrator: ElevenLabs `eleven_v4`, voice "Carolyn - Warm Grounded Narrator". Each line is its own file in `public/voice`.
- **H** is Hearth's real voice, from the replies demo mode saves.
- Your own lines are left out here; they appear as captions over the footage.

| # | Time | Scene | Source | What's on screen | Narration (N) |
| --- | --- | --- | --- | --- | --- |
| 1 | 0:00–0:08 | Cold open | Generated | Black screen. Hearth's face fades in, breathing. It blinks, glances at you, hops, then speaks. | **H:** a real nudge from your session, such as "You've been at it for a while. Want to stand up and stretch for a minute?" |
| 2 | 0:08–0:12 | Title | Generated | The face slides aside and the wordmark "Hearth" appears, with "a small companion that notices" in italics. | none |
| 3 | 0:12–0:30 | The problem | Generated | Kinetic words over simple drawings: a clock running through the workday, an eye that blinks less and less, a breathing line going shallow, a sitting timer counting up. Then a laptop with its camera dot, and Hearth popping up there. | "Most of us spend the day staring at a screen. We blink less, our breathing gets shallow, and hours pass without getting up. Your laptop already has a camera. What if it could notice, and look after you, kindly?" |
| 4a | 0:30–0:46 | Meet Hearth | Generated | A large Hearth face goes through its moods, each with a small label: idle (blink, glance, hop), listening (green, ring pulsing), thinking (violet, dots circling), speaking (mouth moving), asleep (eyes closed, z). | "This is Hearth. It lives at the edge of your screen. It blinks, looks around, and hops when it's bored. Talk to it, and it listens, thinks, and answers out loud. Leave it alone, and it dozes off." |
| 4b | 0:46–0:52 | The real widget | Footage | The widget on your screen opens on hover and gets dragged. | "Hover, and it opens up. Drag it anywhere." |
| 5 | 0:52–1:06 | Consent and camera | Footage | The consent screen, then the camera panel with the face guide and frame rate, then **Start sensing**. | "Nothing starts without your say. Hearth asks for consent first, and shows exactly what the camera sees before you begin." |
| 6 | 1:06–1:24 | How it works | Generated | An animated diagram. The camera feeds the SmartSpectra SDK, labeled "on this laptop". Signals pop out of it: pulse, breathing, HRV, blinks, talking. They pass a "stable" check and a "your baseline" check, then go to Hearth, which either speaks, sends a notification, or stays quiet. A dotted branch to Presage Insights is labeled "numbers only". | "Under the hood, Presage's SmartSpectra SDK turns the camera feed into pulse, breathing, heart rate variability and blinks, right on this laptop. Hearth only trusts a reading once the SDK marks it stable, and compares it with your own earlier readings, not a textbook." |
| 7 | 1:24–1:46 | Live signals | Footage, with overlays | The Signals page, live. Callouts follow the real numbers from your signal log. You blink, talk, lean away and come back. Then you smile and Hearth smiles back. Then "how am I doing?" | "Here it is, live. Blink, and the count moves. Talk, and Hearth notices. Lean away, and the SDK asks you to come back into view." Then music only for the smile. Then **H:** its live answer. |
| 8 | 1:46–2:18 | Check-in | Footage, with overlays | You ask Hearth to watch your breathing and it replies. The Reminders page logs "all fine" while a clock shows time passing at 4×, with a live breathing chart drawn from your signal log. You breathe quickly, the chart climbs, and Hearth speaks up. Then the empty chair, "camera paused while you were away", and sensing resuming when you're back. | "Ask Hearth to keep an eye on something, and it sets a reminder for itself. Every minute it reads the signal again, and while things look fine, it stays quiet." Then **H:** its warning. Then "When something's off, it says so. And when you walk away, it stops watching, and pauses the camera until you're back." |
| 9 | 2:18–2:39 | Gentle by design | Footage | The water reminder held back while you talk (the Timeline row), then spoken. Quiet mode's Windows notification. The break nudge. | "It waits until you're not talking, keeps nudges rare, and in quiet mode it never speaks. It sends a notification instead." |
| 10 | 2:39–2:48 | Your apps | Footage | You ask about email, and Hearth answers. Subject lines are blurred if needed. | "It can read your mail, calendar and notes too. Read-only, and only when you ask." |
| 11 | 2:48–3:00 | Privacy | Generated, plus footage | Five promises appear one by one: video stays on this laptop; only numbers go to Presage; telemetry is off by default; one button deletes everything; a wellness companion, not a medical device. Then a glimpse of the real Privacy page. | "Video never leaves your laptop. Only the numbers go to Presage for insights. It's a wellness companion, not a medical device, and one button deletes everything." |
| 12 | 3:00–3:06 | Outro | Generated | Hearth hops and smiles. The wordmark, "Built with Presage SmartSpectra", `#presagechallenge` and the repo link. Small print: "Narration voice: ElevenLabs. Timers shortened for this demo." | "Hearth. A little warmth on your desk." |

## Runtime

| Part | Length |
| --- | --- |
| Generated scenes (1, 2, 3, 4a, 6, 11, 12) | **1:26** (opening 12 s, problem 16.5 s, moods 16.5 s, how it works 21.5 s, privacy 12.5 s, outro 7 s) |
| Footage scenes (4b, 5, 7, 8, 9, 10, part of 11) | about **1:45** |
| Total | about **3:10** |

The narration runs 1:53 in all. The rest is Hearth's own voice, the smile beat, and the music.

| File | Line | Length |
| --- | --- | --- |
| n01-problem | Most of us spend the day… | 14.5 s |
| n02-meet | This is Hearth… | 14.1 s |
| n03-widget | Hover, and it opens up… | 3.4 s |
| n04-consent | Nothing starts without your say… | 8.1 s |
| n05-how | Under the hood… | 17.8 s |
| n06-live | Here it is, live… | 10.1 s |
| n07-checkin | Ask Hearth to keep an eye on something… | 9.8 s |
| n08-away | When something's off… | 7.4 s |
| n09-gentle | It waits until you're not talking… | 8.6 s |
| n10-apps | It can read your mail… | 6.1 s |
| n11-privacy | Video never leaves your laptop… | 10.6 s |
| n12-outro | Hearth. A little warmth on your desk. | 2.9 s |

Every claim in the narration matches the code and the README's consent section:
- frames are processed on the device;
- pulse, HRV and breathing values go to Presage for insights;
- Hearth checks the SDK's stable flag and your session baseline;
- check-ins stop when the signal is lost;
- nudges are capped at 3 an hour outside demo mode.
