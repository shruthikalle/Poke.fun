#!/usr/bin/env bash
# Uses the built market program and starts a fresh local validator with the real
# Metaplex Core program loaded, runs tests/market.mjs, then stops the validator.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f target/deploy/mpl_core.so ] || npm run fetch:core
PROGRAM_ID=$(solana-keygen pubkey target/deploy/pokefun_market-keypair.json)
PORT=${MARKET_TEST_PORT:-18999}
RPC="http://127.0.0.1:$PORT"
LEDGER=$(mktemp -d)
solana-test-validator --reset --quiet --rpc-port "$PORT" --faucet-port "$((PORT + 2))" --gossip-port "$((PORT + 3))" --ledger "$LEDGER" \
  --bpf-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d target/deploy/mpl_core.so \
  --bpf-program "$PROGRAM_ID" target/deploy/pokefun_market.so >"$LEDGER/validator.log" 2>&1 &
VALIDATOR=$!
cleanup() {
  kill "$VALIDATOR" 2>/dev/null || true
  wait "$VALIDATOR" 2>/dev/null || true
  rm -rf "$LEDGER"
}
trap cleanup EXIT
for _ in $(seq 1 60); do
  if ! kill -0 "$VALIDATOR" 2>/dev/null; then cat "$LEDGER/validator.log"; exit 1; fi
  if solana -u "$RPC" cluster-version >/dev/null 2>&1; then break; fi
  sleep 1
done
SOLANA_RPC_URL="$RPC" node tests/market.mjs
