# Purview Solidity workspace

This workspace contains fixed-call SELL, BORROW, and HYBRID router paths, including collateral-supply-only
HYBRID (zero swap plus borrow), a borrow-policy primitive, and
Foundry unit tests using local mocks. The router binds calls to deployment addresses, supports only the
three approved Uniswap V3 fee tiers, signs over the caller and exact action parameters, and has no
caller-selected target or arbitrary calldata path. Oracle freshness is action-specific: BORROW and HYBRID
use 3,660 seconds; SELL accepts only 3,660 seconds, 72 hours, or 96 hours. The longer SELL windows are
provisional product policy and depend on the backend signer attesting the correct session. Every action
checks the Chainlink round, `oraclePaused()`, and oracle deviation; borrow actions enforce the 60%-of-live-LLTV
cap.

The backend has an isolated execution-digest signing helper and a read-only router readiness diagnostic; the
signer is not connected to an execution route or configured. It must sign only after the approved market
session, jurisdiction, liveness, quote, and plan gates pass. For the 72/96-hour SELL windows to be accepted,
the constructor's maximum oracle age must be set to 96 hours; BORROW and HYBRID remain fixed at 3,660 seconds.
The caller must separately approve
NVDA spending to this router and authorize it on Morpho. These tests use mocks and do not prove behavior
against deployed Robinhood Chain contracts. Read-only mainnet-fork simulations of SELL, BORROW, and HYBRID
passed, but they use local-fork NVDA injection and simulated Morpho authorization. The router has not been
audited or deployed, and ordinary-wallet transfer/authorization behavior is not established. Do not use it
with funds or deploy it.

The current constructor inputs and pre-deployment blockers are recorded in [DEPLOYMENT.md](DEPLOYMENT.md).
The signer address is intentionally unresolved, and that file is preparation only; it does not authorize or
perform deployment.

## Local commands

Install Foundry using its official Windows instructions. From Git Bash, install the OpenZeppelin dependency
and run the local tests:

```bash
cd /c/Users/user/Desktop/Purview/contracts
/c/Users/user/.foundry/bin/forge.exe install OpenZeppelin/openzeppelin-contracts --no-commit
/c/Users/user/.foundry/bin/forge.exe test -vv
```

No live RPC, wallet, API key, or private key is needed for these local unit tests.

## Read-only Robinhood Chain fork checks

These tests construct the router locally and exercise live Morpho, token, Chainlink, Uniswap factory, and
QuoterV2 contracts on a fork. SELL, BORROW, and HYBRID test calls mutate only the temporary local fork; no
transaction is broadcast. The test harness injects NVDA into its own test account with a Foundry cheatcode
and simulates Morpho authorization on the fork. This requires neither a funded wallet nor real NVDA, but it
does not prove that an ordinary unmodified wallet or a newly deployed router is authorized by the token.
Outside a fork, Foundry skips these fork-only checks.

```bash
/c/Users/user/.foundry/bin/forge.exe test --fork-url https://rpc.mainnet.chain.robinhood.com --match-path test/PurviewRouterFork.t.sol -vv
```

The public RPC may rate-limit or time out. If that happens, use your own Robinhood Chain RPC URL locally in
the `--fork-url` argument; do not paste an API key into chat or commit it to the repository.
