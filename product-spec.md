Purview

Natural-language portfolio moves, bounded by hard, deterministic limits.

1. Product Principle

«You tell it what you want to achieve and what you're unwilling to risk; it finds a way to do it, but it cannot cross the boundaries you set.»

Purview turns a natural-language financial goal into a constrained portfolio action.

The architecture follows five principles:

- The AI is the interface.
- The planner is deterministic.
- The safety gate has veto power.
- The execution layer enforces critical limits.
- The blockchain is the final source of truth.

The safety-critical path must never depend on an LLM response.

---

2. Problem

Most agentic trading interfaces assume the user already knows what transaction they want to perform.

A user may know the outcome they want without knowing the exact financial operation required.

Example:

«"I need $3,000 USDG without selling more than 20% of my NVDA."»

This is not simply a swap command.

The system must determine whether the goal can be achieved through:

1. Selling NVDA.
2. Borrowing against NVDA.
3. A combination of selling and borrowing.

It must then determine whether the resulting plan satisfies every constraint.

Purview treats this as a constrained optimization problem, rather than simply translating natural language into a transaction.

---

3. Differentiation

Purview focuses on converting a plain-English financial goal into a deterministic, constraint-bounded portfolio plan.

The important distinction is:

«The user describes the outcome and the boundaries. Purview determines the financial route without being allowed to cross those boundaries.»

This differs from systems primarily designed around direct trading commands or policy execution.

The pitch should focus on:

«"How do I achieve this financial goal while mathematically respecting the limits I set?"»

Do not claim that no other system can ever perform similar functionality unless independently verified.

---

4. Primary Demo

User enters:

«"I need $3,000 USDG without selling more than 20% of my NVDA."»

Purview should:

1. Parse the request.
2. Determine the required constraints.
3. Query the user's actual portfolio state.
4. Query relevant protocol state.
5. Generate sell, borrow, and hybrid candidates.
6. Reject candidates violating hard constraints.
7. Calculate the consequences of valid candidates.
8. Simulate the proposed transaction.
9. Run safety checks.
10. Show the complete plan.
11. Ask for explicit confirmation.
12. Re-check state immediately before execution.
13. Enforce transaction-level limits.
14. Execute.
15. Verify the resulting blockchain state.
16. Display a trust receipt containing actual verified results.

---

5. Intent Parsing

Example:

«"I need $3,000 USDG without selling more than 20% of my NVDA."»

Structured intent:

target_asset: USDG
target_amount: 3000
restricted_asset: NVDA
max_sell_percentage: 20%
existing_debt: queried from protocol
portfolio_state: queried immediately before planning

The parser must not invent missing constraints.

For example:

«"Get me $3,000 USDG."»

does not provide enough information to safely determine the user's acceptable portfolio risk.

Purview should ask a clarification question rather than silently assuming a safety limit.

Example:

«"How much NVDA are you willing to sell to get this?"»

This clarification state is a first-class product state.

---

6. Deterministic Planner

The planner receives structured intent and validated portfolio/protocol state.

The planner evaluates:

- Sell-only strategy.
- Borrow-only strategy.
- Hybrid strategy.

For each candidate it calculates:

- Amount sold.
- Percentage of position sold.
- Amount borrowed.
- Resulting LTV.
- Liquidation buffer.
- Expected USDG received.
- Fees.
- Price impact.
- Remaining exposure.
- Estimated execution cost.

The planner is deterministic.

The LLM must not select arbitrary contracts, generate arbitrary transaction calldata, override constraints, or directly decide whether a plan is safe.

---

7. Hard Constraints

The following are invariants.

They must never be silently relaxed.

For the primary demo:

NVDA sold <= user's maximum allowed percentage

USDG received >= requested amount

LTV <= protocol maximum

Liquidation buffer >= required minimum

Slippage <= configured maximum

Execution cost <= configured maximum

For the example:

NVDA sold <= 20%
USDG received >= $3,000

