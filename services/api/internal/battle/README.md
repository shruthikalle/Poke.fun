# Battle engine

Implement the authoritative one-card battle here. The server should own HP, turn order, legal attacks, timeouts, and the final outcome. Clients send choices, not computed damage or results.

Initial match shape: two players, one card each, one attack choice per turn, first card at zero HP loses. Card definitions live in `data/cards.example.json` until a verified catalog is built.
