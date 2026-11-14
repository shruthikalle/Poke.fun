# Devnet test assets

These Metaplex Core NFTs are **test assets only**. They are not Collector Crypt NFTs, do not represent vaulted physical cards, and carry no redemption rights.

| Test card | Asset | Recipient wallet |
| --- | --- | --- |
| Pikachu stand-in | [`DVSLcvn…Mk5Yn`](https://explorer.solana.com/address/DVSLcvnNv2JtWXsLmUWUsPtZCveuLSbc4ximXmSMk5Yn?cluster=devnet) | `5EBwgTSMRNRqFtrz27tQoFetTXViWZmwb1x2k4yshru` |
| Charmander stand-in | [`EK1GUyC…iiSs`](https://explorer.solana.com/address/EK1GUyC9CzUhQKFV8Jvx2voHqsUaxbjNCKhTuypxiiSs?cluster=devnet) | `HN7Q2DrJPVZ4zv8jaRgi77BpYuD6DuQF9pMp5zBPWLLo` |

Collection: [`9cu8Rf7…WRuCv`](https://explorer.solana.com/address/9cu8Rf7ryTHPrN24D62Q4xsEHnP8aBHS28mBdy4WRuCv?cluster=devnet).

The mint script uploads PNG images and Metaplex Core metadata with `name`, `symbol`, `description`, `image`, `category`, and `properties.files`. To refresh metadata for the already-minted cards without changing their asset addresses or owners, run `npm run refresh:test-cards` in `tools/devnet`, then `npm run verify:test-cards`. The refresh command needs the existing local mint payer keypair and mint state; keep both private and out of Git.

An onchain verified collection means each asset belongs to that collection. Phantom applies separate marketplace verification and filtering rules, so valid Devnet NFTs may still be absent from its Collectibles tab. The app's onchain lookup does not depend on Phantom's display or a Devnet SOL balance in the receiving wallets.

To display these cards in the app, copy the three public addresses into `apps/web/.env.local` using `apps/web/.env.example` and set `NEXT_PUBLIC_COLLECTION_SOURCE=devnet`. The server route checks each asset's owner and collection on Solana Devnet when a wallet loads its cards.