The market LLTV is the liquidation threshold, not the operational maxLTV. The configured operational maxLTV must remain below the verified market LLTV, with an explicit minimum liquidation-buffer policy.

If no candidate satisfies every hard constraint:

«"I can't safely execute this request under your current limits."»

Purview must not automatically relax the user's constraints.

---

8. Simulation

Before execution, Purview should simulate the proposed calls using "eth_call" / static simulation against the real contracts and current state.

Simulation should verify, where supported:

- Expected swap output.
- Borrow behavior.
- Resulting LTV.
- Resulting liquidation buffer.
- Contract revert status.
- Relevant execution parameters.

Simulation does not change blockchain state.

If simulation fails:

«Do not execute.»

Show the reason in a user-readable form.

A successful simulation does not guarantee execution will succeed later because blockchain state can change.

---

9. Swap Protection

The planner calculates a minimum acceptable output.

That minimum must be passed directly into the swap transaction.

The DEX/swap contract must reject the transaction if actual output falls below the required minimum.

This protects the transaction against excessive execution deterioration.

Purview must not describe this as complete MEV protection.

A sophisticated attacker could still attempt a sandwich or other MEV strategy.

Future hardening may include:

- Private transaction submission.
- MEV-aware routing.
- Additional execution protection.

These are not claimed as implemented unless actually demonstrated.

---

10. Router / Orchestrator Contract

The router is a security-critical execution component.

Its purpose is to enforce transaction-level constraints and, where implemented and tested, atomically coordinate the swap and borrow operations.

The router should receive validated execution parameters such as:

maxSellAmount
minOutputAmount
maxBorrowAmount
authorizedRecipient
swapTarget
borrowTarget

The router should:

1. Validate permitted targets.
2. Validate the caller/authorization model.
3. Execute the permitted swap.
4. Verify the swap result.
5. Execute the permitted borrow operation.
6. Verify relevant results.
7. Enforce hard limits.
8. Revert the entire transaction if a required operation or limit fails.

The router must not become a general-purpose arbitrary transaction executor.

Avoid unrestricted:

- "delegatecall"
- arbitrary target execution
- arbitrary calldata execution
- unrestricted contract selection

Atomicity may only be claimed if transaction-level tests demonstrate the required revert semantics.

---

11. Atomicity

The target architecture is:

Swap
  +
Borrow
  =
One atomic transaction

If either leg fails or a hard constraint is violated, the transaction should revert.

If true atomic bundling cannot be completed or verified within the build period:

- Do not claim atomic execution.
- Clearly document the actual fallback.
- Clearly state which execution version is demonstrated.

An honest non-atomic fallback is preferable to falsely claiming atomicity.

---

12. Oracle Safety

The safety gate should use one consistent architecture.

Oracle available?
       ↓
Price fresh?
       ↓
Asset/protocol active?
       ↓
Price within configured bounds?
       ↓
Proceed / Halt

A stale oracle invalidates the relevant risk calculation.

Purview must not use an outdated price merely because an earlier simulation passed.

---

13. Final State Re-check

The user may take time to review the plan.

During that time:

- Prices can change.
- Portfolio balances can change.
- Borrow availability can change.
- Oracle values can change.
- Protocol state can change.

Immediately before execution, Purview must refresh the relevant state.

If the original plan no longer satisfies the constraints:

«"The market moved after confirmation. The original plan no longer satisfies your limits, so nothing was executed."»

Purview must abort or re-plan.

It must never blindly execute a stale plan.

---

14. Transaction-Level Backstop

The deterministic planner is not the final security boundary.

Critical limits must also be enforced by the execution layer.

This ensures that a planner bug cannot turn:

sell <= 20%

into:

sell 80%

The strongest safety model is therefore:

AI proposes
    ↓
Deterministic planner constrains
    ↓
Safety gate vetoes unsafe plans
    ↓
Execution layer enforces critical parameters
    ↓
Blockchain settles the result

---

15. UI Screens

Purview has five primary screens.

Screen 1 — Sign In

Simple onboarding.

Example:

«Continue with Google»

