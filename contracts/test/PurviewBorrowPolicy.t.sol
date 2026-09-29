// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PurviewBorrowPolicy} from "../src/PurviewBorrowPolicy.sol";

contract PurviewBorrowPolicyHarness {
    function operationalLltv(uint256 liveMarketLltv) external pure returns (uint256) {
        return PurviewBorrowPolicy.operationalLltv(liveMarketLltv);
    }
}

contract PurviewBorrowPolicyTest {
    PurviewBorrowPolicyHarness private harness;

    function setUp() public {
        harness = new PurviewBorrowPolicyHarness();
    }

    function testDerivesThirtySevenPointFivePercentFromLiveSixtyTwoPointFivePercent() public view {
        require(harness.operationalLltv(625_000_000_000_000_000) == 375_000_000_000_000_000);
    }

    function testUnexpectedLiveLltvFailsClosed() public {
        (bool success,) = address(harness).call(
            abi.encodeCall(PurviewBorrowPolicyHarness.operationalLltv, (600_000_000_000_000_000))
        );
        require(!success, "unexpected LLTV must block borrowing");
    }
}
