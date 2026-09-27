Purview Build Specification

1. Purpose

This document is the operating contract for coding agents working on Purview.

The coding agent is an implementer, not the product designer.

The agent must preserve the product architecture and safety model defined in:

1. "product-spec.md"
2. "backend.md"
3. "build-spec.md"
4. "STATUS.md"

Do not silently redesign the product.

---

2. Highest-Priority Rule

«A broken real integration is better than a convincing fake integration.»

Never hide an integration failure with fabricated data.

Never claim functionality has been tested when it has not.

Never claim atomicity without transaction-level evidence.

Never claim an integration is complete because code compiles.

---

3. Source-of-Truth Hierarchy

Official sources outrank repository documents for claims about deployed systems, current APIs, addresses, ABIs, network support, market parameters, and protocol behavior.

Use the most direct authoritative source available:

1. Current on-chain state and verified deployed contract code for live state and contract behavior.
2. Official protocol/API documentation and successful calls to the official API for supported interfaces and indexed data.
3. Official protocol application for how the protocol currently identifies or presents its markets and products.
4. "product-spec.md"
5. "backend.md"
6. "build-spec.md"
7. Code and tests.
8. "STATUS.md" as the evidence ledger for what this project has actually demonstrated.

When an official source contradicts a repository document, follow the official source and update the repository documents and implementation notes. When official sources conflict with each other, cross-check on-chain state where possible; otherwise surface the conflict and keep the affected feature blocked. Never silently choose an interpretation.

---

4. Product Identity

The product is:

«Purview»

Tagline:

«Natural-language portfolio moves, bounded by hard, deterministic limits.»

Do not introduce a new product name or alter the core product concept without explicit instruction.

---

5. Architecture

The implementation must preserve this flow:

Natural-language request
        ↓
Intent parser
        ↓
Structured constraints
        ↓
Deterministic planner
        ↓
Candidate plan
        ↓
Simulation
        ↓
Safety gate
        ↓
User confirmation
        ↓
Final state / price re-check
        ↓
Transaction-level constraints
        ↓
Router / execution
        ↓
Verification
        ↓
Trust receipt

The safety-critical path must not depend on an LLM response.

---

6. LLM Restrictions

The LLM may:

- Parse natural language.
- Produce structured intent.
- Explain plans.
- Explain failures.

The LLM may not:

- Select arbitrary contracts.
- Generate unrestricted execution calldata.
- Override user constraints.
- Determine whether a plan is safe.
- Decide LTV safety.
- Approve transactions.
- Modify hard limits.
- Fabricate blockchain data.
- Report an execution as successful without verified state.

---

7. Frontend Restrictions

The frontend is responsible for presentation and interaction.

It must not become the source of financial truth.

Do not put financial business logic into React components.

Do not calculate authoritative:

- LTV.
- Liquidation buffer.
- Maximum borrow.
- Maximum sell amount.
- Swap safety.
- Execution validity.

The frontend displays backend results.

---

8. Mock Mode

A walking skeleton is explicitly allowed.

On Day 1:

Frontend
   ↓
Mock backend endpoint
   ↓
Hardcoded plan

This is acceptable only to prove:

- Screen transitions.
- UI states.
- Loading states.
- Error states.
- Confirmation flow.
- Receipt flow.

The mock must live behind an explicit mode.

Example:

MOCK_MODE=true

The UI must never contain hardcoded financial values as its own source of data.

Mock mode must never:

- Execute transactions.
- Pretend a real transaction occurred.
- Generate fake transaction hashes.
- Become the fallback when a real integration fails.

---

9. Five Screens

Build these screens:

1. Sign in
2. Home
3. Clarification
4. Plan + Confirm
5. Receipt

The clarification screen is a real product state, not a generic error page.

---

10. Day 1 — Walking Skeleton

Goal:

Build the complete user flow before deep integrations.

The mock backend may return a clearly isolated sample plan.

Verify:

- Sign in transition.
- Home.
- Natural-language input.
- Clarification.
- Plan.
- Confirmation.
- Receipt.
- Error states.

At the end of Day 1, the complete UI flow should work independently of external integrations.

---

11. Integration Order

Replace the stubs in this order:

1. Longbow

Highest integration risk.

Verify:

- Market.
- Collateral.
- Borrow asset.
- ABI.
- Functions.
- Approvals.
- Transaction sequence.
- Simulation.
- Testnet behavior.

