# SILENT KILLER

> One wink. One death. One detective. Who can you trust?

A real-life social deduction party game for 5–20 players in the same room. Each player uses their own phone. Open the site, one person creates a lobby, and everyone else scans the QR code or types the 5-letter code.

**Play:** https://mnm1122000.github.io/silent-killer/

## How a game runs

1. **Lobby.** The host creates a lobby. Players join with the code, link or QR, enter a name, and take a selfie, choose a gallery photo or pick a mask. The host picks the settings. Nobody can join once the game starts.
2. **Role reveal.** Each player presses and holds to peek at a secret role: Killer, Police or Netizen. The host gets a role too and cannot see anyone else's.
3. **Action phase** (30/60/90/120 s or custom), **in silence**. Everyone mingles and makes eye contact, but nobody talks, so nobody can shout "they winked at me!". A Killer locks ONE target on their phone, then winks at that person. If you get winked at, stay silent and remember who.
4. **Report phase.** Every living player answers "Were you winked at?" and, if yes, names who did it. Killers never get "Were you winked at?". A Killer who locked a target gets "Did you wink at Badrul?" (YES, I winked at Badrul / NO, I didn't wink). A Killer with no target can only answer NO. Reports are sealed and private.
5. **Validation.** The host phone checks each report against the Killers' locked targets.
6. **Crime Scene Report.** Each victim is announced with a fictional incident from `Silent_Killer_Crime_Scenarios.xlsx` (112 scenarios, no repeats until all are used). The announcement never reveals who killed them.
7. **Discussion** (60/90/120/180 s or custom). Players argue and the Police can accuse. Dead players stay silent. Then the next round starts.

## Rules decided where the brief was ambiguous

| Question | Decision |
|---|---|
| Selecting a target vs. a "successful" wink | A kill needs **two steps from the Killer**: lock the target during Action, then confirm "YES, I winked at them" in the Report phase. A victim who noticed dies even if they named the wrong person (Scenario A). For a victim who didn't notice, see the escape rule below. If the Killer answers NO, or never answers, nobody dies and the round counts as failed. Winking at anyone you didn't lock is only a bluff. A Killer can't change a locked target. |
| The Killer can't kill the Police | The Police **appears** in the Killer's target list. Removing them would reveal the Police to the Killer. Locking the Police kills nobody and counts as a failed round. Fellow Killers are hidden from the list, because Killers already know each other. |
| The victim didn't notice the wink (your rule) | If the Killer confirms YES but the victim answered NO (or didn't answer), the victim **escapes once**. A public "Narrow Escape" report says someone winked at them and they didn't notice, and they are marked 👁. The next confirmed wink on them kills for sure. A victim who answered YES dies right away. The escape still counts as a successful wink for the Killer's curse counter. |
| Two Killers lock the same victim | One death. Both Killers get credit and their counters reset. |
| What counts as a successful kill (curse) | A round counts as a success for a Killer only if **their own** locked target died. No target, the Police as target, or a disconnect all count as failures. After 3 failures in a row that Killer is consumed by the curse, eliminated and publicly revealed. |
| Section 6 says three failed rounds is a Killer-team win | Treated as a typo, because Section 3/5 says the Killer **loses**. If every Killer is consumed, the innocents win. |
| False reports | Saying YES when no Killer targeted you gives a private warning. The warning depends **only** on whether you were targeted, never on who you named, so reports can't be used to probe identities. A targeted player who says NO gets no warning; they die anyway. |
| Missed reports / disconnected players | The report phase has a time limit (30–90 s). A missing report is recorded as "no report" and the game continues. Kills never depend on reports, so missing a report gains nothing. |
| Multiple Killers and the accusation | The host chooses: **any one Killer** (default) or **every living Killer** at once. One accusation per game, usable in any phase after the reveal. |
| Killers win when all innocents are dead | The Police can't die, so the Killers win when every **Netizen** is dead. |
| Quiet rounds | The announcement says "No bodies found". An optional setting skips the discussion and goes straight to the next Action Phase. |
| Host powers | The host can pause and resume, skip waiting phases (reveal, report, announcement, discussion) and end the game. The host **cannot skip the Action Phase** and has no access to roles. |

