---
name: brag
description: Make a short phone-size brag video of the app. Use when the owner says brag, show off, make a video, demo reel or promo of fo/und. Records the REAL app with INVENTED data, adds plain captions, and writes an mp4 outside the repository.
---

The owner wants to show the app off. The video must be true, good-looking, and safe to send: nothing in it may be real.

## Run it
```
node .claude/skills/brag/make-video.mjs --out <folder outside the repo>
```
- Default folder: the system temp folder `brag`. In a session, use the scratchpad folder. The script REFUSES to write inside the repository.
- It copies the app from git (`--ref`, default `HEAD`) into a scratch folder and serves THAT copy, so it never touches the folder anyone else is serving (E2E FOLDER RULE in CLAUDE.md).
- It needs only Node, Playwright's Chromium and `ffmpeg`. No network: everything except its own scratch server is blocked, so no logo or lookup can sneak in.
- About 45 seconds, 780 x 1688, 30 fps, under 3 MB. It prints the file, the length, the scenes and any `problems`. A scene that cannot run is skipped and named in `problems`; fix it before sending.
- It also writes `frames/<scene>.png` (one still per scene) next to the video.

## The tour (change it in `make-video.mjs`, one `scene(...)` per step)
Title card, Log (two taps), Cash flow, Budget (month, payday, week), Cards (amounts hidden, tap the eye), a statement import (the invented `e2e/fixtures/sample-open.pdf`), Verify, closing card. Captions are one short line each (they sit in a band above the app; two lines would cover the screen title).

## Rules (the repo is PUBLIC and the owner's money is private)
1. INVENTED data only: accounts called "Sample ...", made-up amounts, "today" fixed to a date in the seed. Never a real ledger, receipt, payslip, statement, account number or balance. Never open the owner's phone data.
2. No brand logos and no real bank names. The script blocks the network, so bank logos are never fetched; `tests/brag-skill.test.js` fails if a listed bank's name appears in the script.
3. The video and its frames are NEVER committed. They live in the scratchpad (or the folder the owner names). Putting one in the repo breaks CLAUDE.md ("never commit screenshots").
4. Every claim in a caption or on a card must be true TODAY. Check it against CLAUDE.md before writing it. Allowed: free, no account, no server of ours, the ledger and photos stay on the phone, receipts and statements are read on the phone, backups are encrypted, verified means final. Not allowed: "never leaves" (a backup you share does leave; voice entry sends audio to Apple or Google while you speak), "bank-grade", "AI", or any number that is not in the repo. If a claim needs a number, count it now.
5. Before the owner sees it: look at EVERY frame in `frames/` (and a few more with `ffmpeg -ss <t> -i brag.mp4 -frames:v 1 x.png`) and run the `ui-inspector` checklist on them: captions on one line, nothing cut or overlapping, no red, no stray debug text, no real-looking names. Fix and re-run until clean. Say in one line what you checked.
6. Sending the file to the owner is fine. POSTING it anywhere (social media, a chat, the README) is outward-facing and needs the owner's explicit yes.
7. No paid or AI service, and no API key (fixed owner decision). The video is made with the app, a browser and ffmpeg only.

## When the app changes
- A screen was renamed: the menu names come from `src/model/names.js`; update the `menuGo("...")` ids if a tab id changed.
- A selector moved: the run reports `scene "<name>": <first line of the error>`. Fix that scene only.
- A new feature worth showing: add one `scene(...)` with a short caption and a hold of 2 to 3 seconds; keep the whole video under about a minute.

## How it records (so nobody "fixes" it back)
The browser's own video recorder captures at 1x, so the app filled a quarter of the frame. The script instead takes real 2x screenshots in a loop (about 20 per second) and lets `ffmpeg` stitch them at their real timings. Tap marks and captions are drawn into the page by the script; the app itself is untouched apart from a blank band at the top for the caption.
