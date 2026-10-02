Purview Build Status

«Evidence ledger — green means demonstrated, not merely coded.»

Product:

Purview

Principle:

«Natural-language portfolio moves, bounded by hard, deterministic limits.»

---

Status Legend

[ ] Not started
[~] In progress
[?] Blocked / unknown
[x] Verified
[!] Failed

A feature should only become "[x]" when there is evidence that it works.

---

1. Repository

- [ ] Repository initialized
- [ ] Correct branch configured
- [ ] ".gitignore" reviewed
- [ ] Secrets excluded
- [ ] README reflects Purview
- [ ] Product specification committed
- [ ] Backend specification committed
- [ ] Build specification committed
- [ ] STATUS committed

Evidence:

Notes:

---

2. Frontend

Sign In

- [ ] Sign-in screen implemented
- [ ] Google authentication works
- [ ] Embedded wallet creation verified
- [ ] Wallet/seed-phrase complexity hidden from primary UX

Home

- [ ] Portfolio overview
- [ ] Natural-language input
- [ ] Loading state
- [ ] Error state

Clarification

- [ ] Ambiguous request detected
- [ ] Clarification question displayed
- [ ] User answer incorporated
- [ ] No unsafe default silently assumed

Plan + Confirm

- [ ] Amount received displayed
- [ ] Percentage sold displayed
- [ ] Amount borrowed displayed
- [ ] Remaining exposure displayed
- [ ] LTV displayed
- [ ] Liquidation buffer displayed
- [ ] Estimated cost displayed
- [ ] Confirmation required

Receipt

- [ ] Actual USDG received displayed
- [ ] Actual NVDA sold displayed
- [ ] Actual borrow displayed
- [ ] Actual resulting state displayed
- [ ] Verification status displayed
- [ ] Transaction links work

---

3. Backend

- [~] "/api/health" — implemented; runtime response not yet verified
- [~] "/api/integrations/status" — live endpoint verifies RPC, configured bytecode, market parameters, oracle diagnostics, and BlueBundlesV1 immutable dependencies; execution remains unverified
- [x] "/api/portfolio?address=..." — live read verified for the supplied wallet on Robinhood Chain; see portfolio evidence below
- [~] "POST /api/intent" — deterministic parser and Fastify route pass in-process tests; no live deployment check or AI provider integration
- [~] "POST /api/plan" — a live blocked preflight response was demonstrated; SELL/BORROW/HYBRID candidate calculation and ranking are wired, but a live feasible candidate has not been validated; execution remains disabled
- [~] "POST /api/plan/recheck" — HMAC plan-reference validation and fresh planner recheck are implemented; no planner-selected local-fork `eth_call` has succeeded end to end yet
- [ ] "/api/execute"
- [ ] "/api/execution/:id"

---

4. Intent Parser / AI

- [x] Deterministic parser accepts the documented USDG/NVDA pattern (local parser and route tests)
- [x] Target asset, target amount, restricted asset, and maximum sale percentage are parsed in local tests
- [x] Missing constraint returns a clarification in local parser and route tests
- [ ] AI provider selected and configured (product spec does not specify a provider)
- [ ] Model-backed intent parsing with strict output validation
- [ ] Model-generated plan and failure explanations, grounded only in backend results
- [ ] Parser cannot directly execute transactions
- [ ] Parser cannot override constraints
- [ ] Invalid parser output rejected

- Backend validation note (2026-10-01): `npm.cmd test` passed 32 tests; `GET /api/runtime` reported the configured local-fork host and `transactionSubmission: disabled`. A temporary frontend scaffold was removed after reaffirming the backend-first build order; frontend work remains not started.

### 2026-10-01: Local-fork RPC isolation

- Fixed the Uniswap quote client so it does not fall back from a loopback Anvil RPC to the separately configured live liveness RPC. Fork quotes now fail closed on fork RPC errors instead of potentially combining fork and live-chain state.
- Centralized loopback RPC detection for runtime status and local simulation gating. Added tests covering localhost, IPv4/IPv6 loopback, remote hosts, malformed URLs, and lookalike hostnames.
- `npm.cmd test` passed: 32 tests, 0 failures. This fixes RPC-source isolation; it does not make the public RPC archive-capable or demonstrate a successful planner-selected simulation.

---

5. Portfolio State

- [x] Real portfolio balance retrieved (live RPC read for the supplied address; evidence below)
- [x] NVDA balance and Longbow collateral position retrieved as raw on-chain values
- [x] USDG balance retrieved from the configured token contract
- [x] Existing debt assets calculated from borrow shares using live Morpho market state, IRM rate, accrued interest, and round-up conversion
- [x] Relevant Longbow collateral retrieved
- [x] State timestamp and block number recorded
- [ ] Frontend cannot supply authoritative balance

Evidence:

Address: 0x1f7C14658650AaF03dEE7d5ffc451444C25D5392
Network: Robinhood Chain (chain ID 4663)
Block: 74264244
Read at: 2026-09-27T21:34:35.000Z
Result: USDG balance 0 (6 decimals); NVDA balance 0 (18 decimals); Longbow NVDA collateral 0, borrow shares 0, debt assets 0, supply shares 0.
Calculation evidence: Morpho market borrow assets 417104502; borrow shares 416958477736447; last accrual 1790355990; live IRM borrow rate 9602823 WAD per second; elapsed 188885 seconds; pending market interest 756 raw loan-token units. Wallet debt rounds to 0 because its borrow shares are 0.

---

6. Oracle

- [x] Market oracle and Chainlink-compatible feed addresses read on-chain
- [x] Feed description, decimals, and latest round retrieved
- [ ] Freshness verified
- [ ] Asset status checked
- [ ] Protocol status checked
- [ ] Price bounds checked
- [ ] Stale oracle blocks execution
- [ ] Oracle evidence recorded

---

7. 0x Swap

- [x] Robinhood Chain support verified in the official 0x supported-chain table (Swap API, chain ID 4663)
- [ ] Required token support granted by 0x (live request rejected for legal restrictions)
- [ ] Quote retrieved
- [ ] Quote output validated
- [ ] Minimum output calculated
- [ ] Spender identified
- [ ] Swap target verified
- [ ] Recipient verified
- [ ] Swap simulated
- [ ] Testnet transaction verified
- [ ] Failure behavior verified

Evidence:

Network: Robinhood Chain (chain ID 4663), officially supported by 0x Swap API.
Key: configured in the ignored local `backend/.env`; backend status confirmed it is loaded. A live indicative price request for 1 NVDA (`sellAmountRaw=1000000000000000000`) was made on 2026-09-27. 0x rejected it: `The sell token is not authorized for trade due to legal restrictions`. Therefore NVDA selling is blocked for this 0x integrator; no quote or execution can be claimed. 0x documentation says BStocks require tokenized-equity access.
Endpoints: `GET /api/prices/nvda-to-usdg?sellAmountRaw=<base-units>&taker=<wallet>` (indicative, non-executable) and `GET /api/quotes/nvda-to-usdg?sellAmountRaw=<base-units>&taker=<wallet>` (firm quote).
Token:
Quote:
Transaction:
Result:
Date:

---

8. Longbow / Borrow

- [x] Longbow NVDA/USDG market identified and its immutable parameters matched on-chain
- [x] Collateral asset verified (NVDA)
- [x] Borrow asset verified (USDG)
- [x] Market oracle address and `RHNVDA / USD` feed identity matched on-chain and official API; freshness remains unverified
- [x] Direct supply function verified against Morpho's official interface/source
- [x] Direct borrow function verified against Morpho's official interface/source
- [x] Atomic `supplyCollateralBorrow` path verified in Morpho SDK and deployed BlueBundlesV1 source/ABI
- [x] Direct and bundled approval/authorization requirements identified; supplied wallet state read on-chain
- [x] Call sequence documented: direct flow uses approval then separate supply/borrow calls; bundle flow uses allowance/authorization prerequisites then one atomic supply+borrow call
- [ ] Simulation successful
- [ ] Testnet behavior verified
- [ ] Failure behavior verified

Evidence:

Market ID: 0x66306c087add8907752320b309934abcc354d21626de8115c79df49d9c214edc
Collateral: NVDA (0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC)
Borrow asset: USDG (0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168)
Direct functions: Morpho Blue `supplyCollateral(MarketParams,uint256,address,bytes)` and `borrow(MarketParams,uint256,uint256,address,address)`.
Atomic function: Morpho BlueBundlesV1 `blueBundlesV1SupplyCollateralAndBorrow`; official Morpho SDK exposes this as `supplyCollateralBorrow` on chain 4663.
Bundle: 0x53A1eB6589861F686af7c531211E35Aefe30210f; live RPC returned bytecode at block 74269354.
Immutable dependency check: at block 74272226, BlueBundlesV1.BLUE() returned the Morpho Blue core address and PUBLIC_ALLOCATOR() returned the official Morpho Robinhood Chain allocator address; both matched the Morpho SDK registry.
ABI note: the current Morpho repository's IBlueBundlesV1 interface file has an extra minSharePriceE27 parameter that is absent from the deployed verified contract source and explorer ABI. Use the deployed ABI and official SDK builder, not that mismatched interface file, when constructing calls.
Approvals: direct NVDA allowance to Morpho; bundled NVDA allowance/permit to BlueBundlesV1 plus Morpho authorization/signature. Direct borrow requires no USDG approval; USDG approval is needed for repayment.
Supplied wallet at block 74270091: NVDA allowance to Morpho = 0; NVDA allowance to BlueBundlesV1 = 0; BlueBundlesV1 Morpho authorization = false.
Simulation/transaction: none performed.
Date: 2026-09-27

