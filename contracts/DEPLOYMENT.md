# Purview Router deployment preparation

This file records the current constructor inputs and launch gates. It is not a deployment script. No private
key, broadcast command, or live transaction belongs here. Do not deploy the current router until the blockers
below are resolved and the contract receives an independent security review.

## Current constructor inputs

Target chain: Robinhood Chain, chain ID `4663`.

| Constructor parameter | Current configured value | Basis / status |
| --- | --- | --- |
| `morpho_` | `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010` | Current backend configuration; fork tests read the live market through this deployment. Recheck at deployment time. |
| `nvda_` | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` | Current backend configuration; fork test verified the market token and its metadata at test time. |
| `usdg_` | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | Current backend configuration; fork test verified the market token and its metadata at test time. |
| `chainlinkFeed_` | `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15` | Current configured RHNVDA/USD proxy; fork test read a valid round at test time. Numeric feed heartbeat is still provisional. |
| `uniswapFactory_` | `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA` | Current backend configuration; fork test verified the allowlisted pool at test time. |
| `swapRouter02_` | `0xCaf681a66D020601342297493863E78C959E5cb2` | Current backend configuration; SELL/HYBRID fork calls succeeded at test time. |
| `executionSigner_` | **Not selected** | Must be a dedicated signer address. The router stores it immutably; changing it later requires a new router deployment. Do not use the user's wallet key. |
| `maxOracleAgeSeconds_` | `345600` (96 hours), proposed only | Allows the contract's approved 96-hour closed-market SELL policy. BORROW/HYBRID still use 3,660 seconds. The longer SELL limit is provisional product policy, not a Chainlink-published heartbeat. Confirm this exact choice before deployment. |

The router constructor independently checks the live Morpho market ID, USDG/NVDA token pair, expected `62.5%`
LLTV, and token decimals. A mismatch reverts deployment. Pool addresses are checked when an execution is
attempted, not during construction.

## Gates before any deployment

- Select and locally derive a dedicated signer address; keep its private key in a secret store and never paste
  it into chat, source control, or a frontend.
- Complete independent contract review. Current fork tests mutate only a local fork and inject test NVDA and
  Morpho authorization; they do not prove ordinary-wallet behavior or production readiness.
- Recheck all addresses and the market parameters against current authoritative sources immediately before
  deployment. The recorded fork checks are point-in-time evidence, not a guarantee they remain unchanged.
- Decide whether `345600` is the intended constructor maximum. The backend must choose the signed SELL age
  from the trusted Nasdaq session result; the constructor maximum alone must never authorize stale execution.
- Keep jurisdiction eligibility blocked until an approved policy and trusted access check are configured.
  Deployment does not clear this backend gate, and the signer must not issue authorizations while it is blocked.
- Implement and review the gated signer flow, then deploy only after the deployer explicitly approves the
  exact constructor arguments, transaction, and gas cost.
- After deployment, set `PURVIEW_ROUTER_ADDRESS` and the matching signer secret locally. Call
  `GET /api/execution/readiness` and verify the deployed bytecode and immutable signer match before any other
  integration work.

## Present state

No router address or execution signer key is configured. No router has been deployed. The backend readiness
endpoint is read-only and always returns `executable: false`.
