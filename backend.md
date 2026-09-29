Purview — Backend Specification
Companion to build-spec.md. Read both before writing code.

0. Operating Rule for the Building Agent — Read This First
When you need a value, address, ABI, endpoint, or protocol behavior that is not explicitly given in this document, and you cannot verify it yourself with a real, successful call against a real endpoint — stop and ask a specific question. Do not guess. Do not invent a plausible-looking value. Do not silently fall back to mock data. Do not mark a task complete because it compiles.

This applies most to Sections 12–14 (0x, Longbow, router). Those are the highest-risk integrations in the whole project, and a wrong guess there is invisible until it's live and wrong. "I need you to confirm X because I can't verify it myself" is a correct, expected message from you. Silently proceeding on an assumption is not.

This is not a style preference. It is the single most important rule in this document.

Official-source authority: current on-chain state, verified deployed contracts, the protocol's own current API/docs, and the protocol's own current app take precedence over assumptions or conflicting values in repository markdown. Record material discrepancies in STATUS.md and update the affected specification. If official sources disagree with each other, cross-check on-chain state where possible; if the conflict remains unresolved, stop and ask rather than selecting a convenient value.

1. Purpose
The backend converts a validated natural-language request into a safe, deterministic, executable portfolio plan.

The backend must never let an LLM become the safety authority.

Intent → Validation → Portfolio/Protocol State → Deterministic Planner
  → Simulation → Safety Gate → Confirmation → Final Re-check
  → Execution Preparation → Router/Execution Layer → Verification
2. Trust Boundaries
Untrusted, always:

User input
LLM output
External API responses, until validated
Swap quotes, until validated
Any client-provided financial value or execution parameter
Trusted, only after server-side validation:

Server-queried portfolio state
Server-queried protocol state
Validated oracle data
Validated quotes
Validated contract configuration
The blockchain is the only source of truth for what actually executed.

