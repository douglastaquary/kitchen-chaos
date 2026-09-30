# Kitchen Chaos — Design

## Design brief

- **Player promise:** run a cozy-but-frantic kitchen and out-cook a rival chef in a head-to-head service.
- **Target feeling:** juggling pressure — "just one more plate before the ticket expires".
- **Primary verb:** grab / place (E or Space). **Secondary verbs:** chop (hold F), dash (Shift), serve.
- **Every 5–30 s:** fetch an ingredient, process it (chop / fry / boil), plate it, serve it.
- **Across 1–5 min:** the ticket queue fills faster, harder recipes (Big Bonk Burger, Noodle Rumble) appear, the rival's coin total pulls ahead or behind.
- **Lose / learn / restart:** the match ends at 0:00 and the chef with more coins wins. Expired tickets and burnt food cost time and streak. Rematch is one click.
- **Rewarded:** fast delivery (tips scale with ticket time left) and streaks (consecutive on-time dishes). **Risk:** leaving a pan or pot on the stove burns it; ignoring old tickets expires them.
- **A better player:** parallelises — starts a patty frying, chops while it cooks, keeps a plate staged at the pass, serves the oldest ticket first.
- **Next decision communicated by:** ticket cards (icon + ingredients + draining timer), floating icons above crates, progress rings on boards/stoves, flashing warning when food is about to burn, glowing highlight on the station you face.
- **Non-goals:** online multiplayer, dirty-dish washing, multiple levels, character selection.

## Core loop contract

Player **grabs, chops, cooks and plates ingredients** to **serve the dishes on their tickets** while **ticket timers, burning food and a rival bot chef** create risk; success gives **coins + tips + streak bonus (the match score)**, failure causes **expired tickets, lost streak and wasted ingredients**, and the match can be **rematched instantly**.

Proof in code: `Chef.interact()` / `Chef.work()` are driven by real keyboard and touch input; tickets are visible in the HUD; ticket timers start draining in the first seconds; delivery adds coins that decide the winner; expiry and burning are announced with HUD/VFX/audio; the results modal offers Rematch.

## Recipes (Today's Specials)

| Dish | Parts | Coins |
| --- | --- | --- |
| Big Bonk Burger | bun + fried patty + chopped lettuce + chopped tomato | 30 |
| Sad Tomato Soup | 3 chopped tomatoes boiled in a pot | 20 |
| Noodle Rumble | 2 noodle bundles boiled in a pot | 24 |
| Rabbit Food | chopped lettuce + chopped tomato | 16 |
| Lonely Burger | bun + fried patty | 18 |

Tip = up to +10 based on time left on the ticket; streak bonus +2 per consecutive on-time dish (max +10).

## Level plan

- **Format:** single-screen 17×11 tile kitchen, mirrored left/right. Left half (mint floor) is the player's, right half (coral floor) is the rival's, centre (yellow) holds the lettuce/tomato crate island.
- **Camera:** fixed, elevated ~55° perspective that frames the whole room so both chefs and every station are always visible; fit is recomputed per aspect ratio (portrait zooms out).
- **Start:** chefs spawn in the centre of their half. First decision: which ticket to start (the first two tickets are simple: Rabbit Food + Lonely Burger).
- **First threat:** ticket timers visibly draining; first reward: first serve at the window (coins burst).
- **Landmarks:** chalkboard menu on the back wall, striped awning of the serving window on each side wall, stoves along the back wall, cutting boards on the front row.
- **Escalation:** ticket interval shrinks 16 s → 9 s over the match; Big Bonk Burger and Noodle Rumble enter the pool after 30 s; max 5 tickets visible.
- **Recovery beats:** the first 20 s only spawn two tickets; after each serve the next ticket spawns no sooner than 4 s.
- **Telegraphs:** cooked food gets a green check + ding; ~4 s before burning a red "!" flashes with a beeping alarm and smoke.
- **Modular pieces:** every station is a tile type in `src/game/Layout.ts`; the map is a string grid.
