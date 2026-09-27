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
Adaptive Curve IRM	0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1	Confirmed
Known trap: do not use the Ethereum-mainnet Morpho Blue address (0xBBBB...FFCb) on this chain — it is a different deployment and will silently fail or point at the wrong state.

Naming collision — disambiguate carefully: "Longbow" refers to three unrelated things on this chain: (1) the curated Morpho lending protocol this project actually integrates with (tracked on DefiLlama, ~$1.9M TVL); (2) an unrelated solo hackathon side-project called "Longbow Perps," a perpetuals DEX by a different builder; (3) an unrelated memecoin with ticker BOW. Only the first is relevant here. If you (the agent) find yourself about to use an ABI, repo, or contract from the second or third, stop — that's the wrong Longbow.

Verified Longbow NVDA/USDG market (mainnet, 2026-09-27): Longbow's official `https://www.longbow.cash/api/markets` record for `NVDA` identifies market ID `0x66306c087add8907752320b309934abcc354d21626de8115c79df49d9c214edc`, USDG loan token, NVDA collateral token, oracle `0xC5b8A6C5fDF14f9744dB1C8595f49E42Ce23031a`, Adaptive Curve IRM, and LLTV `625000000000000000` (62.5%). The Morpho public markets API returned the same immutable parameters, and `idToMarketParams` on the configured Morpho Blue contract returned an exact match. The backend's integration-status endpoint repeats this on-chain parameter check. This verifies market identity and immutable market parameters only; it does not verify borrow/supply execution, market liquidity at execution time, or oracle freshness.

The verified market oracle exposes Chainlink-compatible feed `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`, whose on-chain description is `RHNVDA / USD` and decimals are 8. Longbow's official docs state Robinhood equity feeds are 24/5 and hold the last price when US markets are closed; they do not specify a numeric maximum age suitable for this backend's execution gate. The backend reads the live round and reports its age but deliberately leaves freshness unassessed until a feed-specific max-age/market-closure policy is verified.

Blocked — do not resolve by guessing:

The product risk policy's operational `maxLtv` and `minBuffer`. The verified market LLTV of 62.5% is the protocol liquidation threshold, not automatically a safe operating target. Do not set operational `maxLtv` equal to LLTV or invent a buffer. Until these policy values and their calculation are explicitly established, borrowing plans must remain blocked.
The `RHNVDA / USD` freshness policy for execution. Longbow's official docs explain 24/5 behavior and periodic watchdog checks but do not give an execution max-age threshold. A successful oracle `price()` call does not prove its latest Chainlink round is fresh. Keep the safety gate blocked until the feed heartbeat/max-age rule and weekend handling are established from an official source or explicit product policy.
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

Each candidate calculates: amount sold, % sold, amount borrowed, USDG received, resulting LTV, liquidation buffer, fees, price impact, remaining exposure, execution cost, and pass/fail on every hard constraint. Reject any candidate that fails one.

9. Hard Constraint Evaluation
Machine-checkable, not prose:

sellAmount        <= maxSellAmount
usdReceived        >= targetAmount
resultingLtv       <= maxLtv          // explicit product risk policy; must be below market LLTV
liquidationBuffer  >= minBuffer       // explicit product risk policy; currently BLOCKED
slippage           <= maxSlippage     // suggested starting default: 1% — Sadiq's call to tune
executionCost      <= maxExecutionCost // suggested starting default: 1.5% of targetAmount — Sadiq's call to tune
marketLltv must be read from the selected market's verified on-chain parameters. It is a hard upper bound, not the operational maxLtv. maxLtv and minBuffer must not ship with placeholder values. Leave operational risk limits unset and fail loudly (INTEGRATION_UNAVAILABLE) until the product risk policy in §4 is resolved.

10. Safety Gate
Veto power, in sequence:

Oracle available? → Oracle fresh? → Asset active? → Protocol active?
  → Price within bounds? → Plan satisfies constraints? → Simulation successful?
  → Proceed / Halt
A failure at any stage blocks execution. No stage may be skipped for convenience.

11. Simulation
Use static/read-only execution (eth_call) against the actual swap and borrow call paths — not a reproduction of the planner's arithmetic. Verify expected output, resulting risk metrics, and revert behavior. A successful simulation is evidence, not a guarantee; chain state can move after it.

12. Final Re-check
Immediately before execution: refresh portfolio, market, oracle, and protocol state; recalculate constraints; compare against the confirmed plan. If it no longer holds: EXECUTION_BLOCKED. Never execute stale parameters. If any refreshed value can't be obtained cleanly, ask — don't substitute the last known value and proceed.

13. 0x Integration — High Risk, Verify Don't Assume
0x Price/Swap API is confirmed to support Robinhood Chain generally with a USDG base pair, per earlier project research — but that confirms existence, not this specific integration's correctness. Before this is "done," verify against the real API, on the real network:

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