3. Stack — Locked, Do Not Re-litigate
Backend: Node.js 20 LTS baseline + TypeScript + Fastify. Newer Node.js versions are allowed when the compiled output and runtime behavior remain equivalent; target ES2022 and avoid version-specific behavior.
Chain client: viem
Contracts: Solidity, Foundry, OpenZeppelin
Frontend: Next.js/React (per build-spec.md)
Why viem/TypeScript specifically: every official Robinhood Chain code sample (Orbitflare docs, Quicknode guides, the chain's own stock-token-reading tutorial) is written in viem/TypeScript, not ethers or web3.py. Building in the same language the reference examples use removes a translation step exactly where translation errors are easiest to introduce unnoticed. It also lets the router contract's ABI be generated directly as TypeScript types shared between backend and frontend, so the backend can't silently drift from what the deployed contract actually accepts.

4. Verified Network & Contract Configuration
Item	Value	Status
Chain (mainnet)	4663	Confirmed
Chain (testnet)	46630	Confirmed
RPC (mainnet)	https://rpc.mainnet.chain.robinhood.com	Confirmed
Explorer	https://robinhoodchain.blockscout.com (Etherscan does not index this chain)	Confirmed
USDG token	0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168	Confirmed, cross-checked across 3 independent sources
NVDA Stock Token	0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC	Confirmed, cross-checked across 2 independent sources
Morpho Blue core (chain 4663)	0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010	Confirmed
Morpho BlueBundlesV1 (chain 4663)	0x53A1eB6589861F686af7c531211E35Aefe30210f	Official Morpho SDK registry; live code present
Adaptive Curve IRM	0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1	Confirmed
Known trap: do not use the Ethereum-mainnet Morpho Blue address (0xBBBB...FFCb) on this chain — it is a different deployment and will silently fail or point at the wrong state.

Naming collision — disambiguate carefully: "Longbow" refers to three unrelated things on this chain: (1) the curated Morpho lending protocol this project actually integrates with (tracked on DefiLlama, ~$1.9M TVL); (2) an unrelated solo hackathon side-project called "Longbow Perps," a perpetuals DEX by a different builder; (3) an unrelated memecoin with ticker BOW. Only the first is relevant here. If you (the agent) find yourself about to use an ABI, repo, or contract from the second or third, stop — that's the wrong Longbow.

Verified Longbow NVDA/USDG market (mainnet, 2026-09-27): Longbow's official `https://www.longbow.cash/api/markets` record for `NVDA` identifies market ID `0x66306c087add8907752320b309934abcc354d21626de8115c79df49d9c214edc`, USDG loan token, NVDA collateral token, oracle `0xC5b8A6C5fDF14f9744dB1C8595f49E42Ce23031a`, Adaptive Curve IRM, and LLTV `625000000000000000` (62.5%). The Morpho public markets API returned the same immutable parameters, and `idToMarketParams` on the configured Morpho Blue contract returned an exact match. The backend's integration-status endpoint repeats this on-chain parameter check. This verifies market identity and immutable market parameters only; it does not verify borrow/supply execution, market liquidity at execution time, or oracle freshness.

The verified market oracle exposes Chainlink-compatible feed `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`, whose on-chain description is `RHNVDA / USD` and decimals are 8. Chainlink's official Robinhood docs state feeds operate 24/5 and publish no updates or heartbeat while markets are closed; they do not specify a numeric open-market heartbeat or numerical weekend stale limit. The backend provisionally uses the product-owner-supplied 3,600-second open-market heartbeat plus 60 seconds. Closed-market sell-only limits are provisionally 72 hours for an ordinary closure and 96 hours for a three-day holiday weekend; these are product policy inputs, not numeric values published by Chainlink. These closed-session limits are not applied until a trusted market calendar confirms the session, and they never permit borrow or hybrid plans.

Borrow integration verification (mainnet, 2026-09-27): Morpho's official source interface and deployed-address registry identify the settlement contract as Morpho Blue and list its core methods `supplyCollateral` and `borrow`. Direct collateral supply uses ERC-20 `transferFrom`, so NVDA allowance to Morpho is required; direct borrowing transfers USDG out and needs no USDG allowance. Direct self-calls do not need a separate Morpho position authorization. Morpho's current official SDK additionally registers BlueBundlesV1 at `0x53A1eB6589861F686af7c531211E35Aefe30210f` for Robinhood Chain; RPC confirmed code at that address. Its `supplyCollateralBorrow` operation is atomic and requires NVDA allowance to the bundle (or supported permit) plus Morpho authorization (or signed authorization). For the supplied wallet at block 74270091, both allowances were zero and bundle authorization was false. No write transaction or state-changing simulation has been performed. See `STATUS.md` for the remaining checks.

ABI reconciliation: the explorer-verified ABI/source for the deployed BlueBundlesV1 at `0x53A1eB6589861F686af7c531211E35Aefe30210f` confirms `blueBundlesV1SupplyCollateralAndBorrow` without a `minSharePriceE27` argument. The current Morpho repository's `IBlueBundlesV1.sol` interface includes that extra argument while its current `BlueBundlesV1.sol` implementation does not. Treat the deployed verified ABI as authority. Morpho's SDK may be used only after confirming that the selected SDK version encodes this exact deployed signature; do not use an inconsistent interface or assume the SDK matches. At block 74272226, the bundle's `BLUE()` and `PUBLIC_ALLOCATOR()` getters matched the official Morpho chain registry. Its `maxLtv` argument still needs the product risk policy value and must not be set to the market LLTV by default.

Blocked — do not resolve by guessing:

Approved risk policy (2026-09-28): maximum operational LTV is 60% of the selected market's live on-chain LLTV, with a minimum 40% collateral-price-drop buffer. Derive the cap from verified on-chain market parameters; the expected NVDA LLTV is 62.5%, and any difference blocks borrowing and must be surfaced. Global maximum slippage is 1%, maximum execution cost is 1.5% of target, and maximum oracle-to-selected-live-venue quote deviation is 2%. Uniswap V3 is the approved primary venue. User-specific limits may only tighten these caps.
The `RHNVDA / USD` feed address, description, and decimals are verified. Chainlink's official Robinhood feed docs confirm 24/5 operation and no updates/heartbeats while US equity markets are closed, but do not publish numeric open-market heartbeat or closed-session max age. By product-owner direction, the backend provisionally uses the online-reported 3,600-second heartbeat with the approved +60-second tolerance; status and quote responses mark it provisional. Closed-market sell-only bounds are provisionally 72 hours normally and 96 hours for a three-day holiday weekend, supplied by the product owner; these are not represented as Chainlink-published values. Set `NVDA_ORACLE_HEARTBEAT_SECONDS`, `NVDA_ORACLE_CLOSED_SELL_MAX_AGE_SECONDS`, and `NVDA_ORACLE_HOLIDAY_SELL_MAX_AGE_SECONDS` to later verified/approved values. The reported 0.5% update trigger is informational, not the oracle-to-quote safety limit; the 2% quote-deviation rule remains. Read `oraclePaused()` from the NVDA token and veto when true; round freshness remains the primary guard. The approved Nasdaq calendar reader is implemented with fail-closed network/parse handling and passed one live response/parser check at the recorded 2026-09-28 closed-market timestamp; ongoing session accuracy remains point-in-time. Closed market blocks BORROW and HYBRID but permits SELL-only, subject to all other safety gates.
Sequencer uptime feed: product owner reports none exists. The approved substitute compares latest block timestamps from two independently hosted Robinhood Chain RPC endpoints. Both must report chain ID 4663, each head must be no older than 60 seconds, and their timestamps must differ by no more than 30 seconds. These are conservative application policy defaults, not official sequencer guarantees; the check does not guarantee transaction inclusion. Configure `ROBINHOOD_LIVENESS_RPC_URL` with a second RPC host distinct from `ROBINHOOD_RPC_URL`; plan execution remains blocked until configured and passing. Testnet availability remains unverified for 0x, Longbow/Morpho, and Chainlink feed deployments on chain 46630.
Whether 0x API, Longbow/Morpho markets, and Chainlink feeds are actually live on testnet (46630), not just mainnet (4663). Every address above was found in a mainnet context. If any of these integrations only exist on mainnet, that's a decision Sadiq needs to make explicitly (demo on mainnet with small real amounts vs. mock that specific leg under MOCK_MODE=true, disclosed honestly in the pitch) — not something to decide unilaterally.
5. API Surface
GET  /api/health
GET  /api/integrations/status

POST /api/intent
POST /api/plan
POST /api/plan/:id/recheck

POST /api/execute
GET  /api/execution/:id
6. Intent Endpoint
POST /api/intent

Input:

{ "text": "I need $3,000 USDG without selling more than 20% of my NVDA." }
Output:

{
  "targetAsset": "USDG",
  "targetAmount": 3000,
  "restrictedAsset": "NVDA",
  "maxSellPercentage": 20
}
The parser must never invent a missing constraint. If ambiguous, return a structured clarification requirement:

{
  "status": "clarification_required",
  "field": "maxSellPercentage",
  "question": "How much NVDA are you willing to sell to get this?"
}
7. Portfolio State
Query real state server-side — never accept a balance or position the frontend supplies as authoritative. Use viem multicall to batch reads (name, symbol, decimals, balanceOf, totalSupply, relevant protocol position) in one RPC round trip, per the pattern in Robinhood Chain's own Stock Token reading guide. Timestamp state where it's used in a freshness check downstream.

8. Planner
Deterministic. Input: structured intent + validated portfolio/protocol/market state. Output: candidate plans (SELL, BORROW, HYBRID) with constraint checks and a selected feasible plan.

`POST /api/plan` performs a read-only candidate calculation using live wallet and Morpho state, verified market parameters, the Morpho oracle price, and exact Uniswap V3 quotes. It returns diagnostic candidate ranking and blockers; it is not execution-ready. Do not mark the planner complete until candidate outputs and hard-constraint decisions are validated against live requests and the remaining gates are cleared.

Each candidate calculates: amount sold, % sold, amount borrowed, USDG received, resulting LTV, liquidation buffer, fees, price impact, remaining exposure, execution cost, and pass/fail on every hard constraint. Reject any candidate that fails one.

9. Hard Constraint Evaluation
Machine-checkable, not prose:

sellAmount        <= maxSellAmount
usdReceived        >= targetAmount
resultingLtv       <= 60% of live on-chain market LLTV
liquidationBuffer  >= 40% price drop before market LLTV
slippage           <= 1%
executionCost      <= 1.5% of targetAmount
oracleQuoteDeviation <= 2% versus selected live Uniswap V3 quote
marketLltv must be read from the selected market's verified on-chain parameters. If NVDA LLTV differs from the approved 62.5% expectation, stop and report it. User-specific limits may tighten the global caps only.

10. Safety Gate
Veto power, in sequence:

Oracle available? → Oracle fresh? → Asset active? → Protocol active?
  → Price within bounds? → Plan satisfies constraints? → Simulation successful?
  → Proceed / Halt
A failure at any stage blocks execution. No stage may be skipped for convenience.

Planner decisions approved 2026-09-28 (recorded in DECISIONS.md): among candidates that pass all hard constraints, rank least NVDA sold, then larger liquidation buffer, then lowest valued execution cost. Return the top plan and one valid alternative with a strictly larger buffer if one exists. HYBRID can sell wallet NVDA and/or supply wallet NVDA then borrow; it cannot withdraw or sell deposited collateral. The sale limit percentage uses wallet plus deposited NVDA, while actual sale is capped at wallet NVDA and reduced by any newly supplied wallet NVDA. BORROW/HYBRID risk uses existing plus new collateral and existing plus new debt with market oracle price; derive the LTV cap as 60% of live verified LLTV. Valued execution cost is swap fee plus oracle-relative price impact; gas is separately reported as an ETH estimate, unassessed in USDG, and is never silently zero. Execution requires sponsored gas or sufficient wallet ETH for the bounded gas limit. Return NO_FEASIBLE_PLAN if every candidate violates any hard constraint.

`POST /api/plan` uses the approved 0.01 NVDA reference size for its global oracle comparison, avoiding rejection based only on an unrelated maximum-wallet-size quote. It returns the minimum sell quote per allowlisted fee tier and uses those exact outputs to rank SELL candidates. It also searches hybrid sale/borrow sizing per tier and adds BORROW candidates from live collateral, debt, market liquidity, oracle price, and verified LLTV. Quote-dependent sizing uses a single reported portfolio block; if the configured RPC refuses historical calls, the response reports unavailable rather than substituting latest-state or estimated quotes. These are diagnostic candidates, not executable plans. Hybrid sizing uses a binary search and verifies the adjacent lower input; it assumes feasibility is monotone over the eligible quote range and this assumption requires live-path validation.

Jurisdiction gate: planning and execution remain blocked until an approved jurisdiction policy and trusted location-verification source are configured. Do not infer a user's jurisdiction from a client-supplied value. Plans must disclose that legal availability depends on jurisdiction and that the backend has not determined the user's legal eligibility. The jurisdiction allow/deny list and location provider require explicit product approval; do not invent them.

11. Simulation
Use static/read-only execution (eth_call) against the actual swap and borrow call paths — not a reproduction of the planner's arithmetic. Verify expected output, resulting risk metrics, and revert behavior. A successful simulation is evidence, not a guarantee; chain state can move after it.

12. Final Re-check
Immediately before execution: refresh portfolio, market, oracle, and protocol state; recalculate constraints; compare against the confirmed plan. If it no longer holds: EXECUTION_BLOCKED. Never execute stale parameters. If any refreshed value can't be obtained cleanly, ask — don't substitute the last known value and proceed.

13. 0x Integration — High Risk, Verify Don't Assume
0x's current official supported-chains table confirms Swap API support for Robinhood Chain (4663). Its July 2026 changelog says BStocks are recognized and routable only for integrators with tokenized-equity access. On 2026-09-27, the live indicative price request for 1 NVDA returned `The sell token is not authorized for trade due to legal restrictions`. Treat NVDA selling through this 0x integrator as blocked; do not retry by changing accounts, routes, or parameters to evade the restriction. The key is configured in the ignored local `backend/.env`; keep it there or in the runtime environment, never in tracked files. Read-only endpoints request live indicative prices or firm quotes from the official v2 AllowanceHolder API using a caller-supplied raw amount; firm quotes also require a taker address. An indicative price is not executable. If 0x access is later formally granted, repeat the live request and safety validation before changing this status. Before this integration is "done," verify against the real API on the real network:

Network support for chain 4663 (and separately, 46630, if testnet is in scope)
Token support for USDG and NVDA specifically
Live quote retrieval
Price validity
Expected output amount
Minimum-output parameter, enforced by the swap contract itself
Spender/approval requirements
Swap target address
Recipient handling
A real simulation, then a real test execution
If any of these can't be confirmed with a live call, stop and report exactly which one — don't write the integration against an assumed shape of the response.

Uniswap V3 primary venue (Robinhood Chain 4663): use only the verified 0.01%, 0.05%, and 0.30% fee tiers with pool addresses defined in `backend/src/config.ts`. Do not use the 1% zero-liquidity pool, V4, a caller-supplied pool, or arbitrary calldata. Read-only quotes use QuoterV2; verify the pool's factory, token order, and fee onchain. Discard quotes more than 2% from Chainlink, then discard tiers whose effective price at size is more than 2% worse than the best eligible 0.01 NVDA reference quote, then select the highest USDG output. The latter was temporarily widened from 1% to 2% on 2026-09-29 at the product owner's direction; it is a route-quality filter, not the oracle or execution slippage cap. `GET /api/uniswap/quotes/nvda-to-usdg` implements this as a read-only quote path. A fixed unsigned call builder encodes only SwapRouter02 `exactInputSingle` inside its deadline-checked multicall, applies a 1% minimum-output haircut, and uses a 120-second deadline. The wallet transaction nonce is the replay control for direct calls; no extra Purview nonce is used. The builder is not exposed or wired to execution until freshness, runtime calendar validation, jurisdiction, chain-liveness, approvals, and simulation gates are complete.

`GET /api/uniswap/minimum-input/nvda-to-usdg?targetUsdg=3000&maximumNvda=20` is a diagnostic-only route for read-only minimum-input discovery. Both inputs are hypothetical quote parameters; it does not query or assert wallet ownership. It searches each allowlisted pool using the RPC `latest` tag when no snapshot is supplied, returns the adjacent lower-input result, and rechecks oracle and the temporary 2% reference-price tolerance. Since state can advance between reads on the public RPC, it is indicative only and must never be used as a wallet plan or execution authorization. Pinned snapshot mode remains available to callers with an RPC that supports the required historical state reads.

14. Longbow Integration — Highest Risk
Do not write ABI calls or a supply/borrow function signature from inference. Verify against the actual deployed contract and Longbow's actual curated market:

The specific market (see §4 — market ID and immutable parameters verified; runtime borrowing still unverified)
Confirmed collateral = NVDA, confirmed loan asset = USDG
The market's configured oracle address (verified on-chain; feed freshness still unverified)
Supply function signature, read from the real ABI
Borrow function signature, read from the real ABI
Whether a combined supply-and-borrow call exists, or two calls are required
Required approvals
Required transaction sequence
Simulation against the real market
Revert behavior
Testnet availability (see §4)
This section cannot be marked complete until the remaining risk-policy and integration checks in §4 and this section are resolved. That's expected, not a failure — report it as the current status, not as done.

15. Router / Orchestrator
Security-critical. Accepts only validated execution parameters:

maxSellAmount, minOutputAmount, maxBorrowAmount,
authorizedRecipient, swapTarget, borrowTarget
Sequence: validate caller/authorization → validate permitted targets → validate parameters → execute swap → verify swap output → execute borrow → verify borrow result → enforce hard limits → revert if any condition fails.

Do not build a general-purpose agent executor. No arbitrary delegatecall, target selection, or calldata unless specifically required, reviewed, and constrained — and if you think one of those is required, that's a stop-and-ask, not a build-and-continue.

16. Atomicity
If swap + borrow are in one router-controlled transaction, either leg failing must revert the whole transaction. Test at minimum:

swap succeeds + borrow succeeds  → transaction succeeds
swap fails                       → transaction reverts
borrow fails                     → transaction reverts
hard constraint fails            → transaction reverts
Never claim atomicity from code structure alone — only from a passing test. If true atomic bundling isn't achievable in time, document the real fallback sequence honestly (per build-spec.md §"Atomicity and the router contract") rather than implying something stronger than what was built.

17. Transaction-Level Constraints
The execution layer enforces critical limits independently of the planner — maxSellAmount, minOutputAmount, maxBorrowAmount, authorizedRecipient — so a planner bug can't turn a 20% sell limit into an 80% sell. Defense in depth:

LLM → Parser validation → Deterministic planner → Safety gate
  → Router constraints → Smart contracts → Blockchain
18. Machine-Readable Errors
INVALID_INTENT, MISSING_CONSTRAINT, UNSUPPORTED_ASSET, NO_FEASIBLE_PLAN,
ORACLE_UNSAFE, QUOTE_STALE, SLIPPAGE_LIMIT, BORROW_UNAVAILABLE,
SIMULATION_FAILED, EXECUTION_BLOCKED, EXECUTION_FAILED,
VERIFICATION_FAILED, INTEGRATION_UNAVAILABLE
Frontend translates these into plain language (per build-spec.md's failure-message examples). The backend never invents a new ad-hoc error string when one of these fits.

19. Verification
After execution, query actual blockchain state — never construct the receipt from the intended plan. Verify: transaction status, USDG received, NVDA remaining/sold, borrow amount, debt, LTV, collateral state, transaction hashes. Only verified values may appear as a completed result.

20. Fake Data Policy
Never fabricate portfolio balances, prices, quotes, LTV, liquidation buffers, transaction hashes, protocol positions, successful executions, or trust receipts — in the real execution path, ever.

Mocks are allowed only in isolated development, gated by an explicit MOCK_MODE=true. Mock mode must never be the default, never be used for real execution, and never silently activate after an integration failure — if an integration fails, that's an INTEGRATION_UNAVAILABLE error surfaced honestly, not a quiet fallback to fake data.

21. Definition of Backend Complete
Not complete because endpoints exist. Complete only when a real request → real state → validated intent → deterministic plan → safety checks → simulation → execution test → actual blockchain result → verification has been demonstrated for the relevant scope. Evidence goes in STATUS.md, not asserted here.

22. Core Rule
A broken real integration is better than a convincing fake integration.