---

9. Deterministic Planner

- [~] SELL/BORROW/HYBRID candidate generation is wired into `POST /api/plan`; one live response had zero candidates because the wallet had no saleable NVDA and the market was closed
- [~] Candidate amounts, sale percentage, borrow amount, resulting LTV, liquidation buffer, expected USDG, fees, price impact, remaining exposure, and execution cost are calculated from live reads; no live feasible candidate has yet been ranked

---

10. Hard Constraints

- [~] Maximum sell constraint — implemented in candidate construction; live candidate validation pending
- [~] Minimum USDG output — implemented in candidate construction; live candidate validation pending
- [~] Maximum LTV — derived from verified LLTV and checked in candidate construction; live candidate validation pending
- [~] Minimum liquidation buffer — checked in candidate construction; live candidate validation pending
- [~] Maximum slippage — checked against the configured 1% cap; live candidate validation pending
- [~] Maximum execution cost — checked against the configured 1.5% cap; live candidate validation pending
- [~] Oracle-to-quote deviation — checked against the configured 2% cap; live candidate validation pending

Test:

Valid plan:
[ ]

Invalid sell percentage:
[ ]

Invalid minimum output:
[ ]

Invalid LTV:
[ ]

Invalid liquidation buffer:
[ ]

Invalid slippage:
[ ]

---

11. Simulation

- [ ] Real swap call simulated
- [ ] Real borrow call simulated
- [ ] Combined route simulated where supported
- [ ] Expected output checked
- [ ] Revert behavior checked
- [ ] Simulation failure blocks execution

Evidence:

Simulation:
Block/state:
Result:
Date:

---

12. Router / Orchestrator

Contract

- [~] Fixed-call hybrid router prototype compiled; 10/10 router tests and 2/2 policy tests passed against local mocks, including after adding the public execution-digest helper.
- [x] Foundry project configured (`contracts/foundry.toml`)
- [x] Borrow policy primitive compiled; its two Foundry unit tests passed on the user's Windows environment (Solc 0.8.24, Forge 1.8.3; 2 passed, 0 failed)
- [ ] OpenZeppelin dependencies verified
- [ ] Router deployed locally
- [ ] Router deployed to testnet

Authorization

- [x] Caller authorization checks Morpho permission and backend execution signature
- [x] Recipient is fixed to the calling wallet
- [~] Targets are immutable per deployment and pool fee tiers are allowlisted; deployment configuration still needs independent verification
- [x] No unrestricted arbitrary execution or caller-supplied calldata
- [x] No delegatecall

Backend signature handoff

- [x] Router exposes the exact personal-sign digest through `executionDigest`
- [x] Backend helper validates key format and matches its derived address to the supplied expected signer address
- [ ] Dedicated signer secret configured locally
- [ ] Helper connected to a confirmed, simulated, fully gated execution path (no signing API route currently exists)

Parameters

- [x] `maxSellAmount`
- [x] `minOutputAmount`
- [x] `maxBorrowAmount`
- [x] Authorized recipient enforced as `msg.sender`

---

13. Router Security Tests

- [x] Valid swap succeeds (mock)
- [x] Valid borrow succeeds (mock)
- [x] Valid combined operation succeeds (mock)
- [x] Swap minimum-output failure reverts the combined operation (mock)
- [x] Borrow failure reverts the combined operation (mock)
- [x] Maximum sell violation reverts
- [x] Minimum output violation reverts
- [x] Maximum borrow violation reverts
- [x] Recipient is not caller-selectable; always `msg.sender`
- [x] Unallowlisted fee tier reverts
- [x] Relevant malformed and unsafe oracle conditions revert

---

14. Atomicity

Current status:

Read-only execution:
[ ]

Single-leg execution:
[ ]

Atomic hybrid execution:
[ ]

Gasless execution:
[ ]

Atomicity is considered verified only when:

Swap succeeds + borrow succeeds
→ entire transaction succeeds

Swap fails
→ entire transaction reverts

Borrow fails
→ entire transaction reverts

Hard constraint fails
→ entire transaction reverts

Evidence:

- Test: user-reported `forge test -vv`, Forge 1.8.3 / Solc 0.8.24; 10 router tests + 2 policy tests passed
- Transaction: local Foundry unit tests with mocked Morpho, Uniswap, token, and oracle contracts; no chain transaction
- Result: mock-path combined success and full rollback after borrow, output-floor, and LTV failures demonstrated. This is local test atomicity only; live deployed-contract behavior remains untested.
- Date: 2026-09-29

Do not call the system atomic before this section contains real evidence.

---

15. Final Re-check

- [ ] Portfolio refreshed before execution
- [ ] Price refreshed before execution
- [ ] Oracle refreshed before execution
- [ ] Protocol availability refreshed
- [ ] Constraints recalculated
- [ ] Stale plan rejected
- [ ] Changed market state triggers abort/re-plan

---

16. Execution

- [ ] User confirmation required
- [ ] Execution parameters generated server-side
- [ ] Transaction-level limits enforced
- [ ] Minimum output enforced
- [ ] Maximum sell enforced
- [ ] Maximum borrow enforced
- [ ] Authorized recipient enforced
- [ ] Execution result recorded

---

17. Verification

- [ ] Transaction status queried
- [ ] Actual USDG received queried
- [ ] Actual NVDA balance queried
- [ ] Actual NVDA sold calculated
- [ ] Actual borrow queried
- [ ] Actual debt queried
- [ ] Actual LTV queried
- [ ] Actual liquidation buffer queried where supported
- [ ] Trust receipt generated from verified values

---

18. Fake-Data Audit

- [ ] No fake balances in real mode
- [ ] No fake prices in real mode
- [ ] No fake quotes in real mode
- [ ] No fake LTV
- [ ] No fake liquidation buffer
- [ ] No fake transaction hashes
- [ ] No fake protocol positions
- [ ] No fake execution result
- [ ] No fake receipt
- [ ] Mock mode explicitly isolated
- [ ] Mock mode never executes
- [ ] Real integration failures never trigger mock success

---

19. End-to-End Demo

Primary request:

«"I need $3,000 USDG without selling more than 20% of my NVDA."»

- [ ] Sign in
- [ ] Portfolio loaded
- [ ] Request submitted
- [ ] Intent parsed
- [ ] Constraints validated
- [ ] Real state queried
- [ ] Candidate plans generated
- [ ] Feasible plan selected
- [ ] Simulation succeeds
- [ ] Safety gate passes
- [ ] Full plan displayed
- [ ] User confirms
- [ ] Final re-check passes
- [ ] Router constraints enforced
- [ ] Execution succeeds
- [ ] Actual result verified
- [ ] Trust receipt displayed

---

20. Failure-Path Demo

At least one failure should be intentionally demonstrated.

- [ ] Constraint failure
- [ ] Stale oracle
- [ ] Slippage failure
- [ ] Market moved during confirmation
- [ ] Simulation failure
- [ ] Borrow unavailable

The system must fail safely and explain why.

---

21. Execution Mode

Current execution mode:

Read-only:
NOT VERIFIED

Single-leg execution:
NOT VERIFIED

Atomic hybrid:
NOT VERIFIED

Gasless:
NOT VERIFIED

Update only when evidence exists.

---

22. Current Blockers

Blocker: Operational borrow-risk policy
Status: [x] Product owner approved maximum operational LTV at 60% of live on-chain LLTV and a 40% minimum collateral price-drop buffer. Backend derives the cap from the verified market parameters; this prior blocker is resolved.
Impact: The policy is configured. Borrow execution remains blocked by the outstanding oracle, session, jurisdiction, and liveness gates below.
Next action: Continue clearing the remaining execution gates; stop borrowing if on-chain LLTV differs from the approved 62.5% expectation.
Owner: Sadiq / implementation agent

Blocker: Chainlink feed freshness policy
Status: [?] Feed identity is verified. The backend uses a provisional 3,600-second open-market heartbeat plus 60 seconds. For closed-market sell-only plans, product-owner provisional limits are 72 hours (ordinary closure) and 96 hours (three-day holiday weekend). Chainlink has not published/confirmed these numeric values for this feed/network; its docs direct integrators to define their own stale-data behavior.
Impact: Open-market freshness and closed-market sell age are assessed using provisional policy. Closed-session bounds are not applied until the approved calendar identifies the session. Borrow/hybrid remain blocked during closed sessions. Other execution gates still block execution.
Next action: Replace the provisional heartbeat if Chainlink confirms a different feed-specific value. The Nasdaq calendar parser/gate is implemented and fails closed; validate its live response before exposing plan or execution behavior.
Owner: Sadiq / implementation agent

---

23. Integration Evidence

Every completed integration should record:

Integration:
Network:
Contract/API:
Action tested:
Expected:
Actual:
Transaction / request:
Result:
Date:

Diagnostic evidence:

Integration: Robinhood Chain RPC and configured contract-address diagnostics
Network: Robinhood Chain mainnet (chain ID 4663)
Contract/API: https://rpc.mainnet.chain.robinhood.com; Morpho public API GET /v1/blue/markets filtered by chain, USDG loan token, and NVDA collateral
Action tested: GET /api/integrations/status; read chain ID and block number; read bytecode at configured USDG, NVDA, Morpho Blue, and Adaptive Curve IRM addresses; query Morpho market candidates and official listed=true filter
Expected: RPC reports chain 4663; addresses have bytecode; market query uniquely identifies Longbow's configured borrow market
Actual: RPC reported chain 4663 at block 74235817; bytecode was present at all four configured addresses; market query returned multiple candidates with differing oracle addresses and LLTVs; listed=true returned an empty list
Transaction / request: GET http://127.0.0.1:3001/api/integrations/status; GET https://api.morpho.org/v1/blue/markets?chain_id=4663&loan_token=4663%3A0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168&collateral_token=0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC&limit=100; same query with listed=true
Result: RPC reachability and bytecode presence demonstrated. Token identity, protocol behavior, selected Longbow market, oracle, LLTV, and execution readiness are not established. Borrow planning remains blocked.
Date: 2026-09-27

