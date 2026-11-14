# Design audit: removing the generic, "vibe-coded" look

Scope: visual and copy only. Behaviour, typed seams, the summon, the card catalog and `/play` are unchanged. Screens were captured with a scripted Chrome run (stubbed Phantom) at 1280×800 and 1600×900. Every shot is in [`design-audit/`](design-audit/) as `before-<width>-<screen>.jpg` and `after-<width>-<screen>.jpg`.

Screens covered: landing (01), sign-in dialog (02), Loadout signed in (03), summon after landing (04), Loadout in Squad of 3 with an invalid entry (05), matchmaking search (06), match found (07), battle in progress (08), battle result (09), Loadout with an empty collection (10), `/dev/summons` (11) and Loadout as a guest (12).

## Pass 1: findings

| # | Where | What looked generic | Fix | Status |
|---|---|---|---|---|
| D01 | Site-wide | Inter for body text made every screen read like a SaaS template next to the pixel titles. | Body font is now **DotGothic16** (a pixel font that is still readable at 13px), via `--font-dot` in `app/layout.tsx` and `--font-body` in `app/globals.css`. Pixelify Sans stays for titles and Silkscreen for labels. `tabular-nums` is on by default so prices, ratings and timers line up. `font-synthesis: none` stops the browser faking bold on a single-weight pixel font. | Fixed |
| D02 | `/` | Tagline said "pick your six", which is wrong now that matches are 1 or 3 cards. A grey caption ("Free to play · Nothing to download") and an eyebrow above the title added clutter. | Tagline is now "Your cards come alive. Outthink your rival, one turn at a time.", larger and full-contrast. The eyebrow and caption are removed; "Playing as …" still shows once signed in. | Fixed |
| D03 | Sign-in dialog | Eyebrow "Welcome, trainer", a two-line pitch, a text "×" close and "!", "?" and "↗" characters used as icons. | Title plus one line ("Your cards, your rank, your battles."). Pixel-drawn SVG icons (`components/PixelIcon.tsx`) replace the text glyphs. The safety line is shortened to "We never ask for your recovery phrase." The error title is now "Couldn't sign you in" instead of "Something went wrong". | Fixed |
| D04 | `/loadout` | An eyebrow and a helper sentence under "Choose your champion". The format hint was a full sentence. Entry and format chips were flat 1px rectangles, and the custom field had a "Custom" placeholder. Move boxes sat inside the panel (boxes in boxes), and card tiles were plain 1px rectangles. | Eyebrow and helper removed; guests keep one short line about rentals. Hints are now "One card, no switching." and "Your lead plus two bench creatures. Empty slots use shared rentals." Chips use `.pf-chip`, with a pressed amber state. The custom field uses `.pf-input` (sunken, red when invalid, placeholder `0.00`). Moves are a list with a type-coloured bar, no nested boxes. Card tiles use `.pf-frame` (chunky 2px raised frame, stepped corners) and a double pixel ring when selected. | Fixed |
| D05 | `/loadout` with an empty collection | Two sentences of explanation, and the champion panel showed a lone "—". | "No cards yet" (or "None of these can battle") plus the "Battle as a guest" button. The panel now reads "Pick a card". | Fixed |
| D06 | Summon, after landing | The hint "Tap to pet · drag to turn · hover a move" showed every time. The moves panel floated at the far left edge, and its move rows were boxes inside a box. | The hint is shorter and shows once per browser for 4.5s (`pf:summon-tip-seen`). The panel sits next to the platform, and move rows use the type-coloured bar. | Fixed |
| D07 | Shared primitives | Panels and buttons had 1px borders and single-step corners, and every component styled its own inputs and chips. | `--notch-shape` is now a two-step pixel corner, and `--panel-border` is a 2px frame with a highlight and a shadow. New shared classes `.pf-frame`, `.pf-chip` and `.pf-input` are used on Loadout, `/battle` chat and `/dev/summons`. Focus rings draw inside the clipped shapes (`outline-offset: -6px`), so they stay visible. | Fixed |
| D08 | `/battle`, log and rooms | Showdown-style filler: "Card Clause" and "HP Percentage Mod" rules in the summary, and chatty room blurbs ("Relax here amidst the chaos.", ":P"). A flat 1px chat input. The tab close buttons were text "×". | The rules block shows only entry and ranks. Room blurbs are short ("Hang out between battles.", "Brackets every hour."). Chat uses `.pf-input`, and the tab close buttons use the pixel X icon. | Fixed |
| D09 | `/dev/summons` | One-off flat chips, search box and select. | These now use `.pf-chip` and `.pf-input`. | Fixed |
| D10 | `/battle` layout | The log column is wide and mostly empty early in a match. | Kept: the battle screen's density follows the agreed information layout (field, actions, log, rooms), and the log fills as turns play. Changing the layout is out of scope for a visual and copy pass. | Kept |
| D11 | Section eyebrows on landing sections and Loadout panel labels | Small uppercase labels. | Kept as Silkscreen labels: they are the type scale for small labels, not decoration, and the Loadout panel needs them to separate Format, Entry and Rank. Eyebrows that only repeated the heading were removed (D02–D04). | Kept |

Copy that must stay is unchanged: "Demo: no real money", the Pokémon trademark line, the sign-in safety line (shortened) and all `aria-label`s.

## Pass 2: review after the fixes

I re-ran the same scripted walk-through at both widths after all of the fixes above (`after-*` shots):

- No page errors in the console.
- Nothing scrolls sideways at 1280px.
- Behaviour is unchanged: Loadout → summon → matchmaking → battle → result all run, and the entry validation errors still show and still block Find match.
- No new generic-looking items were found. D10 and D11 stay as kept, for the reasons above.

| Screen | Before | After |
|---|---|---|
| Landing | ![](design-audit/before-1280-01-landing.jpg) | ![](design-audit/after-1280-01-landing.jpg) |
| Sign-in | ![](design-audit/before-1280-02-signin.jpg) | ![](design-audit/after-1280-02-signin.jpg) |
| Loadout | ![](design-audit/before-1280-03-loadout.jpg) | ![](design-audit/after-1280-03-loadout.jpg) |
| Summon | ![](design-audit/before-1280-04-summon-live.jpg) | ![](design-audit/after-1280-04-summon-live.jpg) |
| Entry error | ![](design-audit/before-1280-05-loadout-squad-error.jpg) | ![](design-audit/after-1280-05-loadout-squad-error.jpg) |
| Searching | ![](design-audit/before-1280-06-searching.jpg) | ![](design-audit/after-1280-06-searching.jpg) |
| Match found | ![](design-audit/before-1280-07-match-found.jpg) | ![](design-audit/after-1280-07-match-found.jpg) |
| Battle | ![](design-audit/before-1280-08-battle.jpg) | ![](design-audit/after-1280-08-battle.jpg) |
| Result | ![](design-audit/before-1280-09-battle-result.jpg) | ![](design-audit/after-1280-09-battle-result.jpg) |
| Empty collection | ![](design-audit/before-1280-10-loadout-empty.jpg) | ![](design-audit/after-1280-10-loadout-empty.jpg) |
| Gallery | ![](design-audit/before-1280-11-gallery.jpg) | ![](design-audit/after-1280-11-gallery.jpg) |
| Guest | ![](design-audit/before-1280-12-loadout-guest.jpg) | ![](design-audit/after-1280-12-loadout-guest.jpg) |

The 1600px shots are in the same folder (`*-1600-*`).
