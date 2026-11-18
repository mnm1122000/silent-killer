# SILENT KILLER

> One wink. One death. One detective. Who can you trust?

A real-life social deduction party game for 5–20 players in the same room. Each player uses their own phone. Open the site, one person creates a lobby, and everyone else scans the QR code or types the 5-letter code.

**Play:** https://mnm1122000.github.io/silent-killer/

## How a game runs

1. **Lobby.** The host creates a lobby. Players join with the code, link or QR, enter a name, and take a selfie, choose a gallery photo or pick a mask. The host picks the settings. Nobody can join once the game starts.
2. **Role reveal.** Each player presses and holds to peek at a secret role: Killer, Police or Netizen. The host gets a role too and cannot see anyone else's.
3. **Action phase** (30/60/90/120 s or custom). Everyone mingles. A Killer locks ONE target on their phone, then winks at that person.
4. **Report phase.** Every living player answers "Were you winked at?" and, if yes, names who did it. Reports are sealed and private.
5. **Validation.** The host phone checks each report against the Killers' locked targets.
6. **Crime Scene Report.** Each victim is announced with a fictional incident from `Silent_Killer_Crime_Scenarios.xlsx` (112 scenarios, no repeats until all are used). The announcement never reveals who killed them.
7. **Discussion** (60/90/120/180 s or custom). Players argue and the Police can accuse. Dead players stay silent. Then the next round starts.

## Rules decided where the brief was ambiguous

| Question | Decision |
|---|---|
| Selecting a target vs. a "successful" wink | The **locked target is the kill**. If you are locked and you can be killed, you die at the end of the Action Phase, even if you missed the wink or named the wrong person (Scenarios A and C). Winking at anyone else is only a bluff. A Killer can't change a locked target. |
| The Killer can't kill the Police | The Police **appears** in the Killer's target list. Removing them would reveal the Police to the Killer. Locking the Police kills nobody and counts as a failed round. Fellow Killers are hidden from the list, because Killers already know each other. |
| Two Killers lock the same victim | One death. Both Killers get credit and their counters reset. |
| What counts as a successful kill (curse) | A round counts as a success for a Killer only if **their own** locked target died. No target, the Police as target, or a disconnect all count as failures. After 3 failures in a row that Killer is consumed by the curse, eliminated and publicly revealed. |
| Section 6 says three failed rounds is a Killer-team win | Treated as a typo, because Section 3/5 says the Killer **loses**. If every Killer is consumed, the innocents win. |
| False reports | Saying YES when no Killer targeted you gives a private warning. The warning depends **only** on whether you were targeted, never on who you named, so reports can't be used to probe identities. A targeted player who says NO gets no warning; they die anyway. |
| Missed reports / disconnected players | The report phase has a time limit (30–90 s). A missing report is recorded as "no report" and the game continues. Kills never depend on reports, so missing a report gains nothing. |
| Multiple Killers and the accusation | The host chooses: **any one Killer** (default) or **every living Killer** at once. One accusation per game, usable in any phase after the reveal. |
| Killers win when all innocents are dead | The Police can't die, so the Killers win when every **Netizen** is dead. |
| Quiet rounds | The announcement says "No bodies found". An optional setting skips the discussion and goes straight to the next Action Phase. |
| Host powers | The host can pause and resume, skip waiting phases (reveal, report, announcement, discussion) and end the game. The host **cannot skip the Action Phase** and has no access to roles. |

## Fair play and secrecy

- The host's phone runs the game engine (`js/engine.js`). Each player only receives a personalised, sanitised view: their own role, their fellow Killers (if they are a Killer), and public facts.
- All private messages between phones are **end-to-end encrypted** (ECDH P-256 + AES-GCM). They travel through public MQTT relay brokers, so no server needs to run.
- Phones only play sounds that every phone plays at the same moment. Locking a target and receiving a warning are silent, and button clicks are muted during the Action Phase.
- After locking a target, the Killer's screen looks the same as everyone else's "mark your suspects" grid.
- Limitation: the host device holds the full game state in memory. The app never shows it, but a determined host with developer tools could read it. Pick a host you trust, or one who doesn't know their way around browser devtools.
- Phones stay awake through the Wake Lock API. If the host's page reloads, it offers "Resume hosting" and picks up where it left off. Players who reload rejoin as themselves.

## Sounds

There are 24 procedurally generated horror sounds in `assets/sfx/` (`tools/gen-sfx.cjs`):

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
| discussion | Discussion starts |
| accuse | The Police accuses |
| win_innocent, win_killer | End of game |
| join, click, wink, warning | Joining the lobby and UI sounds |

## Development

```
node tools/serve.cjs          # http://localhost:5190  (add ?dev=1 for "Add bot" test players)
node tools/test-engine.js     # 17 rule tests (scenarios A–D, curse, accusations, multi-killer…)
node tools/gen-sfx.cjs        # regenerate sounds (needs ffmpeg)
python tools/xlsx_to_json.py  # re-import the scenario spreadsheet
```

`tools/multi.html` opens a host and two players side by side for local testing.

The game can grow: roles live in `ROLE` and `roleCounts()` in `js/engine.js`. Future roles (Doctor, Informant, Guardian, Forensic, Jester, Mastermind) plug into `resolveRound()`.