Integration: Longbow NVDA oracle and Chainlink feed diagnostics
Network: Robinhood Chain mainnet (chain ID 4663)
Contract/API: Morpho market oracle `0xC5b8A6C5fDF14f9744dB1C8595f49E42Ce23031a`; Chainlink-compatible feed `0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15`; official Robinhood Chain Blockscout verified contract metadata
Action tested: Read market oracle, BASE_FEED_1/2, oracle price, feed description/decimals/latestRoundData, and current block timestamp using viem through `/api/integrations/status`
Expected: Confirm feed identity and data; determine freshness only against an established max-age policy
Actual: Feed description `RHNVDA / USD`, 8 decimals; answer `22566018707`; updatedAt `1790366165`; age `177802` seconds; Morpho oracle `price()` returned raw `225673727493649618977138628`
Transaction / request: `GET http://127.0.0.1:3001/api/integrations/status`; Blockscout `/api/v2/smart-contracts/0xC5b8A6C5fDF14f9744dB1C8595f49E42Ce23031a`
Result: Feed data retrieval demonstrated. Freshness remains unassessed and integration status is blocked; no price was used to plan or execute an action.
Date: 2026-09-27

Integration: Longbow NVDA/USDG market configuration
Network: Robinhood Chain mainnet (chain ID 4663)
Contract/API: Longbow official market page `https://www.longbow.cash/borrow/NVDA` and its `/api/markets`; Morpho public markets API; Morpho Blue `0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010`
Action tested: Matched Longbow's NVDA record to the Morpho market API record, then read `idToMarketParams` from Morpho Blue through viem and backend `/api/integrations/status`
Expected: Market ID, loan token, collateral token, oracle, IRM, and LLTV all match across official records and on-chain parameters
Actual: Market ID `0x66306c087add8907752320b309934abcc354d21626de8115c79df49d9c214edc`; USDG loan; NVDA collateral; oracle `0xC5b8A6C5fDF14f9744dB1C8595f49E42Ce23031a`; Adaptive Curve IRM `0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1`; LLTV `625000000000000000` (62.5%) matched on-chain
Transaction / request: Official Longbow `GET /api/markets`; Morpho `GET /v1/blue/markets`; read-only Morpho Blue `idToMarketParams` call; `GET http://127.0.0.1:3001/api/integrations/status`
Result: Market identity and immutable parameters verified. No borrow transaction or oracle-freshness check performed. 62.5% LLTV is not used as the operational maxLtv.
Date: 2026-09-27

---

24. Feature Freeze

Target:

2 days before final demo/event.

After freeze:

- [ ] Core execution stable
- [ ] Safety paths stable
- [ ] UI polished
- [ ] Pitch rehearsed
- [ ] Backup video recorded
- [ ] Backup demo path tested

---

25. Definition of Done

Purview is demo-ready when:

- Core happy path works.
- Relevant safety constraints are enforced.
- Real integrations have evidence.
- Failure paths work.
- Router security tests pass.
- Atomicity is either demonstrated or honestly marked unavailable.
- Final re-check works.
- Actual execution results are verified.
- No fake data exists in the real path.
- Trust receipt reflects actual state.
- Blockers are documented.
- Backup demo material exists.

«Green means demonstrated, not merely coded.»

## Approved risk-policy update — 2026-09-28

- Product owner approved max operational LTV = 60% of live on-chain LLTV, 40% minimum liquidation price-drop buffer, 1% max slippage, 1.5% max execution cost, and 2% maximum deviation from the selected live venue quote. Uniswap V3 is now the primary venue. User limits may only tighten these values. The older entries above saying this policy is unapproved are superseded.
- Chainlink NVDA feed address is verified. The official Robinhood feed docs establish 24/5 behavior and no off-hours heartbeat, but do not state numeric open-market heartbeat or weekend-age values. At the product owner's direction, the backend provisionally uses 3,600 seconds plus the approved 60-second tolerance for open market. It also records 72-hour ordinary-closure and 96-hour three-day holiday-weekend age limits for closed-market sell-only policy; these are provisional product settings, not numeric Chainlink recommendations. They are not applied until the approved market calendar identifies a closed session. The reported 0.5% deviation trigger is informational, not an execution limit; the approved 2% quote-deviation gate remains.
- User directs reading `oraclePaused()` from the NVDA token and vetoing when true. The backend now attempts this read; if it reverts or is unavailable, the oracle gate fails closed. A live RPC result still needs confirmation at runtime.
- The backend derives the operational LTV from verified market parameters and exposes the approved global limits. Plans compare live Uniswap V3 quotes to Chainlink and use the fixed verified pool allowlist. The on-chain LLTV comparison remains against the user's expected 62.5%; a mismatch blocks borrowing.
- Plan responses now include a jurisdiction disclosure and fail-closed jurisdiction gate. A jurisdiction allow/deny policy and trusted location-verification source are still unconfigured, so this is not yet country-specific geoblocking.
- Sequencer uptime feed is reported absent. The later approved RPC-based liveness substitute and its current configuration requirement are recorded below. Testnet deployment support for 0x, Longbow/Morpho, and Chainlink feeds remains unverified.
- 0x remains restricted for this integrator unless access is formally granted. It is not used as the primary venue or bypassed. Rialto remains an unverified alternative; no integration is built against it.

## Uniswap V3 NVDA → USDG quote evidence — 2026-09-28

Scope: read-only `eth_call` only; no swap transaction, signature, approval, or router calldata was sent. User approved the Uniswap V3 0.01%, 0.05%, and 0.30% pools, excluding the 1.00% pool and all V4 pools.

Evidence source: Robinhood Chain public RPC, chain ID 4663, all calls pinned to block `74711112` (`0x4740048`), timestamp `2026-09-28T10:03:53Z`. Uniswap's official Robinhood V3 factory is `0x1f7d7550b1b028f7571e69a784071f0205fd2efa`; its `getPool(USDG,NVDA,fee)` results matched each allowlisted pool, and each pool's `factory()` returned that factory. USDG/NVDA decimals read on-chain: 6/18. QuoterV2 `0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7` was called with `quoteExactInputSingle`; no executable quote API was used.

Pool addresses: 0.01% `0xb75d2d02b0ec3de50d32e40a4f1a8dae8acc4333`; 0.05% `0xd4eb21209c4d6093f80b5b84f5c45cc093ea14a3`; 0.30% `0xb944cec30bd4175855215d767adc81f39e5f7e2b`. The 1.00% pool `0xc277560df3689a401ba7dedd7626168b234ceb5e` had zero active liquidity at the read snapshot and is excluded.

NVDA input sizes: `0.010000000000000000` NVDA; `13.371168833616368634` NVDA (approximately $3,000); `44.570562778721228780` NVDA (approximately $10,000). The approximate USD sizes use the configured, previously on-chain-verified RHNVDA/USD feed. At this block, its answer was `$224.36333258`, `updatedAt=1790586063` (`2026-09-28T09:01:03Z`), age `3770` seconds; `oraclePaused()` on the NVDA token returned `false`. The Chainlink heartbeat has not been supplied, so the round's freshness cannot be certified. It would require a published heartbeat of at least 3710 seconds to satisfy heartbeat + 60 seconds at this snapshot. Comparisons below are therefore diagnostic/provisional; no execution tier is authorized until freshness is confirmed.

For each row, impact is the effective quote price versus that pool's `slot0` marginal price. Chainlink difference is `(effective quote price / $224.36333258) - 1`. USDG outputs are raw QuoterV2 outputs converted using 6 decimals.

| Fee tier | NVDA input | USDG output | Effective USDG/NVDA | Impact vs `slot0` | Difference vs Chainlink | Result |
|---:|---:|---:|---:|---:|---:|---|
| 0.01% | 0.01 | 2.071671 | 207.1671 | 0.011% | -7.664% | Drop: exceeds 2% oracle deviation |
| 0.01% | ~3,000 USD | 82.296459 | 6.1548 | 97.029% | -97.257% | Drop: quote reaches `MAX_SQRT_RATIO` price limit; not a complete usable fill; also exceeds deviation |
| 0.01% | ~10,000 USD | 82.296459 | 1.8464 | 99.109% | -99.177% | Drop: quote reaches `MAX_SQRT_RATIO` price limit; not a complete usable fill; also exceeds deviation |
| 0.05% | 0.01 | 2.245904 | 224.5904 | 0.050% | +0.101% | Passes both quote filters |
| 0.05% | ~3,000 USD | 3,002.981042 | 224.5863 | 0.052% | +0.099% | Passes both quote filters |
| 0.05% | ~10,000 USD | 10,009.497642 | 224.5764 | 0.056% | +0.095% | Passes both quote filters |
| 0.30% | 0.01 | 2.241629 | 224.1629 | 0.300% | -0.089% | Passes both quote filters |
| 0.30% | ~3,000 USD | 2,981.768795 | 222.9999 | 0.818% | -0.608% | Passes both quote filters |
| 0.30% | ~10,000 USD | 9,811.109795 | 220.1253 | 2.096% | -1.889% | Drop: 1.988% worse than the best 0.01-NVDA reference quote |

