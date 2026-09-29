# Product decisions

## 2026-09-28 — Deterministic planner policy

- Feasible plans are ranked by least wallet NVDA sold, then larger post-plan liquidation buffer, then lower valued execution cost. Hard constraints always filter before ranking.
- Return the highest-ranked feasible plan plus one valid alternative with a strictly larger liquidation buffer, if available.
- HYBRID may combine a wallet NVDA sale, borrowing against current Morpho collateral, and newly supplying wallet NVDA before borrowing. It never withdraws collateral or sells deposited NVDA. The same wallet units cannot be both supplied and sold.
- The user's sale percentage is measured against wallet NVDA plus deposited NVDA; actual sale is capped at wallet-held NVDA. Supplying wallet NVDA further reduces the wallet amount available to sell.
- BORROW and HYBRID risk use the complete post-plan Morpho position and market oracle. The Purview LTV cap is 60% of verified on-chain LLTV, calculated at runtime, with at least a 40% liquidation price-drop buffer. Chainlink remains a required cross-check under the Master Handoff.
- The 1.5% valued execution-cost cap includes swap fee and price impact relative to the oracle. Gas is reported separately as an ETH estimate and remains unassessed in USDG. Gas is never treated as zero. Execution requires sponsorship or sufficient ETH for the bounded gas limit.
- No new gas-price oracle is to be added solely for this cost rule.
- Plan selection returns `NO_FEASIBLE_PLAN` when every candidate violates at least one hard constraint. User limits are never relaxed.
- Rationale: preserve NVDA exposure while keeping market risk bounds as hard vetoes and separating gas funding from execution cost valuation.

## NEEDS REVIEW

- Runtime candidate generation, live quote sizing, and integration into `POST /api/plan` are still incomplete. The pure calculation and ranking helpers must not be presented as a completed planner until the live flow is wired and validated.
- No execution endpoint exists yet; simulation, final re-check, wallet gas funding read, submission, and receipt construction remain future work.

## 2026-09-29 â€” Temporary Uniswap quote-quality tolerance

- Temporarily widen the effective-price cutoff versus the best eligible 0.01 NVDA reference from 1% to 2% for allowlisted V3 tier comparison and exact-input sizing.
- This is a route-quality tolerance only. Keep the 2% Chainlink deviation limit, 1% execution slippage cap, 1.5% execution-cost cap, LTV limit, and liquidation-buffer rule unchanged.
- Rationale: the live $3,000 USDG diagnostic returned a target-reaching 0.30% quote that narrowly missed the former 1% relative-price cutoff, while the 0.05% tier passed. Widen temporarily to compare more real quotes and revisit if the looser cutoff admits poor execution quality.
- This does not make the diagnostic executable or remove the `latest`-state consistency limitation.

## 2026-09-29 — Planner candidate calculation wired

- `POST /api/plan` now calculates read-only SELL/BORROW/HYBRID candidates and ranks locally feasible candidates using exact live quote results, same-block Morpho position/oracle state, conservative loan-token liquidity, and verified market LLTV.
- The response preserves jurisdiction and other blockers and always reports `executable: false`. This is implementation progress, not evidence that the live plan route has succeeded or that planning/execution is complete.
- Historical-call failure must remain unavailable; do not substitute latest-state quotes into a plan snapshot. Hybrid binary search and its monotonic feasibility assumption require validation before claiming a global minimum sale.
