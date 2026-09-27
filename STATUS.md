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
- [~] "POST /api/intent" — conservative documented-format parser implemented; runtime behavior not yet verified
- [~] "POST /api/plan" — read-only preflight implemented; live response not yet verified; no numerical plan or execution
- [ ] "/api/plan/:id/recheck"
- [ ] "/api/execute"
- [ ] "/api/execution/:id"

---

4. Intent Parser

- [~] Natural-language request accepted for the documented USDG/NVDA pattern; runtime not yet verified
- [~] Target asset parsed for USDG; runtime not yet verified
- [~] Target amount parsed; runtime not yet verified
- [~] Restricted asset parsed for NVDA; runtime not yet verified
- [~] Maximum sell percentage parsed; runtime not yet verified
- [~] Missing constraint returns a clarification; runtime not yet verified
- [ ] Clarification returned
- [ ] Parser cannot directly execute transactions
- [ ] Parser cannot override constraints
- [ ] Invalid parser output rejected

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

- [ ] Sell candidate
- [ ] Borrow candidate
- [ ] Hybrid candidate
- [ ] Amount sold calculated
- [ ] Sell percentage calculated
- [ ] Borrow amount calculated
- [ ] Resulting LTV calculated
- [ ] Liquidation buffer calculated
- [ ] Expected USDG calculated
- [ ] Fees calculated
- [ ] Price impact calculated
- [ ] Remaining exposure calculated
- [ ] Execution cost calculated

---

10. Hard Constraints

- [ ] Maximum sell constraint
- [ ] Minimum USDG output
- [ ] Maximum LTV
- [ ] Minimum liquidation buffer
- [ ] Maximum slippage
- [ ] Maximum execution cost

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

- [ ] Contract implemented
- [ ] Foundry project configured
- [ ] OpenZeppelin dependencies verified
- [ ] Router deployed locally
- [ ] Router deployed to testnet

Authorization

- [ ] Caller authorization implemented
- [ ] Recipient restrictions implemented
- [ ] Target restrictions implemented
- [ ] No unrestricted arbitrary execution
- [ ] No unnecessary unrestricted delegatecall

Parameters

- [ ] "maxSellAmount"
- [ ] "minOutputAmount"
- [ ] "maxBorrowAmount"
- [ ] "authorizedRecipient"

---

13. Router Security Tests

- [ ] Valid swap succeeds
- [ ] Valid borrow succeeds
- [ ] Valid combined operation succeeds
- [ ] Swap failure reverts
- [ ] Borrow failure reverts
- [ ] Maximum sell violation reverts
- [ ] Minimum output violation reverts
- [ ] Maximum borrow violation reverts
- [ ] Unauthorized recipient rejected
- [ ] Unauthorized target rejected
- [ ] Relevant malformed parameters rejected

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

Test:
Transaction:
Result:
Date:

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
Status: [?] The Longbow NVDA/USDG market is identified and its on-chain LLTV is 62.5%. That is the liquidation threshold, not the product's safe operating maxLtv. No operational maxLtv or minimum liquidation-buffer policy has been established.
Impact: Borrow planning and execution must remain blocked until explicit policy thresholds are defined; no placeholder or inferred buffer may be used.
Next action: Establish the operational maxLtv below 62.5% and the minimum liquidation buffer, with documented definitions and units. Then implement those policy checks.
Owner: Sadiq / implementation agent

Blocker: Chainlink feed freshness policy
Status: [?] The market oracle resolves to feed 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15 (RHNVDA / USD, 8 decimals). At the 2026-09-27 21:19 UTC check its latest round was 177802 seconds old. Longbow's official docs describe 24/5 feeds and last-price behavior when US markets are closed, but no execution max-age threshold or weekend rule was found.
Impact: The feed's current round cannot be declared fresh, so the oracle safety gate must block planning/execution.
Next action: Verify the feed-specific heartbeat/max-age and market-closure handling from Longbow/Chainlink official sources or set an explicit, reviewed product policy; then enforce it on every plan and final recheck.
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