Reference interpretation: the best 0.01-NVDA quote passing the 2% Chainlink comparison, 0.05% tier at `224.5904 USDG/NVDA`. After applying both quote filters, 0.05% gives the highest output at all three requested sizes. This is a provisional read-only selection pending Chainlink heartbeat confirmation.

Execution blockers: (1) open-market heartbeat is provisional at 3,600s plus 60s; closed-sell age bounds are provisional at 72h/96h; (2) Nasdaq calendar parsing is implemented but live response/parsing has not been runtime-validated; jurisdiction and chain-liveness gates remain incomplete; (3) the plan remains read-only, and no approval, simulation, signing, or submission path exists. SwapRouter02's `exactInputSingle` takes no deadline or app-level nonce; its deadline wrapper is `multicall(uint256 deadline,bytes[])`. The user accepts wallet transaction nonce plus a 120-second deadline for the direct route, and may later provide a wrapper contract for consumed-request replay protection. A fixed unsigned call builder encodes only exact-input calldata to the verified SwapRouter02, selects a fee from the allowlist, derives `amountOutMinimum` at 99% of the fresh quote, and adds the deadline. It refuses to build if the configured open-market heartbeat freshness check fails or `oraclePaused()` is true. It is not wired to an API until the remaining plan gates are implemented.

## Uniswap quote integration groundwork — 2026-09-28

- Added a read-only `GET /api/uniswap/quotes/nvda-to-usdg?amountInRaw=...` backed by QuoterV2. Each call validates the factory mapping and pool token/fee/factory identity for the 0.01%, 0.05%, and 0.30% allowlist before quoting. The zero-liquidity 1% tier and V4 are not accepted.
- Returns output, effective price, slot0 impact, Chainlink deviation, quote completeness, and selected fee tier. Applies the 2% oracle-deviation bound using integer cross multiplication and compares each requested-size price against the best eligible 0.01 NVDA reference quote using an exact 1% bound. Freshness uses the provisional 3,600s heartbeat + 60s until a Chainlink-confirmed value is supplied, and the response labels that provisional source.
- `POST /api/plan` now uses a live Uniswap quote for oracle comparison instead of relying on 0x. A fixed unsigned SwapRouter02 exact-input call builder exists in code but is deliberately not exposed/wired until all plan gates are implemented. 0x endpoints remain diagnostic and do not bypass their access restriction.
- Added a Nasdaq official calendar reader with Eastern Time regular-session hours, published holidays and early closes. It uses a six-hour cache and fails closed if the official page is unavailable or its format/year cannot be parsed. The plan uses the 3,660s open-market age rule, 72h closed sell-only limit, or 96h limit during an identified three-day holiday weekend; closed status blocks borrow/hybrid. Runtime parsing has not yet been validated.
- Build: `npm.cmd run build` in `backend` passed after these changes. No tests were added or run. No transaction, signature, approval, or write RPC was made.

## Approved chain-liveness substitute — 2026-09-28

- The user approved an independent RPC chain-head liveness check because no sequencer uptime feed was identified. `GET /api/integrations/status` now checks two different RPC hosts, verifies both return chain ID 4663, and compares latest block timestamps. Defaults require each head to be at most 60 seconds old and timestamp skew to be at most 30 seconds. These are conservative application policy defaults, not official Robinhood guarantees.
- `POST /api/plan` blocks borrow, sell, and hybrid plans unless the check passes. The local `backend/.env` currently uses PublicNode's published Robinhood Chain endpoint (`robinhood-rpc.publicnode.com`) as primary and Robinhood's public RPC as the independent liveness host. No credentials were added or displayed. The primary and secondary endpoints were swapped after the user reported a timeout from Robinhood's public RPC during the plan preflight; the swapped configuration needs a restart and runtime recheck.
- This substitute checks recent chain-head reporting only. It is not a sequencer status oracle and cannot guarantee transaction inclusion. Read-only probes could not complete in the development environment, so both endpoints still need runtime validation after restarting the backend; the integration fails closed unless they pass.
- Build: `npm.cmd run build` in `backend` passed after implementation. No tests were added or run, and no live liveness RPC calls or write transactions were made.

### Runtime liveness evidence — 2026-09-28 11:36 UTC

The user checked `GET /api/integrations/status` after restarting the backend. It returned `available`: primary Robinhood RPC block 74766028 (age 7s), PublicNode block 74766040 (age 6s), both chain ID 4663, timestamp skew 1s. Configured policy was max block age 60s and max timestamp skew 30s. This demonstrates the RPC substitute passed at that check time; it remains a point-in-time signal, not a sequencer uptime oracle or transaction-inclusion guarantee.

### Runtime plan-preflight evidence — 2026-09-28 11:45 UTC

The user ran `POST /api/plan` for the supplied wallet with a $3,000 USDG target and `maxSellPercentage=1`. The request completed after the RPC endpoints were swapped. It returned `blocked` and `executable=false`; no transaction data was created, signed, or submitted.

- The official Nasdaq calendar parser completed successfully and classified 2026-09-28 07:45 America/New_York as closed (before the regular 09:30 open). This validates the parser against this live response; the calendar remains point-in-time and cached for six hours.
- Independent RPC liveness passed: PublicNode and Robinhood public RPC both returned chain 4663; latest block ages were 6s each and timestamp skew was 0s.
- Morpho market LLTV matched the expected 62.5%; the derived 60%-of-LLTV operational cap is 37.5%.
- Oracle freshness was within the provisional closed-market sell-only limit (72h); the underlying 3,600s heartbeat remains provisional. The quote response selected the allowlisted 0.05% Uniswap V3 tier for a diagnostic 0.01 NVDA input, output 2.270194 USDG.
- Blockers: jurisdiction policy/provider is unconfigured; market closed blocks borrow and hybrid; the wallet has zero NVDA and zero Longbow NVDA collateral, so no sell amount is available. Because the wallet's NVDA balance is zero, the 0.01 NVDA quote is a diagnostic fallback, not a quote for selling 1% or for a $3,000 swap. The sell route correctly remains unavailable.
- 0x remains blocked by its legal-restrictions response and was not used. The preflight is read-only.

## Official Stock Token eligibility and service terms review — 2026-09-28

- Robinhood RHJ's official product disclosure identifies Stock Tokens as tokenized debt securities and says they may not be offered, sold, or delivered in the United States or to/for the account or benefit of U.S. Persons. It also says additional jurisdiction restrictions apply (including Canada, the UK, and Switzerland) and that its current Prohibited Investors include investors in Cuba, Belarus, Iran, North Korea, Russia, Syria, Ukraine, South Sudan, Sudan, Myanmar, and Venezuela. Robinhood states this list can change. This is an issuer restriction relevant to the NVDA Stock Token; it does not by itself resolve whether Purview's distinct lending/collateral service is permitted in any other jurisdiction.
- Robinhood Chain Terms of Service prohibit describing or marketing Stock Tokens as "tokenized stocks" or "tokenized equities"; approved external wording is "Stock Tokens" or "tokenized real-world assets such as Stock Tokens." They also prohibit misrepresenting location or using VPNs/proxies to evade restrictions. Review user-facing copy before release; internal identifiers have not been changed.
- Robinhood says its own public RPC is rate-limited and not intended for production-grade, high-throughput or latency-sensitive use. Purview currently uses PublicNode as primary and Robinhood public RPC only as a secondary liveness source.
- Purview's Uniswap V3 path calls the on-chain Router/Quoter contracts directly; it does not currently use Uniswap Labs' hosted interface or API. That distinction does not override issuer eligibility restrictions or applicable law.
- 0x's official RWA article says Robinhood Stock Tokens require explicit RWA opt-in and geofencing where required; current requests are processed for legal-entity teams, while individual requests are paused. Purview does not route through 0x.
- Conclusion for implementation: do not unblock everyone. Keep jurisdiction blocked until the team establishes that Purview's own borrow/collateral service is authorized for a specific user cohort, and configures an eligibility process that accounts for the issuer's restrictions and any additional applicable requirements. No legal conclusion has been made about the service.

Official references: https://docs.robinhood.com/rhj/restricted-jurisdictions/ ; https://docs.robinhood.com/chain/terms-of-service/ ; https://docs.robinhood.com/chain/connecting/ ; https://help.0x.org/articles/5420296643-xstocks-support-on-0x
### 2026-09-28: Current-position risk diagnostics

- Added read-only current-position risk fields to `POST /api/plan`: collateral value in USDG raw units, accrued debt, current LTV, price-drop buffer to verified market LLTV, and comparisons against the approved operational LTV/buffer limits.
- The calculation uses the live Morpho oracle's 1e36 price and the portfolio values read at the same reported block. These are diagnostics for the existing position, not candidate-plan outcomes.
- Removed fallback to expected LLTV when on-chain market verification is unavailable or mismatched. Risk math now requires verified live parameters.
- TypeScript build passed with `npm.cmd run build`.
- Candidate planning remains incomplete. Before implementing deterministic selection, product behavior needs definition for the objective among feasible plans and what HYBRID is allowed to do. Execution-cost USDG valuation also needs an authoritative gas-price/asset-price method or full-path simulation source.
### 2026-09-28: Planner policy decisions and deterministic math

