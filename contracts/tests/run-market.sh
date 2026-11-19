#!/usr/bin/env bash
# Builds the market program, starts a fresh local validator with the real
# Metaplex Core program loaded, runs tests/market.mjs, then stops the validator.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f target/deploy/mpl_core.so ] || npm run fetch:core
PROGRAM_ID=$(solana-keygen pubkey target/deploy/pokefun_market-keypair.json)
LEDGER=$(mktemp -d)
solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --bpf-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d target/deploy/mpl_core.so \
  --bpf-program "$PROGRAM_ID" target/deploy/pokefun_market.so >/dev/null 2>&1 &
VALIDATOR=$!
trap 'kill $VALIDATOR 2>/dev/null; rm -rf "$LEDGER"' EXIT
for _ in $(seq 1 60); do solana -u l cluster-version >/dev/null 2>&1 && break; sleep 1; done
node tests/market.mjs
