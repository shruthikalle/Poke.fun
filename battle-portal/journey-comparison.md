# Poke.fun — two-persona journey comparison

Tested the production frontend at `http://localhost:3001` on commit `69b6ce5`, at 1280×800. Both journeys used separate browser profiles and the application's existing mocks, not real Privy or Phantom connections.

## Journey map

| Stage / ownership change | A — new consumer | B — existing account, optional Phantom |
|---|---|---|
| Starting state | Empty localStorage verified; signed-out My Cards had no account chip. | Separate initially clean profile; demo account and one purchased Wigglytuff were prepared through UI, then signed out before recording. |
| Authentication | Landing → Create account → ash@poke.fun → six-digit code. | Landing → Sign in → misty@poke.fun → six-digit code. Existing purchase returned. |
| Embedded account | Email verification silently created the account. Chip showed name and truncated address; no wallet setup, keys, gas, or blockchain explanation was required. | Sign-in restored the existing embedded address and collection. |
| Optional advanced account step | None: Phantom was never required for purchase, Collector's Crypt import, trading, or battle. | Account menu → Link Phantom. Menu changed to “Phantom linked” with a second truncated address. Embedded address and existing card did not change. |
| Marketplace | Searched “char,” used a filter and ascending-price sort, exercised USD/SOL and back, inspected physical-storage detail and history, bought Wigglytuff. | Browsed/searched Marketplace after linking, inspected Fearow detail and physical-storage copy, bought Fearow; prior Wigglytuff remained. |
| Import / ownership gain | Collector's Crypt → account email → progress → review four cards → import all four. Imported badges and “Added 4 cards” appeared. | Phantom → progress → review four results → deselect one → import three. Imported badges and “Added 3 cards from Phantom” appeared. |
| Listing / ownership loss | Listed imported Snorlax, edited price to $109 without duplicating the listing, accepted incoming offer; sold card left collection and proceeds/history appeared. | Listed imported Snorlax and accepted incoming offer. Purchase and battle access remained available after linking. |
| Trade / ownership swap | Accepted incoming Mew-for-Charizard-plus-money trade. | Accepted incoming Blastoise-for-Ninetales-plus-money trade. |
| Import-history regression | “Added 4 cards” remained after trade, sale, and refresh. | “Added 3 cards” remained after trade, sale, and refresh. Remaining owned-import count correctly fell to one. |
| Loadout / battle | Selected owned Charizard, chose squad format, completed an eleven-turn battle to defeat. Exercised real switching, multiple moves, waiting, timer copy, chat Send, official/community filters, Lobby tab, live-battle watch tab and watch chat. | Selected owned Ninetales, completed a five-turn 1v1 victory. Exercised moves and chat; switched display to SOL and saw SOL entry/winnings in badge and result. Returned to Loadout and saw SOL entry chips/quote. |
| Persistence | Post-battle My Cards refresh retained consumer account, four cards, purchase, four-card import history, sale, and trade. | Post-battle refresh retained Phantom linked state, same embedded address, both purchased cards, remaining imported card, and purchase/import/sale/trade history. |

## What changes after linking — and what does not

- **Changes:** account menu replaces “Link Phantom” with “Phantom linked · [address]”; Phantom is available as an import source, and its imported cards/activity are labeled with their source.
- **Does not change:** the embedded consumer address, email identity, existing collection, normal purchase flow, listing/trade controls, or battle access. Linking is optional, not a replacement account or onboarding requirement.
- The two personas use the same dark navy pixel panels, gold controls, typography, and navigation. Battle retains the denser three-column arena/log/sidebar layout without reverting to the old light theme.

| 🔴 Before optional linking — existing account | 🟢 After optional linking — same account and card |
|---|---|
| ![Existing account before linking](https://app.devin.ai/attachments/1efe83a9-e99e-413d-a3b3-f5aab5114a84/ss_f3e69ee8.png) | ![Same account after Phantom linking](https://app.devin.ai/attachments/7c7cff70-e300-4d7c-8899-ee73def22627/ss_12122bef.png) |

| A — consumer collection after battle and refresh | B — linked collection after battle and refresh |
|---|---|
| ![Consumer collection persisted](https://app.devin.ai/attachments/a1d41aeb-90a3-492d-b538-9719f297cb8a/ss_63da2061.png) | ![Linked collection and activity persisted](https://app.devin.ai/attachments/477e14a9-7731-423e-bf20-3ffa777f6ff0/ss_50fccd28.png) |

## Fix verification and remaining limits

- Rechecked live-battle row buttons opening trainer-named watch rooms with chat.
- Rechecked corrected timer-on copy: expiry picks a move rather than promising an automatic loss. Actual expiry behavior had been exercised in rehearsal; final recordings show the corrected copy.
- Rechecked fresh import activity counting by importer after a card leaves ownership.
- Rechecked battle USD/SOL controls. A separate SOL-started battle showed SOL in the match-start Entry log and ended with SOL winnings. The Entry log intentionally captures currency at match start rather than rewriting historical text after a toggle.
- No prohibited wallet/gas/mint/seed phrase/NFT jargon was observed in the normal consumer copy exercised. SOL was displayed only after explicitly selecting it. The Loadout custom-entry field remains dollar-denominated by design.
- No runtime exceptions, console errors, or network-loading failures were captured by the attached monitors during the final sessions. Repeated CSS preload-not-used warnings remain.
- Real Privy authentication, real Phantom extension approval/DAS/network behavior, on-chain settlement, mobile/responsive layouts, disconnect/reconnect handling, and negative/cancellation paths were not covered by these final recordings.
- In-progress battle resumption is not demonstrated: refresh checks were performed on My Cards after a completed match, not during an active battle.
- The private PR could not be read through the PR integration (“Not Found”); testing used the local checkout and running production frontend.
- No code was edited or committed by the testing agent. No new dead controls, overflow, or blocking visual issues were observed in these two desktop journeys.

## Recordings

- Journey A: `/home/ubuntu/screencasts/pf-journey-A-final/pf-journey-A-final-edited.mp4` — 6m17s, 1280×800.
- Journey B: `/home/ubuntu/screencasts/pf-journey-B-final/pf-journey-B-final-edited.mp4` — 1m53s, 1280×800.

Each is a single continuous user session; the recording tool condenses idle time. No developer tools are shown.