- Recorded product decisions and rationale in `DECISIONS.md`; mirrored the approved planner rules in `backend.md`.
- Added pure BigInt helpers for sale cap based on wallet plus deposited holdings, reducing sale capacity when wallet NVDA is supplied, whole-position LTV/buffer, runtime 60%-of-LLTV cap, hard-constraint filtering/ranking, safer alternative selection, separate ETH gas reporting, and gas funding eligibility. Candidate construction accepts exact quote inputs and does not estimate pool output by linear scaling.
- Added deterministic node:test coverage for SELL/BORROW/HYBRID candidate generation, hard-constraint filtering, ranking, safer alternatives, sale accounting, no double counting, full position risk, derived LTV cap, the 40% buffer, 1.5% execution-cost threshold, slippage/oracle deviation, and gas funding.
- The pure candidate engine is not yet wired into `/api/plan`; live exact-quote sizing and runtime candidate generation remain NEEDS REVIEW. There is no execute endpoint, simulation/final re-check, or receipt generation yet.
- Final verification: `npm.cmd test` passed — TypeScript build succeeded; 13 tests passed, 0 failed. Earlier runs exposed fixture/edge-case failures; they were corrected before this clean run.
- `git diff --check` completed with no whitespace errors.
- Added `findMinimumExactInputForOutput`: bracketed integer search using exact quotes, followed by an adjacent-lower-input check. It returns an explicit target-unreachable result and propagates quote errors. It must run separately per allowlisted pool; do not search across a selector whose fee-tier eligibility changes with size.
- Reverification after exact-input sizing tests: `npm.cmd test` passed — TypeScript build succeeded; 17 tests passed, 0 failed.
- Connected exact minimum-input quote search to `POST /api/plan` as `sellOnlyMinimum`. It uses the portfolio's block number, verifies each allowlisted pool at that block, searches each fee tier independently with QuoterV2, confirms the adjacent lower input misses, then reapplies the 2% Chainlink and 1% 0.01-NVDA reference filters.
- The search returns pool-level rejection/unavailable reasons and never substitutes a spot-price estimate for quote output. Quote errors fail closed. The selected amount is a sell-only diagnostic, not a selected SELL/BORROW/HYBRID plan.
- Full candidate generation/ranking remains unwired to `/api/plan`; there is no transaction simulation or execution path.
- Reverification after wiring: `npm.cmd test` passed — TypeScript build succeeded; 17 tests passed, 0 failed. The tests verify the search math and planner math using deterministic fixtures; live RPC/Quoter behavior has not been run in this environment.
- `git diff --check` completed with no whitespace errors.
- Added `GET /api/uniswap/minimum-input/nvda-to-usdg?targetUsdg=3000&maximumNvda=20` as a read-only hypothetical diagnostic. It requires no wallet or NVDA balance and explicitly returns `executable: false`, `diagnosticOnly: true`, and `walletOwnershipChecked: false`. The maximum input is only a user-supplied quote bound, never portfolio state.
- Added a deterministic Fastify validation test confirming missing quote bounds are rejected before RPC work. A separate live diagnostic request in this environment was denied outbound access (`EACCES` to robinhood-rpc.publicnode.com), so no actual quote was obtained.
- Final suite after the diagnostic route: `npm.cmd test` passed — TypeScript build succeeded; 18 tests passed, 0 failed. `git diff --check` reported no whitespace errors.

### Fresh input-size comparison - live check (2026-09-29)

Read-only GET /api/uniswap/quotes/nvda-to-usdg calls returned block 75490832 (timestamp 1790668239) on Robinhood Chain 4663. The common Chainlink answer was 230.55858116 USD/NVDA, age 821s; the 3,600s heartbeat remains provisional. Inputs were 0.01 NVDA, 13.02 NVDA (about $3,000 of NVDA input), and 43.40 NVDA (about $10,000 of NVDA input). This is separate from the minimum-input request for a 3,000 USDG output target.

| Fee tier | NVDA input | USDG output | Effective price | Impact vs slot0 | Oracle deviation | Result under temporary 2% reference tolerance |
|---:|---:|---:|---:|---:|---:|---|
| 0.01% | 0.01 | 2.071671 | 207.1671 | 0.01% | -10.15% | Reject: oracle limit; larger sizes reach price limit |
| 0.05% | 0.01 | 2.304009 | 230.4009 | 0.05% | -0.07% | Pass |
| 0.30% | 0.01 | 2.292208 | 229.2208 | 0.30% | -0.58% | Pass; about 0.51% worse than 0.05% reference |
| 0.01% | 13.02 | 82.296459 | 6.3208 | 96.95% | -97.26% | Reject: incomplete fill / price limit |
| 0.05% | 13.02 | 2,999.734127 | 230.3943 | 0.05% | -0.07% | Pass; highest output |
| 0.30% | 13.02 | 2,968.918050 | 228.0275 | 0.82% | -1.10% | Pass under 2% temporary reference tolerance; about 1.03% less output than 0.05% |
| 0.01% | 43.40 | 82.296459 | 1.8962 | 99.08% | -99.18% | Reject: incomplete fill / price limit |
| 0.05% | 43.40 | 9,998.440500 | 230.3788 | 0.06% | -0.08% | Pass; highest output |
| 0.30% | 43.40 | 9,778.517358 | 225.3115 | 2.00% | -2.28% | Reject: exceeds unchanged 2% Chainlink deviation cap |

The fresh quotes show the 0.05% tier remains best at each usable size. Widening the relative reference filter makes the 0.30% tier eligible for 0.01 and 13.02 NVDA, but it returns less USDG; at 43.40 NVDA it independently fails the hard 2% oracle-deviation limit. Quotes come from public pool state, not a Purview-specific quote account. At the same block and input, other callers query the same pools, subject to state changes and other swaps. No transaction was prepared or sent.

### 2026-09-29: Live planner candidate calculation wired

- `POST /api/plan` now builds and ranks SELL, BORROW, and HYBRID diagnostic candidates from the wallet portfolio and Morpho state, exact per-tier QuoterV2 minimum sale quotes, the live verified LLTV, and the Morpho market oracle price read at the portfolio block.
- Added a same-block Morpho `price()` read to portfolio state. Borrow liquidity is conservatively reported as market supply assets less borrow assets and accrued interest; negative results clamp to zero.
- HYBRID sizing searches each allowlisted pool using live exact-input quotes, checks the adjacent lower sale input, applies the Chainlink and temporary 2% reference filters, and calculates collateral needed under the 60%-of-LLTV cap. Closed or unverified market sessions suppress borrow-based candidate creation.
- Candidate selection follows the recorded policy: least NVDA sold, then larger liquidation buffer, then lower valued swap cost. Each candidate includes hard-constraint results and relevant global blockers. Jurisdiction remains blocked, the response remains `executable: false`, and no calldata, signing, simulation, or transaction submission was added.
- Important limits: candidate math has not yet been validated with a live `POST /api/plan` request. The quote path needs historical `eth_call` at the portfolio block; if the configured public RPC rejects it as archive state, quote sizing fails closed instead of mixing `latest` reads. HYBRID uses binary search with an adjacent-input check and assumes feasibility is monotone over the eligible quote range; validate this against live pool states before treating it as a proven global minimum.
- Follow-up clarity: when no candidate can be constructed, `planAnalysis.status` now says `no_candidates_to_evaluate` and includes explicit causes such as no wallet NVDA, no Morpho collateral, or a closed/unverified Nasdaq session. Aggregate market liquidity is labeled as distinct from this wallet’s borrowing capacity.
- Current-position risk also now uses the Morpho oracle `price()` read at the portfolio block, and stays unavailable unless both the market parameters and oracle integration are verified. This avoids combining an earlier portfolio snapshot with a separate latest oracle-price read.
- The plan's global oracle comparison now uses the approved 0.01-NVDA reference quote rather than a maximum-wallet-size quote. A large quote's price impact can no longer veto a valid smaller exact-size SELL/HYBRID quote by itself; those candidate sizes still undergo their own quote filters. A SELL-only route failure is no longer copied as a HYBRID route failure.
- Live `POST /api/plan` response supplied by the user at block `75513514`: market session reported closed, wallet had no NVDA available for sale, hybrid sizing was correctly not assessed while closed, and there were zero candidates/rejections. This demonstrates the live blocked-preflight path only; it does not validate candidate ranking for a feasible wallet. Market liquidity was `6,547,459,053` raw USDG units, which is aggregate market liquidity rather than this wallet's borrowing capacity.
- `npm.cmd run build` passed. `git diff --check` reported no whitespace errors. No tests were run in this step.

### 2026-09-29: Planner snapshot consistency review

- Reviewed the exact-input and hybrid candidate search against the deterministic planner tests; all 18 existing backend tests pass.
- Fixed pinned exact-input quote validation to read the block timestamp at the same snapshot block as the quote and Chainlink round. Previously this path used the latest block timestamp, mixing states during oracle-age validation.
- The planner remains diagnostic-only. A feasible live wallet candidate, historical quote access on the configured RPC, and the live execution path have not been validated. Hybrid binary search still relies on monotone feasibility and needs live-path validation.

### 2026-09-29: Intent route validation

- Added tests for supported intent parsing, missing-field clarification, unsupported assets, out-of-range sale limits, empty and oversized HTTP request text, and Fastify route status/body behavior.
- `npm.cmd test` passed: TypeScript build succeeded and all 26 tests passed. Intent route tests use Fastify in-process injection and do not call RPC or represent a live server deployment.
- At that point, the plan recheck route remained unimplemented because trusted storage, expiry, and confirmation binding had not been defined. It has since been implemented with a short-lived HMAC-protected stateless plan reference; see the later entry below.

### 2026-09-29: Foundry borrow-policy scaffold

