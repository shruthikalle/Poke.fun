# Owned card discovery

`GET /api/devnet-cards?owner=<Solana address>` retains its existing array response.

To enable discovery across an owner's approved collections, configure:

- `DAS_RPC_URL`: a server-only RPC URL implementing `getAssetsByOwner` on the intended network.
- `APPROVED_COLLECTION_IDS`: comma- or whitespace-separated collection addresses. If omitted, `DEVNET_TEST_COLLECTION_ID` supplies the existing approved collection.
- `NEXT_PUBLIC_COLLECTION_SOURCE=devnet`: the existing frontend selector for this route.

Discovery reads all pages, deduplicates asset IDs, and includes only supported NFT interfaces owned by the requested address in an approved collection. Burnt assets and explicitly unverified collection memberships are excluded. Metadata comes from the DAS response. Requests that fail, repeat pages, report partial errors, exceed 100 pages, or exceed the 30-second discovery deadline fail without returning a partial collection. DAS results reflect the provider's index, not a new independent on-chain ownership check.

Without `DAS_RPC_URL`, the existing Core lookup remains active using `DEVNET_RPC_URL`, `DEVNET_TEST_COLLECTION_ID`, `DEVNET_TEST_PIKACHU_ASSET`, and `DEVNET_TEST_CHARMANDER_ASSET`. No asset IDs need to be configured for the DAS path.

The mock collection scenarios and existing provider selection are preserved. Collector Crypt, wagering and paid demo entries, auth fallback, and the price provider are unchanged; missing integration credentials are intentionally skipped.
