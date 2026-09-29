# Purview router pre-review packet

**Status: prepared for independent review. This is not an audit, a security certification, or approval to deploy.**

## Review target and scope

- Solidity target: `contracts/src/PurviewRouter.sol` and `contracts/src/PurviewBorrowPolicy.sol`.
- Intended network: Robinhood Chain, chain ID `4663`.
- Intended route types: fixed-path NVDA-to-USDG SELL; Morpho USDG BORROW against NVDA collateral; and HYBRID swap/supply/borrow.
- The router has not been deployed. No router address or execution signer has been configured. No live transaction has been broadcast.
- Review the router, its dependencies/interfaces, deployment configuration, authorization design, oracle assumptions, and the backend signer boundary. The backend signer is not yet connected to a complete gated execution flow.

## Intended security properties

1. **Fixed destinations and calls.** Token, Morpho, factory, feed, and SwapRouter02 addresses are immutable constructor inputs. Swap calls use a fixed `exactInputSingle` path and allowlisted V3 fee tiers/pools; callers cannot supply arbitrary targets or calldata.
2. **Wallet-bound authorization.** Each action's authorization hash includes the action and parameters, user, chain ID, router address, oracle age where applicable, and deadline. The EIP-191 signature must recover to the immutable execution signer. Low-`s` and 65-byte signature checks are applied. A successful authorization hash is single-use. Reverts roll back the consumed marker with the rest of the transaction.
3. **Bounded execution.** SELL enforces `amountIn <= maxSellAmount`, a nonzero minimum output, an allowlisted fee/pool, and a deadline capped to 120 seconds. BORROW/HYBRID enforce a signed maximum borrow amount. The recipient and Morpho position owner are `msg.sender`.
4. **Swap output check.** SELL and HYBRID measure the router's USDG balance before and after the swap, then revert if the actual delta is below `minOutput`. They also pass that minimum to SwapRouter02.
5. **Borrow risk gate.** BORROW/HYBRID require Morpho authorization, validate the live market token pair and 62.5% LLTV, use a 3,660-second oracle age, reject invalid/nonpositive/future/stale rounds and `oraclePaused()`, compare Morpho's oracle price to Chainlink within 2%, and enforce an operational LLTV of 60% of the market LLTV (37.5% for the expected 62.5% market).
6. **SELL freshness options.** SELL accepts 3,660 seconds, 72 hours, or 96 hours, provided the selected value is no greater than the immutable constructor maximum. The 72/96-hour limits are provisional application policy, not verified Chainlink heartbeat values. Session and holiday eligibility are off-chain responsibilities of the signer and are not independently checked by this contract.
7. **Atomic route and reentrancy guard.** State-changing entry points use OpenZeppelin `ReentrancyGuard`. A failure in an external swap, collateral supply, borrow, output check, oracle check, or LTV check reverts the entire transaction.

## Evidence available

Evidence below is user-reported command output; the current agent did not rerun Forge in this Windows environment.

- User reported `forge build` succeeded with no warnings after the final lint annotations.
- User reported the local Foundry suite passed: 11/11 `PurviewRouterTest` tests and 2/2 `PurviewBorrowPolicyTest` tests. These use local mocks and establish only the behaviors covered by those tests.
- User reported Robinhood Chain fork tests passed for live market/token/feed/pool constructor checks and SELL execution in a local fork. The test harness injects NVDA and does not broadcast a transaction.
- In the latest state-aware fork run, 6 tests passed and 2 successful-route tests were skipped because the live oracle was stale. The explicit stale BORROW/HYBRID rejection tests passed. Therefore fresh-feed live-fork BORROW/HYBRID success is **not currently demonstrated**.
- Earlier fork test output showed live Morpho and SwapRouter02 routes succeeding under a test harness with injected NVDA and local Morpho authorization. This is historical point-in-time fork evidence, not proof of a fresh current feed, ordinary wallet permissions, backend signing, deployment, or production execution.

## Open review findings and decisions

The reviewer should independently validate these before deployment; none is waived by passing tests.

1. **Chainlink decimal configuration:** `_checkOracle` reads `chainlinkFeed.decimals()` dynamically and uses it in scaling, but the constructor does not pin or validate the expected feed decimals. Confirm the deployed proxy's decimals and decide whether deployment should reject any unexpected value. Verify the scaling against the Morpho oracle's exact units.
2. **Heartbeat and stale-age policy:** the feed's numeric heartbeat has not been verified from a Robinhood Chain-specific official source. The active-session 3,660-second and closed-market 72/96-hour values are product policy/provisional settings, not feed guarantees. Confirm the policy and validate safe failure behavior around sessions, weekends, holidays, and feed pauses.
3. **Off-chain trust boundary:** the contract does not know Nasdaq/Robinhood session state, jurisdiction eligibility, or whether the plan was freshly recalculated. A signer can authorize SELL with a longer age; BORROW/HYBRID remain bounded by 3,660 seconds on-chain. Review the signer service, deployment operations, key custody, monitoring, revocation/incident response, and confirm that no signing path can bypass the jurisdiction block or other planner gates.
4. **Immutable signer/configuration:** signer and integrations are immutable. A mistaken address, compromised signer, policy change, or dependency change requires a replacement deployment and migration plan. Confirm every constructor value against authoritative on-chain sources immediately before deployment.
5. **Authorization and replay semantics:** inspect the digest and personal-sign implementation for cross-action/cross-chain/cross-deployment separation, signature malleability edge cases, expiry, and intended one-use behavior. Confirm the user separately grants Morpho authorization for borrow routes.
6. **Token and protocol behavior:** verify NVDA/USDG token transfer behavior, decimals, pause semantics, allowances, fee-on-transfer/rebasing assumptions, Morpho market accounting and share rounding, Uniswap Router02 behavior, pool allowlist, and atomic rollback on the actual deployed versions.
7. **Risk-model boundaries:** validate the operational LTV arithmetic and rounding, its reliance on Morpho's oracle for collateral value, the 2% oracle cross-check, price scaling, borrow-share-to-assets rounding, and behavior when values approach integer bounds.
8. **Test coverage:** add/review adversarial tests for malformed feed return data, unexpected feed decimals, malformed `oraclePaused()` responses, timestamp boundaries, authorization replay/expiry/wrong signer, pool changes, token callbacks, rounding extremes, and each execution route's failure rollback. Re-run current unit, fork, and static-analysis commands against the reviewed commit.
9. **Backend readiness:** `/api/plan/recheck` currently returns a parameter template, not signed calldata, simulation, or submission. The backend execution readiness remains blocked by absent deployment/signer and jurisdiction policy. Do not interpret the router's fork tests as end-to-end backend execution evidence.

## Deployment blockers (current)

- No independent security review has been completed.
- No execution signer address has been selected; no signer secret should be put in source control or chat.
- The proposed constructor maximum of 96 hours and associated SELL policy need confirmation.
- Jurisdiction eligibility remains intentionally blocked in the backend.
- The signing service is not yet wired to verified plan rechecks and all required risk/session/access gates.
- No router deployment address, deployed-code verification, or production readiness check exists.
- Current successful fresh-oracle fork execution of BORROW/HYBRID is not established by the latest run.

## Reviewer conclusion

Please return findings by severity, exact affected source locations, exploit preconditions, and required remediations. Deployment should remain blocked until findings are resolved, constructor values and policies are approved, and an authorized deployer separately approves the exact deployment transaction.