- Added `contracts/foundry.toml` and a Solidity policy primitive that derives the 37.5% operational LTV cap from the expected 62.5% market LLTV and reverts if a different live LLTV is supplied.
- Added two Foundry unit tests for the expected derivation and fail-closed mismatch. User ran `forge test -vv` on Windows: Solc 0.8.24 compiled 2 files; Forge 1.8.3 reported 2 passed, 0 failed, 0 skipped.
- This is not a borrow router and has no token, Morpho, Uniswap, RPC, wallet, or execution behavior. No external data is embedded as test fixture truth beyond the approved LLTV policy input.
- Before deploying borrow execution, implement the trusted backend signer that attests to all offchain gates. The Nasdaq calendar is read offchain; a caller-supplied open/closed flag would not be trustworthy. Also verify Foundry compilation/tests and exact deployed Morpho authorization behavior.

### 2026-09-29: Fixed-call hybrid router prototype

- Added `contracts/src/PurviewRouter.sol`: an NVDA-to-USDG exact-input Uniswap V3 swap, optional NVDA collateral supply, and Morpho borrow to the calling wallet in one reverting transaction. Fee tiers are restricted to the three configured pool addresses; recipients, target contracts, and calldata are not caller-selectable. A later uncompiled edit adds collateral-supply-only HYBRID with no swap; see the later status entry.
- The router checks the chain ID, live market token pair and expected LLTV, user Morpho authorization, deadline (maximum 120 seconds), the provisional Chainlink age bound (maximum 3,660 seconds), `oraclePaused()`, 2% Chainlink/Morpho-oracle deviation, minimum swap output, max sell/borrow values, post-borrow 60%-of-LLTV risk, and a single-use signature over the exact plan.
- Added mock-based Foundry tests for combined success, replay, sell cap, swap minimum output, borrow failure atomicity, stale oracle, operational-LTV failure, maximum borrow, Morpho authorization, unallowlisted fee, and paused oracle. User ran Forge 1.8.3 / Solc 0.8.24 after adding the public `executionDigest`: all 10 router tests and 2 policy tests passed. Tests use local mocks only, not deployed contracts.
- The backend execution signer is not implemented/configured. It must attest to all offchain gates, including the approved market session and jurisdiction, before a router call is valid. Router deployment and execution remain blocked. The deployment configuration, OpenZeppelin safe-token dependency, real ABI behavior, testnet support, and independent security review remain unverified.

### 2026-09-29: Backend execution-digest signing helper

- Added `backend/src/executionSigner.ts`. It accepts a 32-byte router digest, requires `PURVIEW_EXECUTION_SIGNER_PRIVATE_KEY`, derives the signing account, checks it matches the expected signer address, and signs using the EIP-191 message format used by the router.
- Added four tests for valid signature verification, missing key, signer mismatch, and malformed digest/key. `npm.cmd test` passed: TypeScript build succeeded and all 30 tests passed.
- Added only a blank key name to `backend/.env.example`; the ignored `backend/.env` was not changed. No secret was created or requested. The helper is not exposed over HTTP and does not assess plans, query the router, or enforce session/jurisdiction/simulation gates. It must remain unwired until a verified execution path exists.

### 2026-09-29: SELL / BORROW / HYBRID router paths

- Added fixed-call `executeSell` and `executeBorrow` entry points alongside `executeHybrid`. All three bind their action and exact inputs to a distinct single-use backend authorization; no caller-selected targets or arbitrary calldata were added.
- Applied the provisional oracle-age policy by action: BORROW/HYBRID are limited to 3,660 seconds; SELL accepts 3,660 seconds, 72 hours, or 96 hours, with the longer values intended only when the trusted signer has verified the closed-market session and any three-day holiday weekend. The contract checks price, round validity, `oraclePaused()`, and 2% deviation for each action.
- User requested to defer tests. These edits have not been compiled or tested. The backend signer still does not validate session or plan safety and is not wired to the planner, so execution remains disabled. No deployment or live contract check was performed.
- After those edits, the user reran the existing suite: Solc 0.8.24 compiled the router and 12 prior unit tests passed. Those tests still exercise the HYBRID mock path and LLTV policy; they do not exercise the new standalone SELL/BORROW methods or deployed contracts.
- Added `contracts/test/PurviewRouterFork.t.sol` for read-only fork checks of the live market parameters, token decimals, Chainlink round, `oraclePaused()` call behavior, allowlisted 0.05% pool, and a QuoterV2 response. The test is skipped on non-fork runs and uses no private key, wallet funds, or broadcast transaction.
- User ran the fork-only suite against `https://rpc.mainnet.chain.robinhood.com`: all 3 passed. This establishes current read/ABI compatibility for the configured market, tokens, feed, factory pool, and QuoterV2, plus successful local-fork router construction. It does not execute SELL/BORROW/HYBRID routes, test token transfer permissions, prove session/jurisdiction signing, or broadcast any transaction.
- Expanded that fork suite with local-fork SELL, BORROW, and HYBRID call simulations against the live token, SwapRouter02, and Morpho contracts. User ran `forge test --fork-url https://rpc.mainnet.chain.robinhood.com --match-path test/PurviewRouterFork.t.sol -vv`: all 6 fork tests passed, including all 3 simulated execution paths. The test harness injects NVDA into its own ephemeral test account and grants Morpho authorization only on the local fork; this uses no real wallet or funds and is not proof of ordinary user/token eligibility or production signer gating. No transaction was broadcast.

### 2026-09-29: Expiring plan recheck reference

- Added an HMAC-protected, 120-second `planReference` that binds the wallet, structured intent, and selected candidate fingerprint. It requires `PURVIEW_PLAN_REFERENCE_SECRET` (at least 32 random bytes); without it the plan remains available but the recheck reference is reported unavailable.
- Added `POST /api/plan/recheck`, which requires explicit `confirmed: true`, verifies the signed reference, reruns the live planner, and rejects a changed candidate as stale. It is read-only and always reports `executable: false`; it does not sign or submit a transaction. Jurisdiction and other execution gates remain in force.
- `npm.cmd run build` passed after implementation. No tests were added or run in this step. The execution signer remains disconnected until its authorization is derived only from a freshly rechecked plan after every required gate passes.

### 2026-09-29: Read-only router deployment readiness

- Added `GET /api/execution/readiness` to check whether `PURVIEW_ROUTER_ADDRESS` is configured, has bytecode on Robinhood Chain (4663), and exposes an `executionSigner` that matches the optional locally configured signer key. It reports public signer addresses only; it never returns a private key, signs, or sends a transaction.
- Added `PURVIEW_ROUTER_ADDRESS` to `backend/.env.example` and documented the diagnostic. Jurisdiction remains explicitly blocked and `executable` is always false; this endpoint is a deployment diagnostic, not an execution unlock.
- Updated the contracts README to reflect the current signer helper and the user's successful six-test fork run, including the local-fork NVDA and Morpho-authorization limitations.
- `npm.cmd run build` passed. No tests were run. No router address/key was added, no RPC readiness request was made, and no transaction was broadcast.

### 2026-09-29: Router deployment preparation

- Added `contracts/DEPLOYMENT.md` with the current constructor parameters, their recorded evidence/status, and pre-deployment gates. The current signer address is explicitly unresolved; the 96-hour max age is documented as provisional constructor policy, not a Chainlink-published feed parameter.
- The document is preparation only. It does not add a broadcast script, ask for a private key, or imply deployment approval. It requires live address/market rechecks and independent review; jurisdiction remains blocked by the user's prior policy.
- Linked the manifest from `contracts/README.md` and noted it in `backend.md`. No tests or on-chain calls were run. No private key or transaction was used.

### 2026-09-29: Official Stock Token registry gate

- Added a read-only integration for Robinhood's official `/rhj/assets` endpoint. It verifies the active NVDA registry entry and chain-4663 contract address against configured NVDA, returns the live session-capability fields, and reports that the origin response has no timestamp.
- Added the canonical-asset check to planner blockers. BORROW uses the active canonical-token identity check and is not gated by swap-session capability. For SELL/HYBRID, the per-session map passes only when whole and fractional NVDA are `TRADING_STATUS_TRADABLE` in market, extended, and overnight sessions. Requiring all sessions avoids guessing the active off-hours session and blocks on missing/restricted values.
- Official docs also describe a different capability schema. The parser recognizes it but does not infer session permissions from it; that schema remains blocked until its exact session meaning is verified. Unknown/missing capability data fails closed.
- `npm.cmd run build` passed. Tests were not run. No private key, wallet funds, or transaction was used.
- User's integration-status response at `2026-09-29T20:30:49Z` reported an active canonical NVDA registry entry at the expected address, with `TRADING_STATUS_TRADABLE` for whole and fractional amounts in market, extended, and overnight sessions. The response predates the new all-session evaluator; after restarting the backend, the same endpoint should include `sellCapability.status: available` for these reported values.
- The same response showed a valid Chainlink round with age `9,243` seconds, beyond the provisional open-session limit of `3,660` seconds. The integration-status endpoint alone does not determine Nasdaq session status; the planner applies its closed-market SELL policy only when its independent calendar confirms the market is closed. 0x remains blocked; Uniswap remains the configured swap venue.
- User reran the live integration-status endpoint at `2026-09-29T20:36:08Z`; it now reports `sellCapability.status: available` for the six `TRADING_STATUS_TRADABLE` values. Chainlink age was `9,561` seconds, still stale under the open-market limit but below the provisional 72-hour closed-market SELL cap. This endpoint does not include the Nasdaq calendar decision, wallet balance, plan candidate, jurisdiction, or router deployment status.

### 2026-09-29: Preserve quote route provenance in planner candidates

