# Purview Router local-fork deployment record and mainnet gates

This file distinguishes the persistent local Anvil fork from a public-chain deployment. The Anvil fork uses
Robinhood mainnet state but all local transactions and state changes remain on `127.0.0.1`; they are not
broadcast to Robinhood Chain. The production/mainnet deployment gates below still apply before a public
deployment. Never put a private key in this tracked file.

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
| `executionSigner_` | `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` on local Anvil only | Disposable Anvil account #1. Its default private key is publicly known and must never be used on a public network. |
| `maxOracleAgeSeconds_` | `345600` (96 hours) on local Anvil | Local simulation configuration, matching the router fork harness. The longer SELL limit is provisional product policy, not a Chainlink-published heartbeat. |

## Persistent local Anvil fork (2026-09-30)

- Process: PID `25596`; listens only on `127.0.0.1:8545`; Anvil 1.8.3; chain ID `4663`.
- Fork source: `https://rpc.mainnet.chain.robinhood.com`.
- Periodic local state file: `%TEMP%\purview-anvil-4663-refresh-20260930.json`.
- Backend's ignored `backend/.env` points `ROBINHOOD_RPC_URL` to this local endpoint and sets
  `PURVIEW_ROUTER_ADDRESS` to the local router. The second liveness RPC remains the public Robinhood RPC.
- Router address: `0x9a9edea6c804f40d81b1dc4ae551affbad2ec5bb`.
- Local deployment transaction: `0x97a4fd86218ec20f1563204346a6e1f2a081bd8abc65d794e00551135e981926`;
  local block `76801983`; receipt status `0x1`; runtime code length 12,941 bytes.
- Execution signer: Anvil account #1, `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`. This is only the disposable
  local-fork signer; its well-known test key is configured in ignored local `.env` for eth_call simulation.
- Morpho authorization account: the supplied wallet `0x1f7C14658650AaF03dEE7d5ffc451444C25D5392`, impersonated
  only inside Anvil and given local ETH for gas. The wallet authorized the router on the local fork.
- Authorization transaction: `0x9383a9084a536e4d7a2892c392431b8bdc028910177fed88fa99eb151fd01540`;
  local block `76801984`; receipt status `0x1`; a subsequent `Morpho.isAuthorized(wallet, router)` read returned `true`.
- These transaction hashes and state are local to Anvil. Neither transaction was sent to Robinhood mainnet.

The router constructor independently checks the live Morpho market ID, USDG/NVDA token pair, expected `62.5%`
LLTV, and token decimals. A mismatch reverts deployment. Pool addresses are checked when an execution is
attempted, not during construction.

## Gates before a public mainnet deployment

- Select a new, dedicated production signer address. Keep its private key in a secret store and never paste it
  into chat, source control, or a frontend. The local Anvil key is public and is not suitable for mainnet.
- Complete independent contract review before mainnet deployment. This is a production gate; it does not block
  the isolated Anvil fork or its read-only eth_call work.
- Recheck all addresses and the market parameters against current authoritative sources immediately before
  deployment. The recorded fork checks are point-in-time evidence, not a guarantee they remain unchanged.
- Decide whether `345600` is the intended constructor maximum. The backend must choose the signed SELL age
  from the trusted Nasdaq session result; the constructor maximum alone must never authorize stale execution.
- Keep jurisdiction eligibility blocked until an approved policy and trusted access check are configured.
  Deployment does not clear this backend gate, and the signer must not issue authorizations while it is blocked.
- Implement and review the production gated signer flow, then deploy only after the deployer explicitly approves
  the exact constructor arguments, transaction, and gas cost.
- After deployment, set `PURVIEW_ROUTER_ADDRESS` and the matching signer secret locally. Call
  `GET /api/execution/readiness` and verify the deployed bytecode and immutable signer match before any other
  integration work.

## Present state

The current router is deployed only on a persistent local Anvil fork at `http://127.0.0.1:8546`, forked at block
`78521493` using an archive-capable RPC configured in ignored `backend/.env`. Its address is
`0x19cc4dd8d86fc525f8cf37c51612de91b1e52038`; deployment tx
`0x25ad48e5c51b10b225ac8a6883ff7d4d689238515ae535a7dccb12b4fd7f945f` succeeded at local block `78521494`.
The supplied wallet authorized it on this local fork in tx
`0x62e6a10e52e9798e98174e2994f045193acb38e1d8319ea05a3bdea912264f34` at block `78521495`; Morpho reports
`isAuthorized(wallet, router) == true`. The backend on port 3001 now reads this fork. The prior 8545 fork and its
router remain untouched. No router is deployed on Robinhood mainnet or testnet. Backend readiness remains
`executable: false` because jurisdiction/signing gates remain blocked; local `eth_call` simulation does not submit
a transaction or clear those gates. The supplied wallet currently has no NVDA or USDG, so the planner has no
feasible candidate for its tested USDG 3,000 request and no successful planner-derived simulation is established.
Anvil interval mining is enabled at one-second intervals so the local head remains within the configured RPC
liveness age window; this advances only local block timestamps and does not refresh forked contract/oracle state.
If Anvil is restarted, enable interval mining again (for example, with Anvil's `--block-time 1` option) before
expecting the local liveness check to pass.
