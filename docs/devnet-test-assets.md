# Devnet test assets

These Metaplex Core NFTs are **test assets only**. They are not Collector Crypt NFTs, do not represent vaulted physical cards, and carry no redemption rights.

The original two assets are listed below. The [full 17-card roster and powers](devnet-test-card-powers.md) includes six newer cards in `5EBw…shru`: two each at tiers 1, 2, and 3.

## Two six-card test wallets

Each wallet below received two cards at each power tier on November 15, 2026. Pikachu and Charmander are the tier 1 cards in both wallets so each can use the current live 1v1 mode. These are separate NFT assets in the same Devnet test collection.

| Wallet | Tier | Card | Onchain asset |
| --- | ---: | --- | --- |
| `Dxx5…Q8p6z` | 1 | Pikachu | [Explorer](https://explorer.solana.com/address/2saYysNiJBMMMYK5CYcXW22WjetLfhYqL2mCGRhfAx5C?cluster=devnet) |
| `Dxx5…Q8p6z` | 1 | Charmander | [Explorer](https://explorer.solana.com/address/VAkQKRThWPhhRMweRqN8ppQazBBoa3QuFBRRAX8nB88?cluster=devnet) |
| `Dxx5…Q8p6z` | 2 | Gyarados | [Explorer](https://explorer.solana.com/address/7deiPk2zHesJpUb9x8EQJjj8vT1q7tRavXFB7oBRczsn?cluster=devnet) |
| `Dxx5…Q8p6z` | 2 | Ninetales | [Explorer](https://explorer.solana.com/address/4bEL3B5oUD8WDXqv7m6BFRtFe8G4yfasbYgemysWCFRG?cluster=devnet) |
| `Dxx5…Q8p6z` | 3 | Charizard | [Explorer](https://explorer.solana.com/address/Dv22ETnw4BgZLwhHZ9ndeyVVSfzPEnUuway3Bbdf3Xy8?cluster=devnet) |
| `Dxx5…Q8p6z` | 3 | Blastoise | [Explorer](https://explorer.solana.com/address/F1q4SfLKcfQNZjfRkcjvyKYCSurYhuojfJz3nBVVQtY?cluster=devnet) |
| `7Aug…793k` | 1 | Pikachu | [Explorer](https://explorer.solana.com/address/BNLBcZsMp1JLTC9jAvqLig99fGP2TvUkBDgvmLnKFisV?cluster=devnet) |
| `7Aug…793k` | 1 | Charmander | [Explorer](https://explorer.solana.com/address/H4WfZot9AEJ2AtzLQmd93uMEFHnQ2drSACW2FeFK18r7?cluster=devnet) |
| `7Aug…793k` | 2 | Raichu | [Explorer](https://explorer.solana.com/address/DmNsMXpGcN4GagXfa8CH4DgbuuyKv78kBTNL47Ta7Jmc?cluster=devnet) |
| `7Aug…793k` | 2 | Dragonair | [Explorer](https://explorer.solana.com/address/FxmLku8GtjZgUXX5ii5h7bYWbJPWTDZfNbKWMwEhZ2kT?cluster=devnet) |
| `7Aug…793k` | 3 | Venusaur | [Explorer](https://explorer.solana.com/address/Dt57tyyV8RozG3iBcfueaqf6rKSLTUCUGUFKVfZwKaFm?cluster=devnet) |
| `7Aug…793k` | 3 | Zapdos | [Explorer](https://explorer.solana.com/address/89cJj5R3RqDtf1tRHfc8959DwgPf2275dscXC5ciDaom?cluster=devnet) |

| Test card | Asset | Recipient wallet |
| --- | --- | --- |
| Pikachu stand-in | [`DVSLcvn…Mk5Yn`](https://explorer.solana.com/address/DVSLcvnNv2JtWXsLmUWUsPtZCveuLSbc4ximXmSMk5Yn?cluster=devnet) | `5EBwgTSMRNRqFtrz27tQoFetTXViWZmwb1x2k4yshru` |
| Charmander stand-in | [`EK1GUyC…iiSs`](https://explorer.solana.com/address/EK1GUyC9CzUhQKFV8Jvx2voHqsUaxbjNCKhTuypxiiSs?cluster=devnet) | `HN7Q2DrJPVZ4zv8jaRgi77BpYuD6DuQF9pMp5zBPWLLo` |

Collection: [`9cu8Rf7…WRuCv`](https://explorer.solana.com/address/9cu8Rf7ryTHPrN24D62Q4xsEHnP8aBHS28mBdy4WRuCv?cluster=devnet).

The mint script uploads PNG images and Metaplex Core metadata with `name`, `symbol`, `description`, `image`, `category`, and `properties.files`. To refresh metadata for the already-minted cards without changing their asset addresses or owners, run `npm run refresh:test-cards` in `tools/devnet`, then `npm run verify:test-cards`. The refresh command needs the existing local mint payer keypair and mint state; keep both private and out of Git.

An onchain verified collection means each asset belongs to that collection. Phantom applies separate marketplace verification and filtering rules, so valid Devnet NFTs may still be absent from its Collectibles tab. The app's onchain lookup does not depend on Phantom's display or a Devnet SOL balance in the receiving wallets.

The default loadout reads the connected wallet's assets from the configured DAS-enabled Devnet RPC and filters for this test collection. The optional `NEXT_PUBLIC_COLLECTION_SOURCE=devnet` server route currently checks only the original Pikachu and Charmander asset IDs configured in `apps/web/.env.local`; leave that setting unset to display the full roster.