- The selected candidate previously retained swap amounts and costs but discarded the quoted Uniswap pool and fee tier. Added `swapPool`, `swapFeeTier`, and `swapQuotedOutUsdgRaw` to candidate data and serialize the exact values in plan responses. Live SELL and HYBRID quote conversion now carries those fields from the corresponding allowlisted-pool quote; BORROW and zero-sale HYBRID candidates report no swap route.
- This closes a data handoff gap needed before a deterministic router-call builder can be prepared. It does not create calldata, calculate a transaction minimum, sign, simulate, or submit a transaction. Candidate output remains diagnostic and non-executable while jurisdiction, deployment, and other execution gates remain unresolved.
- `npm.cmd run build` passed. Tests were not run. No transaction or live execution request was made.

### 2026-09-29: Fixed router call parameter template

- Added a strict parameter builder for the router's fixed SELL, BORROW, and HYBRID entry points. It accepts only a selected candidate whose deterministic constraints all pass, validates fee tier and pool address together against the configured Uniswap allowlist, and uses a 90-second deadline based on a fresh latest-block timestamp.
- Swap minimum output now preserves the requested USDG target after the planned borrow while also respecting the maximum 1% slippage floor. BORROW caps its amount at the selected amount; SELL/HYBRID cap sale input at the exact selected amount. The `/api/plan/recheck` response can show these fixed method arguments only after its HMAC reference matches a fresh plan.
- The result is explicitly `template_only`: no calldata or signature is created, jurisdiction remains blocked, and no transaction can be submitted. At this entry, a zero-sale HYBRID candidate could not be represented by the Solidity router; the follow-up entry below records the implementation of that missing fixed path.
- `npm.cmd run build` passed. Tests were not run. No live recheck, wallet signing, or transaction was performed.

### 2026-09-29: Collateral-supply-only HYBRID path

- Extended `executeHybrid` to support a zero-swap operation only when `amountIn`, `maxSellAmount`, `minOutput`, and `fee` are all zero and a positive amount of new collateral and borrow are supplied. The same deadline, one-time backend authorization, Morpho permission, oracle checks, and operational LTV enforcement still apply; callers cannot select any target or arbitrary call data.
- Updated the backend call-template builder to prepare those exact zero-swap arguments only for a matching HYBRID candidate. It rejects inconsistent route metadata and does not map the request to BORROW.
- `npm.cmd run build` passed. Foundry compilation could not be completed in this environment: Forge 1.8.3 panicked while detecting the process user's home directory (`could not detect user home directory`). No tests were added or run. The Solidity edit therefore remains uncompiled and unverified; the user should compile and run the existing local router tests before considering it sound. No transaction was broadcast.
- The user's subsequent Forge output showed lint warnings at the external protocol calls and no pasted compiler error/exit code. All three state-changing entry points carry the custom `nonReentrant` modifier, which sets `_entered = 2` before the function body; this should prevent reentry into those routes, but the warning has not been cleared by a dedicated test or security review. Swapped the LTV fixed-point multiplications to OpenZeppelin `Math.mulDiv` to avoid intermediate `uint256` overflow; this latest Solidity edit also remains uncompiled until Forge is rerun.
- Replaced the handwritten reentrancy modifier with OpenZeppelin Contracts 5.x `ReentrancyGuard`, inherited by the router; all three state-changing entry points still use `nonReentrant`. This addresses the source guard implementation with the maintained library primitive. It does not prove that the static-analysis warning disappears or replace malicious-callback testing and review. The change is not yet compiled or tested.

### 2026-09-29: Router lint annotations and atomicity test coverage

- Added local Foundry lint suppressions for the approved timestamp and positive Chainlink-answer checks, each with a nearby rationale. Added comments for intentionally discarded Uniswap `multicall` results (the router checks the USDG balance delta), Morpho borrow shares, Chainlink `startedAt`, and unused Morpho market tuple fields. The answer positivity guard occurs before its uint cast.
- Confirmed swap output validation in `executeHybrid` at lines 223-224 and `executeSell` at lines 292-293: each computes actual USDG received from the router's before/after balance and reverts if it is below `minOutput`.
- All three execution entry points (`executeHybrid`, `executeSell`, `executeBorrow`) inherit OpenZeppelin `nonReentrant`. Added an explicit mocked swap-failure atomicity test to complement the existing success, borrow-failure, and hard-constraint cases required by backend.md §16.
- Attempted `forge test -vv`; the local Foundry process in this environment panicked with `could not detect user home directory`, including when `HOME` and `USERPROFILE` were set. The test suite and lint suppressions therefore remain unverified here; run them from the user's local Foundry installation before treating this entry as passed.
- Follow-up evidence supplied by the user: `forge build` compiled successfully, then `forge test --match-path test/PurviewRouter.t.sol -vv` passed all 11 tests, including `testSwapFailureRevertsWholeRoute` (0 failures). The pasted build output still contains block-timestamp warnings at earlier source line numbers (183/184/367/369/449/450) and the earlier unsafe cast/unused-return locations. Those locations do not match the current annotated source layout, so suppression status must be confirmed by rebuilding the current saved `PurviewRouter.sol`. The `reentrancy-events` warning also remains in the pasted output; guarded entry points are present, but the warning itself has not been suppressed.
- After the user's subsequent build showed no timestamp warnings but retained `reentrancy-events` and `unused-return`, added narrowly scoped Foundry suppression directives beside those cases with reasons: ignored Uniswap return arrays are replaced by USDG balance-delta checks, unused Morpho shares/market fields do not feed router policy, Chainlink `startedAt` is not its freshness timestamp, and the post-success event is protected by all execution routes' OpenZeppelin reentrancy guard. These comment-only changes do not alter runtime behavior and still need a fresh user-side `forge build` to confirm the lint directives are accepted.
- The user's next build confirmed every prior lint warning was cleared except `unused-return` on the second line of the Chainlink tuple assignment. Moved that directive to immediately precede the exact diagnosed call line; no behavior changed. Awaiting a fresh build confirmation.
- The user then supplied two consecutive build outputs: the first retained that Chainlink warning; the second compiled one Solidity file successfully with no warnings. Together with the earlier user-reported 11/11 router unit tests, local mock atomicity coverage is demonstrated for the current functional code. Lint-only comment changes followed those tests and do not alter behavior.
- The user's latest mainnet-fork trace for BORROW showed Chainlink answer `22817673628`, complete round `1134`, and `updatedAt=1790704599`. The test deadline was `1790719688` and is set to `block.timestamp + 60`, so the fork block timestamp was `1790719628`; feed age was therefore `15,029` seconds (~4h10m), exceeding BORROW/HYBRID's 3,660-second cap. `_checkOracle` reverted before reaching the token pause check. This is expected fail-closed behavior; the fork execution tests are time-sensitive and cannot assert successful borrow/hybrid when the feed is stale. No limit was loosened and no transaction was broadcast.
- Updated the fork BORROW and HYBRID test cases to be state-aware: they assert the exact `OracleUnsafe()` revert when the live feed is stale/paused, and exercise the live borrow route only when the shared freshness preconditions pass. This preserves a genuine success test for fresh snapshots while verifying the current stale snapshot fails closed. The changed fork tests have not yet been compiled or run by the user.
- After the user reported all six combined tests passing, noted that a passing combined test did not reveal whether BORROW/HYBRID succeeded or followed the expected stale-revert branch. Reworked the fork suite for explicit evidence: successful BORROW/HYBRID tests are skipped when the feed is unsafe; separate tests advance only the local fork timestamp and assert exact stale-oracle reverts. This makes test output distinguish unavailable fresh-feed execution from verified fail-closed behavior. The new fork tests require a fresh user-side run.
- User ran the revised fork suite: compilation succeeded; 6 passed, 0 failed, 2 skipped. Both forced stale-oracle rejection checks passed; successful BORROW and HYBRID execution tests were skipped because the live feed was outside the 3,660-second limit. SELL still executed successfully on the local fork with the test harness's injected NVDA. No real transaction was broadcast. This does not count as a successful live-fork borrow or hybrid execution.
- User ran the complete non-fork Foundry suite: `PurviewBorrowPolicyTest` 2/2 passed and `PurviewRouterTest` 11/11 passed. `PurviewRouterForkTest` was skipped by setup as expected without `--fork-url`. Together with the separately run fork suite above, the local contract unit tests pass and the live-fork stale-oracle behavior is verified; successful live-fork BORROW/HYBRID remain unverified until a fresh feed snapshot.

### 2026-09-29: Distinguish Robinhood extended and overnight sessions

- The planner classified every time outside Nasdaq regular hours (9:30 a.m.–4:00 p.m. ET) as closed. The status response at 20:36 UTC on 2026-09-29 corresponds to 4:36 p.m. Eastern, so a weekday after-hours request was mislabeled as a fully closed market. Robinhood's official session guidance includes pre-market, extended, and overnight trading for eligible assets; the NVDA registry response reported all three capabilities as tradable.
- Updated the session evaluator to combine Nasdaq's holiday/early-close calendar with Robinhood's published 24/5 session windows. Active pre-market, regular, extended, and overnight periods now count as open for planner policy; weekend/holiday closure remains closed. Active-session oracle freshness still applies, so this change does not permit stale-price borrowing or hybrid plans.
- `npm.cmd run build` passed. Tests were not run. The live plan endpoint was not re-queried after this change; the observed Chainlink age was still 9,561 seconds at the last status sample, above the provisional active-session limit of 3,660 seconds.

### 2026-09-29: Independent router security review preparation