Do not expose seed-phrase or traditional wallet-management language during the primary onboarding flow.

Wallet infrastructure should remain behind the experience.

---

Screen 2 — Home

Displays:

- Portfolio overview.
- Relevant tokenized assets.
- Natural-language request input.

Primary interaction:

«"What do you want to do?"»

Example:

«"I need $3,000 USDG without selling more than 20% of my NVDA."»

---

Screen 3 — Clarification

Displayed only when required information is missing or ambiguous.

Example:

«"How much NVDA are you willing to sell to get this?"»

Ask for the smallest missing piece of information required to safely continue.

Do not show a generic error.

---

Screen 4 — Plan + Confirmation

Show the consequences before execution.

At minimum:

- Amount received.
- Percentage sold.
- Amount borrowed.
- Remaining exposure.
- Resulting LTV.
- Liquidation buffer.
- Estimated cost.
- Relevant execution assumptions.

Then:

«Confirm this plan?»

Never reduce a financially significant action to a bare "Execute" button without showing its consequences.

---

Screen 5 — Trust Receipt

The receipt reports the verified result.

Example:

«Done — $3,014.28 USDG received. NVDA sold: 15.0%. Borrowed: $1,150. Remaining NVDA: 85.0%. LTV: 18.4%. Liquidation buffer: 62%. ✓ Within your 20% NVDA limit. View transactions →»

The receipt must represent actual verified blockchain state.

It must not simply repeat the planner's intended result.

---

16. Failure Behavior

Failures are first-class product states.

Constraint violation

«"I couldn't execute this plan because no available route can provide $3,000 USDG while keeping NVDA sales below 20%."»

Market moved

«"The market moved after confirmation. The original plan no longer satisfies your limits, so nothing was executed."»

Stale oracle

«"Execution stopped because the collateral price feed is stale."»

Slippage

«"Execution stopped because the available swap output fell below your minimum acceptable amount."»

Integration failure

Purview must report the actual integration problem.

It must never replace a failed real integration with fabricated success.

---

17. Explicit Demo Scope

Hardened for the demo

- Natural-language intent parsing.
- Deterministic planning.
- Hard constraints.
- Pre-execution simulation.
- Oracle freshness checks.
- Final-state re-check.
- Swap minimum-output protection.
- Transaction-level limits.
- Explicit confirmation.
- Post-execution verification.
- Trust receipt.
- Router/orchestrator enforcement where implemented and tested.

Not claimed as production-complete

- Full MEV protection.
- Complete private order flow.
- Universal atomicity.
- Complete protocol risk management.
- Universal protection against every possible smart-contract or market risk.

Claims must match demonstrated implementation.

---

18. Full Stack

Layer| Tool| Status
Login + wallet + gas sponsorship| Privy / embedded wallet / ERC-4337 / paymaster| Reused
Portfolio reads| viem/ethers RPC + Robinhood Stock Token API| Reused
Intent parsing| Claude API| Reused
Reference price| Chainlink| Reused
Onchain price + swap| 0x Price/Swap API| Reused
Borrow leg| Longbow / Morpho Blue market| Reused
Planner + safety gate| Custom backend| Built
Router/orchestrator| Foundry + OpenZeppelin| Built
UI| Next.js / React| Built

External integrations must be verified rather than assumed.

---

19. Demo Success Criteria

A successful demonstration should show:

1. User signs in.
2. User sees portfolio state.
3. User enters a natural-language request.
4. Purview parses the request.
5. Purview asks for clarification if required.
6. Purview generates a deterministic plan.
7. Purview displays the plan and consequences.
8. Simulation succeeds.
9. Safety checks pass.
10. User confirms.
11. State is re-checked.
12. Transaction-level constraints are enforced.
13. Execution occurs.
14. Actual resulting state is queried.
15. Trust receipt displays verified results.

If a critical integration is unavailable, Purview should fail honestly rather than simulate success.

---

20. Core Product Rule

«A broken real integration is better than a convincing fake integration.»

The product's credibility depends on this rule.