Surface problems immediately.

---

2. 0x Swap API

Verify:

- Robinhood Chain support.
- Tokens.
- Quote.
- Output.
- Minimum output.
- Spender.
- Swap target.
- Recipient.
- Simulation.

Do not assume generic Ethereum behavior.

---

3. Router / Orchestrator

Build and test with Foundry before depending on it for live execution.

Tests must cover:

- Valid swap + borrow.
- Swap failure.
- Borrow failure.
- Constraint failure.
- Minimum output failure.
- Maximum sell failure.
- Maximum borrow failure.
- Unauthorized recipient.
- Unauthorized target where applicable.
- Atomic revert behavior.

Deploy to testnet before real demo execution.

---

4. Chainlink / Privy / Claude

These are comparatively mature dependencies.

Integrate after the higher-risk execution path has been surfaced.

Claude remains parser/explainer only.

---

12. Router Development Rules

The router is security-sensitive.

Before changing it:

1. Read the relevant specification.
2. Inspect existing code.
3. Inspect tests.
4. Identify the security impact.
5. Make the smallest necessary change.
6. Run tests.
7. Record evidence.

Do not turn the router into a general-purpose arbitrary execution contract.

---

13. Atomicity Rules

Never write:

«"Atomic"»

in UI, pitch, README, or documentation unless the actual implementation guarantees it and tests prove it.

If atomicity is incomplete:

Use language such as:

«"Atomic execution is the target; the demonstrated implementation currently uses [actual mechanism]."»

The final wording must reflect reality.

---

14. Safety Rules

Hard constraints must never be relaxed automatically.

If no valid plan exists:

NO_FEASIBLE_PLAN

Return an honest failure.

Do not make the plan "work" by:

- Increasing sell percentage.
- Increasing borrow.
- Increasing slippage.
- Ignoring stale oracle data.
- Ignoring protocol limits.
- Changing the target amount.
- Pretending a quote exists.
- Pretending a transaction succeeded.

---

15. State Re-check

Before execution:

Refresh state
↓
Refresh price
↓
Refresh oracle
↓
Refresh protocol availability
↓
Recalculate constraints
↓
Execute only if still valid

A previously valid plan may become invalid.

That is expected behavior.

---

16. Verification

After execution:

Transaction status
↓
Actual token balances
↓
Actual debt
↓
Actual collateral
↓
Actual LTV
↓
Actual result

The receipt must use verified results.

---

17. Failure Protocol

If blocked, use:

BLOCKED

Feature:
[feature]

Attempted:
[what was attempted]

Expected:
[expected behavior]

Actual:
[actual behavior]

What was verified:
[verified facts]

Unknown:
[unknown facts]

Files changed:
[files]

Mock/fake replacement added:
NO

Do not conceal blockers.

---

18. Daily Build Rule

At the end of every day:

«The complete product flow must still run, even if some components are explicitly stubbed.»

However:

- Stubbed components must be isolated.
- Mock mode must be explicit.
- Real mode must fail honestly.
- No fake success may leak into real mode.

---

19. Feature Freeze

Feature freeze should happen approximately two days before the event/demo.

After feature freeze:

Prioritize:

1. Fixing broken integrations.
2. Safety testing.
3. Execution reliability.
4. UI polish.
5. Pitch rehearsal.
6. Backup demo video.

Do not introduce major new features during the final period unless necessary to repair the core flow.

---

20. Expected Judge Questions

"How is this different from Nightdesk or Robinhood's agentic trading?"

Answer:

«"Purview focuses on constrained optimization from natural language: the user specifies the financial outcome and the boundaries, and the system finds a route without being allowed to cross those boundaries."»

"Is the swap and borrow actually atomic?"

Answer according to the implementation.

Never bluff.

"What stops the AI from misunderstanding the request?"

«"The AI only parses the request. The deterministic planner and execution layer enforce the hard limits, so an incorrect interpretation cannot authorize a transaction outside those limits."»

"Who controls the router contract?"

Answer with the actual deployment and authorization model.

Do not obscure the centralization/trust model.

---

21. Final Definition of Done

A feature is complete only when:

- Code exists.
- Tests exist where appropriate.
- The real path has been tested.
- Relevant failure paths have been tested.
- No fake fallback exists in real mode.
- Safety constraints are enforced.
- Evidence has been recorded.
- Documentation matches implementation.

«Green means demonstrated, not merely coded.»
