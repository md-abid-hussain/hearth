# Recording session: everything in one go

Use Hearth naturally for about 40 minutes while the recorder runs. I cut the demo video from this footage and from what Hearth saves on its own: its voice, its logs, and your live signals.

The order below flows best, but it doesn't need to be exact. Pause for a couple of seconds before and after each step. If something goes wrong, do it again; I'll pick the best take. Mistakes and waits get cut, so don't worry about them.

## Before you start (5 minutes)

0. **Seed your calendar and inbox** in the Google account you'll link, ideally a spare one. Hearth reads these out loud, so keep them harmless:
   - Two calendar events for today, for example "Design review" at 3:00 PM and "Gym" at 6:30 PM.
   - Two or three emails sent to yourself from another account, for example "Your flight check-in is open", "Invoice #1042 is due Friday" and "Lunch moved to 1 PM".
1. **Clear the screen.** Close or minimize anything personal: chat apps, email, and this Claude window. Put up something you're happy to show behind Hearth, such as your code editor full screen. Turn off notifications for other apps, but keep Windows notifications on, since Hearth sends one.
2. **Set up yourself.** Put the tablet camera somewhere steady, with light on your face from the front, and put your earphones in.
3. **Start Hearth in demo mode.** Close any running Hearth first. Then, in the `wisp` folder:
   ```
   npm run demo
   ```
4. **Start the recorder** in a second terminal, then minimize that terminal:
   ```
   cd C:\Users\abid1\Desktop\presage-dev-to\demo
   node tools/record.mjs
   ```

## During the session

**First launch**
1. Open Hearth's dashboard. The consent screen appears. Scroll through it slowly, then click **I agree**.

**The widget**
2. Leave Hearth alone for about a minute, so it blinks, glances and hops.
3. Hover over it so it opens. Drag it somewhere, then back.
4. Wait until it falls asleep (about 90 seconds), then click it to wake it.

**Camera**
5. On the **Privacy** page, switch on facial expressions.
6. On the **Signals** page, choose the **Xiaomi Pad 8** camera.
7. Click the camera button on Hearth. Center your face in the oval, check it shows 25 fps or more, then click **Start sensing**.

**Live signals.** Sit normally for 3 minutes first, so Hearth learns your baseline.
8. On the **Signals** page:
   - sit still for 15 seconds;
   - blink a few times;
   - count to ten out loud;
   - lean out of frame and back, within 10 seconds.
9. Look at Hearth and smile. Go neutral, then smile again.
10. Hold **Right Ctrl** and say "Hi Hearth, what can you do?" Then ask "Hearth, how am I doing?"
11. Scroll slowly through the **Insights** page, then the **Today** page.

**Check-in**
12. Open the **Reminders** page and say "Keep an eye on my breathing every minute."
13. Sit calmly for 3 minutes.
14. Breathe quickly, about one breath every 2 seconds, without talking, until Hearth speaks up. That takes about 2 to 3 minutes.
15. Stand up and walk out of frame for 20 seconds. Come back, sit down and move the mouse.

**Reminders**
16. Say "Remind me to drink some water in one minute." When it's due, read something out loud for about 20 seconds, so Hearth holds back. Then stop and wait until it reminds you.
17. Open the **Reminders** page. The water reminder is listed under Delivered, marked "spoken".
18. Say "Turn on quiet mode." Then say "Remind me to stretch in one minute." Wait for the Windows notification and click it. It opens the Reminders page, where the stretch reminder is marked "notification". Then say "Turn off quiet mode."

**Working**
19. Work normally, typing in your editor, for a few minutes until Hearth suggests a break.
20. Optional: say "Keep an eye on my eye strain every two minutes" and read something on screen for a few minutes.

**Apps**
21. On the **Apps** page, sign in to Gmail and Google Calendar if they aren't linked in demo mode yet. I'll cut the Google screens out.
22. Ask "What's on my calendar today?"
23. Ask "Anything important in my email today?"

**Wrap up**
24. Scroll slowly through the **Signals** page with its charts filled in, then **Timeline**, then **Privacy**. Don't click Delete.
25. Press **Enter** in the recorder window to stop recording.

Demo mode runs Hearth's timers in minutes, so it may speak up on its own at any point. Just react naturally.

## After

Tell me the session name the recorder printed. I'll take it from there. The recording and your mics are in `demo\raw`. Hearth's voice, logs and live signals are in `%APPDATA%\hearth\hearth-demo-data`.
