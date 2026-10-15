# Fading Colors — Color Theory Adventure

A browser-based color-theory game built with HTML, CSS, JavaScript and Canvas. It uses the supplied title-screen art, aquarium map, octopus sprites, quest icons and sound effects. There are no frameworks or package dependencies.

## Run the game

1. Extract the ZIP.
2. Open a terminal in the extracted folder.
3. Run `python -m http.server 8000` (or `py -m http.server 8000` on Windows).
4. Open `http://localhost:8000` in Chrome or Edge.

The menu appears inside the browser window and does **not** request browser fullscreen. Click the artwork's **PLAY** button to show the animated briefing, then choose **START DIVE**.

## Controls

- **WASD** or **Arrow keys** — move.
- **E** — read a nearby field note, open a nearby quest terminal, or close an open field note.
- **1 / 2 / 3** — choose a quest answer.
- **Enter** — advance after a correct answer, or complete the current stage.
- **F** — briefly make clue markers shimmer.
- **Esc** — close a quest terminal; after a run ends, return to the main menu.
- **R** — restart the current run.
- Side-task reward — press **1**, **2**, or **3** to choose Room A, B, or C for a 12-second pause.

The pointer is hidden during play. Interactions are designed for the keyboard; no bottom control bar is shown.

## Question and hint pool

`data/quest-pool.json` is the editable content pool used by the game. It currently contains **16 main-quest packs** and **16 side-quest packs**, each with easy-English hints and three quiz stages. Every stage lists its question, three answer options, the correct answer text, and simple feedback.

For every run the game randomly selects **3 main quests** and **3 side quests**. Each selected main quest has exactly **2 hints**; each side quest has exactly **1 hint**, giving exactly **9 hint locations per run**. Main and side pools are separate so a pack cannot be picked as both types. Questions only test the color-theory ideas taught by that same quest's hint or hints.

The game also randomizes answer positions. In each three-stage quest, the correct answer appears once in position 1, once in position 2, and once in position 3, in a new random order. This stops players from learning that the first option is always right.

To add content, copy an entry in `main` or `side` in `data/quest-pool.json`. Main entries must have exactly two clue objects; side entries must have exactly one. Each entry needs at least three stages. For every stage, `options` must contain three different strings and `answer` must exactly match one of those strings. Keep each question tied directly to its clue lesson and use simple language.

## Game rules

- Each run chooses six different quest packs (three main and three side) and places nine clue notes around the map.
- Opening a clue automatically marks it as read. Clues are not collectible and remain at their map locations. Press **E** to close a note, or walk away; return to the exact clue to review it again.
- Main tasks are positioned at the pearl tables in Rooms A, B and C. Side quests are positioned at the S.T stations.
- A correct main task freezes that room's timer and preserves its remaining color. A wrong main-task answer closes and permanently locks that terminal for the run, fully fades the room, removes that room's timer bar, and increases the fading speed of other active rooms by 0.25×.
- If a room's timer reaches zero, that room is completely faded and its tasks are no longer accessible.
- Incorrect side-task answers can be retried and do not cause a fading penalty. While completing a side task, the other two rooms' timers pause. A successful side task offers a choice to pause one active room for 12 seconds.
- A run ends as soon as all three main-room outcomes have been decided (completed successfully or lost). Side quests must be completed before the final main task concludes the run. There is no extra time afterward.
- The results screen chooses one of four outcomes: zero or one room saved, two rooms saved, all three rooms saved, or all three rooms plus all three side quests completed. These screens currently contain score summaries and placeholders only; meme/video content will be added later.
- Each room has its own fading bar at the top of the HUD. Color loss gradually leaks into the central hall. The environment has underwater plant movement, bubbles, fish and ambient sound.

## Main files

- `index.html` — home menu, briefing, HUD, field-note window, task terminal and results screens.
- `css/style.css` — title-menu glow, floating briefing, responsive layout and ending-screen styles.
- `js/game.js` — movement/collision, timers, fading, clue interaction, quest logic, audio, ambient animations and ending selection.
- `data/quest-pool.json` — the editable main/side hint-question-answer content pool.
- `assets/home-screen.jpeg` — supplied main-menu artwork.
- `assets/aquarium-map.png` — supplied room map.
- `assets/sprites/` — original directional octopus sprites.
- `assets/icon-main.png`, `assets/icon-side.png`, `assets/icon-hint.png` — glowing interaction markers.
- `assets/*.mp3` — supplied background music and sound effects.

The **QUIT** button attempts to close the tab. Browsers may block scripts from closing tabs that were opened manually; if so, use **Ctrl+W** to close it yourself.
