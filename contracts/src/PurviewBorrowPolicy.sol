// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Small deterministic policy primitive for the Morpho borrow path.
/// @dev This is not a router and does not make an execution decision. A caller must pass
///      the verified on-chain LLTV; any value other than the approved NVDA market LLTV reverts.
library PurviewBorrowPolicy {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant EXPECTED_NVDA_LLTV = 625_000_000_000_000_000;
    uint256 internal constant MAX_OPERATIONAL_FRACTION = 6e17;

    error UnexpectedMarketLltv(uint256 actual, uint256 expected);

    /// @notice Derive the Purview ceiling as 60% of the live market LLTV.
    /// @dev The expected value is a fail-closed market identity guard, not a replacement for
    ///      reading LLTV from Morpho at runtime.
    function operationalLltv(uint256 liveMarketLltv) internal pure returns (uint256) {
        if (liveMarketLltv != EXPECTED_NVDA_LLTV) {
            revert UnexpectedMarketLltv(liveMarketLltv, EXPECTED_NVDA_LLTV);
        }
        return (liveMarketLltv * MAX_OPERATIONAL_FRACTION) / WAD;
    }
}
