# Purview Solidity workspace

This workspace is the start of the Foundry borrow/router track. It currently contains only a small
policy primitive and isolated unit tests. It does not call Morpho, swap tokens, hold funds, or authorize
execution. Passing these tests would verify only the LLTV arithmetic and fail-closed expected-market check.

The router must bind itself to the verified NVDA/USDG market, use the verified Uniswap V3 fee allowlist,
and preserve the wallet's explicit Morpho authorization model. The execution implementation remains
blocked until the borrow path, oracle/session gates, and test environment are verified. Never deploy this
workspace as an execution contract in its current state.

## Local commands

Install Foundry using its official Windows instructions, open a new PowerShell window, then run:

```powershell
cd C:\Users\user\Desktop\Purview\contracts
forge test -vv
```

No live RPC, wallet, API key, or private key is needed for these local unit tests.