## The Afterlife

Eliminated players must stay silent, so their phone turns into **The Afterlife**. They drag a ghost, labelled with their name, around the screen. Touching the floating names of living players "haunts" them (BOO!): that player's screen flickers with the ghost's profile picture at low opacity and their phone vibrates. Vibration works on Android; iPhones don't allow websites to vibrate. Other dead players' ghosts float there too. The host can switch haunting off in the lobby settings ("Ghosts can haunt the living"). Haunts are rate-limited.

## Fair play and secrecy

- The host's phone runs the game engine (`js/engine.js`). Each player only receives a personalised, sanitised view: their own role, their fellow Killers (if they are a Killer), and public facts.
- All private messages between phones are **end-to-end encrypted** (ECDH P-256 + AES-GCM). They travel through public MQTT relay brokers, so no server needs to run.
- Phones only play sounds that every phone plays at the same moment. Locking a target and receiving a warning are silent, and button clicks are muted during the Action Phase.
- After locking a target, the Killer's screen looks the same as everyone else's "mark your suspects" grid.
- Limitation: the host device holds the full game state in memory. The app never shows it, but a determined host with developer tools could read it. Pick a host you trust, or one who doesn't know their way around browser devtools.
- Phones stay awake through the Wake Lock API. If the host's page reloads, it offers "Resume hosting" and picks up where it left off. Players who reload rejoin as themselves.

## Sounds

There are 25 procedurally generated horror sounds in `assets/sfx/` (`tools/gen-sfx.cjs`):

| Sound | Where it plays |
|---|---|
| lobby | Music-box lullaby loop in the lobby |
| ambience | Drone loop between phases |
| tension | Pulse loop during the Action Phase |
| heartbeat | Speeds up in the last 15 s of the Action Phase |
| tick, tick_urgent | Countdown in the last 10 s |
| start_game, thunder | Game start |
| role_reveal | Peeking at your role |
| sting_action | Action Phase start |
| report, submit | Report phase |
| scan | Validation |
| death | A victim is announced |
| no_death | A quiet round |
| curse | A Killer is consumed by the curse |
| shh | A whispered "shhh" at the start of each silent Action Phase |
| discussion | Discussion starts |
| accuse | The Police accuses |
| win_innocent, win_killer | End of game |
| join, click, wink, warning | Joining the lobby and UI sounds |

## Sound on phones

Phones only allow sound after a tap, so the game unlocks audio on the first "Enter" tap and again on any later tap. It also plays a silent media track, which stops the iPhone ring/silent switch from muting the game. Every sound has extra upper harmonics and a loudness boost, so the deep booms, drones and heartbeats are audible on small phone speakers. Playback also goes through a compressor. If Web Audio is blocked, sounds fall back to plain `<audio>` playback. Use **🔊 Test sound** on the home screen, in the lobby or in the menu: it plays a sound and shows the audio status (for example `audio running · 25/25 sounds loaded`). If it's still quiet, raise the *media* volume and disconnect any Bluetooth device.

Code files are always revalidated by the service worker, so phones don't run an old cached version after an update.

## Development

```
node tools/serve.cjs          # http://localhost:5190  (add ?dev=1 for "Add bot" test players)
node tools/test-engine.js     # 22 rule tests (scenarios A–D, curse, accusations, multi-killer…)
node tools/gen-sfx.cjs        # regenerate sounds (needs ffmpeg)
python tools/xlsx_to_json.py  # re-import the scenario spreadsheet
```

`tools/multi.html` opens a host and two players side by side for local testing.

The game can grow: roles live in `ROLE` and `roleCounts()` in `js/engine.js`. Future roles (Doctor, Informant, Guardian, Forensic, Jester, Mastermind) plug into `resolveRound()`.