- Added [`contracts/SECURITY_REVIEW.md`](contracts/SECURITY_REVIEW.md), a pre-review packet describing intended router invariants, evidence actually reported, unresolved security questions, and deployment blockers. It explicitly is not an audit or deployment approval.
- Recorded the latest evidence accurately: 11 local router tests and 2 borrow-policy tests passed; latest fork run had 6 passes and 2 fresh BORROW/HYBRID success tests skipped because the live oracle was stale. No production transaction was sent.
- Flagged unresolved feed-decimal validation, provisional oracle-age policy, off-chain signer/session/jurisdiction boundary, immutable constructor configuration, and missing gated backend signing flow for independent review.
- Documentation-only change. No tests, on-chain calls, signing, or deployment were performed.

### 2026-09-30: Persistent local fork deployment and read-only router simulation

- Started Anvil 1.8.3 as a hidden long-running process on `127.0.0.1:8545`, forking Robinhood Chain mainnet state and setting local chain ID 4663. The node writes periodic state snapshots under the system temp directory; it is not a public-chain deployment.
- Deployed the current `PurviewRouter` artifact to the local fork at `0x9a9edea6c804f40d81b1dc4ae551affbad2ec5bb` (local tx `0x97a4fd86218ec20f1563204346a6e1f2a081bd8abc65d794e00551135e981926`, block 76801983). The artifact's Solidity source metadata hash matched the current `PurviewRouter.sol`; runtime code is present at the local address.
- Impersonated the supplied wallet only in Anvil, funded it with local ETH for gas, and called Morpho `setAuthorization(router, true)`. Local tx `0x9383a9084a536e4d7a2892c392431b8bdc028910177fed88fa99eb151fd01540` succeeded at block 76801984; `isAuthorized(wallet, router)` returned true. No transaction was broadcast to mainnet.
- Updated ignored `backend/.env` to use the local Anvil RPC and router address, retain the independent public RPC for liveness, and configure Anvil account #1 as the local-only execution signer. `GET /api/execution/readiness` reported chain 4663, deployed bytecode, and signer match; it correctly remains blocked by jurisdiction and never claims executable.
- Added a local-only recheck simulation path. It is enabled only by an explicit flag and loopback RPC; it obtains the router digest, signs only for the read-only call, encodes one of the fixed router methods, and runs `eth_call` at the unchanged local head. It returns only call status/results, not calldata/signature, and submits no transaction. Corrected the signer helper to raw-sign the already EIP-191-prefixed router digest; the old `signMessage` behavior would have applied the prefix twice and failed router recovery.
- `npm.cmd run build` passed. Tests were not run. A diagnostic direct `eth_call` reached the deployed SELL method and reverted with `ERC20InsufficientAllowance` for the new router (0 allowance; 0.01 NVDA requested). The supplied wallet has no current eligible plan, so this is not a successful planner-derived simulation. The initial fork returned an upstream historical-state error and was replaced by a fresh fork; the refreshed fork exposed the same provider limitation on different uncached storage slots.
- Follow-up: the backend `/api/portfolio` request against the refreshed fork returned 503 because the upstream RPC could not provide an unqueried Morpho/NVDA storage proof at the fork state root; even a latest-tag probe for that slot failed. The persistent fork itself, router code, and authorization remain available. Full planner-derived recheck simulation needs an archive-capable Robinhood Chain fork RPC; the backend continues to fail closed until configured.
- Deployment/review blockers were re-scoped: dedicated production signer and independent security review remain blockers for a public mainnet deployment only. For this isolated local fork, a disposable known Anvil signer is used and no independent review is required to continue local eth_call experiments. Jurisdiction remains blocked for any real execution; no public-chain router or authorization exists.

### 2026-10-01: Pin recheck simulation to the plan snapshot

- Changed `POST /api/plan/recheck` to build the router call template and deadline from the exact block recorded in the freshly recomputed plan snapshot. It no longer derives them from a separately sampled latest block; missing or malformed snapshot evidence leaves the template unavailable.
- Pinned local simulation reads (router bytecode, immutable signer, execution digest, and router `eth_call`) to that same block. It still verifies the local fork head has not moved around the call and returns no transaction signature or calldata.
- `npm.cmd run build` passed. Tests were not run. This closes a state-mixing gap but does not resolve the fork RPC's historical-proof limitation, provide a feasible candidate, unblock jurisdiction, or add transaction submission/receipt verification.

### 2026-10-01: Fresh fork diagnosis and deployment blocker

- Preserved the existing local fork at `127.0.0.1:8545` and its deployed router. Started a separate disposable fork at port `8546` from the public Robinhood RPC at block `77450571` (chain ID 4663). On that fresh fork, pinned Morpho market reads and `/api/portfolio`-equivalent reads succeeded, confirming the old 8545 fork snapshot was the source of the original historical-state error.
- Attempted a router deployment only on the new local fork. The deployment transaction was never mined; Anvil could not mine because its upstream RPC lacked a historical state proof for an account needed while constructing the block. Dropped the pending local transaction, confirmed the pool was empty, and stopped the disposable 8546 fork. No public transaction was sent and no files in the existing 8545 fork were changed.
- The running backend on port 3001 is stale relative to source: `/api/health` responds, but the newly added `/api/runtime` route returns 404. It was not restarted because there is not yet a router deployment on the fresh fork to configure it against.
- To complete the fresh-fork deployment, provide a Robinhood Chain 4663 archive-capable RPC endpoint in the ignored local environment, then restart Anvil at a recent block, deploy and authorize locally, update the local backend RPC/router settings, and restart the backend. Current required evidence is still missing; do not report deployment or end-to-end simulation as complete.

### 2026-10-02: Archive RPC, fresh local router deployment, and backend restart

- Configured the user's Alchemy Robinhood Chain endpoint in ignored `backend/.env` as `ANVIL_FORK_SOURCE_RPC_URL`. Verified chain ID 4663 and successfully read the Morpho market at a recent historical block (latest 78520210, read block 78520178). The endpoint key was shared in chat; rotate it in Alchemy after this session and replace the ignored local value.
- Kept the existing Anvil fork on `127.0.0.1:8545` untouched. Started a separate fork on `127.0.0.1:8546` from the archive endpoint at block 78521493.
- Deployed `PurviewRouter` locally at `0x19cc4dd8d86fc525f8cf37c51612de91b1e52038`. Local deployment tx `0x25ad48e5c51b10b225ac8a6883ff7d4d689238515ae535a7dccb12b4fd7f945f`, block 78521494, receipt status 1, runtime code 12,941 bytes.
- Impersonated the supplied wallet only inside Anvil and called Morpho `setAuthorization(router, true)`. Local tx `0x62e6a10e52e9798e98174e2994f045193acb38e1d8319ea05a3bdea912264f34`, block 78521495, receipt status 1. `isAuthorized(wallet, router)` returned true. This is local fork state, not a public transaction.
- Updated only ignored local backend settings to RPC `http://127.0.0.1:8546`, the new router address, and local-fork simulation enabled. Restarted backend on port 3001. `/api/runtime` reports `local-fork`; `/api/execution/readiness` verifies chain 4663, router bytecode, and signer match. It remains `executable: false` because jurisdiction is blocked.
- Verified `/api/portfolio` succeeds at block 78521495 and returns actual zero NVDA and zero USDG balances for the supplied wallet. A real `POST /api/plan` for USDG 3,000 with max NVDA sale 20% returned `no_candidates_to_evaluate`: no wallet NVDA, no NVDA collateral, and active session status unknown. Therefore no planner-selected route exists to simulate, and no successful planner-derived router simulation or actual execution is claimed.
- `npm.cmd test` passed after the backend restart (32/32). Backend execution submission and receipt verification endpoints remain unimplemented; frontend/model work remains out of scope until backend is complete.
- Restarted the backend with outbound access for configured read-only integrations. Nasdaq session lookup now reports the current Robinhood extended session as open; independent RPC liveness initially failed because the fork head was idle. Enabled Anvil one-second interval mining on port 8546, after which liveness passed (local head age 3s, remote head age 10s, timestamp skew 7s at 2026-10-02 20:51 UTC). This only advances local empty blocks; it does not update forked oracle state.
- Rechecked the plan after session/liveness recovery. It remains `no_candidates_to_evaluate`, blocked by jurisdiction, provisional oracle age 13,448s versus 3,660s allowed, zero wallet NVDA/collateral, and no permitted sale amount. No plan recheck simulation was possible because no candidate exists.

### 2026-10-02: Live plan recheck after backend handoff

- Re-ran `POST /api/plan` against the running local-fork backend for the supplied wallet and the actual USDG 3,000 / max NVDA sale 20% request. This was a live request; no balances, prices, quotes, or plan candidates were injected.
- Confirmed current session is Robinhood extended and the official Robinhood asset registry reports NVDA tradable in market, extended, and overnight sessions. Uniswap returned a live quote, but the wallet has no NVDA available to size a sale.
- The plan remains blocked with four material blockers: `JURISDICTION_UNVERIFIED`; `ORACLE_FRESHNESS_UNVERIFIED` (round age 14,036s versus the provisional 3,660s active-session bound); `NO_NVDA_COLLATERAL` (zero wallet NVDA and zero Longbow NVDA collateral); and `SELL_ROUTE_UNAVAILABLE` (no wallet NVDA to quote). No candidate or plan reference was issued; therefore recheck simulation, execution, and receipt verification cannot honestly be demonstrated yet.
- No backend code or local-chain state was changed for this check. Execution submission and receipt verification remain unimplemented. The next valid path to a planner-derived simulation needs a usable wallet position, an oracle round within the approved freshness bound, and approved jurisdiction access. Do not weaken these gates or substitute local test balances as evidence for the user's real wallet.
