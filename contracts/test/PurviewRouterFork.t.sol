// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {
    PurviewRouter,
    IMorphoPurview,
    IChainlinkFeedPurview,
    IUniswapFactoryPurview
} from "../src/PurviewRouter.sol";
import {StdCheats} from "../lib/openzeppelin-contracts/lib/forge-std/src/StdCheats.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface IQuoterV2PurviewFork {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams calldata params)
        external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

interface VmForkPurview {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function skip(bool skipTest) external;
    function warp(uint256 newTimestamp) external;
    function expectRevert(bytes4 revertData) external;
}

interface IMorphoAuthorizationFork {
    function setAuthorization(address authorized, bool isAuthorized) external;
}

/// @notice Read-only integration checks against live Robinhood Chain contracts on a local fork.
/// @dev Run with forge test --fork-url <Robinhood mainnet RPC> --match-path test/PurviewRouterFork.t.sol.
///      No private key, funded wallet, or broadcast transaction is used.
contract PurviewRouterForkTest is StdCheats {
    VmForkPurview private constant vmFork = VmForkPurview(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant EXPECTED_CHAIN_ID = 4663;
    uint256 private constant MAX_SELL_ORACLE_AGE = 96 hours;
    uint256 private constant SIGNER_KEY = 0xA11CE;
    bytes32 private constant MARKET_ID = 0x66306c087add8907752320b309934abcc354d21626de8115c79df49d9c214edc;

    address private constant MORPHO = 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010;
    address private constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address private constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address private constant FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address private constant FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address private constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address private constant SWAP_ROUTER_02 = 0xCaf681a66D020601342297493863E78C959E5cb2;

    PurviewRouter private router;

    function setUp() public {
        if (block.chainid != EXPECTED_CHAIN_ID) {
            vmFork.skip(true);
            return;
        }
        router = new PurviewRouter(
            MORPHO, NVDA, USDG, FEED, FACTORY, SWAP_ROUTER_02, vmFork.addr(SIGNER_KEY), MAX_SELL_ORACLE_AGE
        );
    }

    function testRouterConstructorMatchesLiveMarketAndTokenMetadata() public view {
        IMorphoPurview.MarketParams memory params = IMorphoPurview(MORPHO).idToMarketParams(MARKET_ID);
        require(params.loanToken == USDG, "live loan token mismatch");
        require(params.collateralToken == NVDA, "live collateral token mismatch");
        require(params.lltv == 625_000_000_000_000_000, "live LLTV mismatch");
        require(IERC20Metadata(NVDA).decimals() == 18, "live NVDA decimals mismatch");
        require(IERC20Metadata(USDG).decimals() == 6, "live USDG decimals mismatch");
        require(router.maxOracleAgeSeconds() == MAX_SELL_ORACLE_AGE, "router oracle cap mismatch");
    }

    function testLiveFeedReturnsValidPositiveRound() public view {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            IChainlinkFeedPurview(FEED).latestRoundData();
        require(roundId > 0, "feed has no round");
        require(answer > 0, "feed answer is not positive");
        require(updatedAt > 0 && updatedAt <= block.timestamp, "feed update time invalid");
        require(answeredInRound >= roundId, "feed round incomplete");
        (bool ok, bytes memory result) = NVDA.staticcall(abi.encodeWithSignature("oraclePaused()"));
        require(ok && result.length >= 32, "NVDA oraclePaused read failed");
    }

    function testAllowlistedPoolAndQuoterRespondOnLiveFork() public {
        address pool = IUniswapFactoryPurview(FACTORY).getPool(NVDA, USDG, 500);
        require(pool == 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3, "live 0.05% pool mismatch");

        (uint256 amountOut,,,) = IQuoterV2PurviewFork(QUOTER_V2).quoteExactInputSingle(
            IQuoterV2PurviewFork.QuoteExactInputSingleParams({
                tokenIn: NVDA,
                tokenOut: USDG,
                amountIn: 1e16,
                fee: 500,
                sqrtPriceLimitX96: 0
            })
        );
        require(amountOut > 0, "live QuoterV2 returned zero output");
    }

    function testSellExecutesAgainstLiveSwapRouterOnFork() public {
        uint256 amountIn = 1e16;
        uint256 quotedOut = _quote(amountIn);
        uint256 minOutput = quotedOut * 9_900 / 10_000;
        uint256 deadline = block.timestamp + 60;
        deal(NVDA, address(this), amountIn);
        require(IERC20(NVDA).approve(address(router), amountIn), "NVDA approval failed");

        bytes32 digest = router.sellExecutionDigest(
            address(this), amountIn, amountIn, minOutput, 500, MAX_SELL_ORACLE_AGE, deadline
        );
        uint256 output = router.executeSell(
            amountIn, amountIn, minOutput, 500, MAX_SELL_ORACLE_AGE, deadline, _sign(digest)
        );
        require(output >= minOutput, "SELL output below signed minimum");
        require(IERC20(USDG).balanceOf(address(this)) == output, "SELL output not delivered to caller");
    }

    function testBorrowExecutesAgainstLiveMorphoWhenOracleFresh() public {
        if (!_borrowOracleFresh()) {
            vmFork.skip(true);
            return;
        }
        uint256 collateral = 1e18;
        uint256 borrowAmount = 10e6;
        uint256 deadline = block.timestamp + 60;
        _supplyForkCollateral(collateral);

        bytes32 digest = router.borrowExecutionDigest(address(this), borrowAmount, borrowAmount, deadline);
        uint256 borrowed = router.executeBorrow(borrowAmount, borrowAmount, deadline, _sign(digest));
        require(borrowed == borrowAmount, "BORROW amount mismatch");
        require(IERC20(USDG).balanceOf(address(this)) == borrowAmount, "BORROW output not delivered to caller");
    }

    function testBorrowBlocksWhenOracleStale() public {
        _supplyForkCollateral(1e18);
        vmFork.warp(block.timestamp + 3_661);
        uint256 borrowAmount = 10e6;
        uint256 deadline = block.timestamp + 60;
        bytes32 digest = router.borrowExecutionDigest(address(this), borrowAmount, borrowAmount, deadline);
        vmFork.expectRevert(PurviewRouter.OracleUnsafe.selector);
        router.executeBorrow(borrowAmount, borrowAmount, deadline, _sign(digest));
    }

    function testHybridExecutesAgainstLiveSwapRouterAndMorphoWhenOracleFresh() public {
        if (!_borrowOracleFresh()) {
            vmFork.skip(true);
            return;
        }
        uint256 amountIn = 1e16;
        uint256 collateral = 1e18;
        uint256 borrowAmount = 10e6;
        uint256 quotedOut = _quote(amountIn);
        uint256 minOutput = quotedOut * 9_900 / 10_000;
        uint256 deadline = block.timestamp + 60;
        deal(NVDA, address(this), amountIn + collateral);
        require(IERC20(NVDA).approve(address(router), amountIn + collateral), "NVDA approval failed");
        IMorphoAuthorizationFork(MORPHO).setAuthorization(address(router), true);

        bytes32 digest = router.executionDigest(
            address(this), amountIn, amountIn, collateral, borrowAmount, borrowAmount, minOutput, 500, deadline
        );
        bytes memory authorization = _sign(digest);
        (uint256 output, uint256 borrowed) = router.executeHybrid(
            amountIn, amountIn, collateral, borrowAmount, borrowAmount, minOutput, 500, deadline, authorization
        );
        require(output >= minOutput, "HYBRID output below signed minimum");
        require(borrowed == borrowAmount, "HYBRID borrow amount mismatch");
        require(IERC20(USDG).balanceOf(address(this)) == output + borrowed, "HYBRID output not delivered to caller");
    }

    function testHybridBlocksWhenOracleStale() public {
        uint256 amountIn = 1e16;
        uint256 collateral = 1e18;
        uint256 borrowAmount = 10e6;
        uint256 quotedOut = _quote(amountIn);
        uint256 minOutput = quotedOut * 9_900 / 10_000;
        deal(NVDA, address(this), amountIn + collateral);
        require(IERC20(NVDA).approve(address(router), amountIn + collateral), "NVDA approval failed");
        IMorphoAuthorizationFork(MORPHO).setAuthorization(address(router), true);
        vmFork.warp(block.timestamp + 3_661);
        uint256 deadline = block.timestamp + 60;
        bytes32 digest = router.executionDigest(
            address(this), amountIn, amountIn, collateral, borrowAmount, borrowAmount, minOutput, 500, deadline
        );
        vmFork.expectRevert(PurviewRouter.OracleUnsafe.selector);
        router.executeHybrid(
            amountIn, amountIn, collateral, borrowAmount, borrowAmount, minOutput, 500, deadline, _sign(digest)
        );
    }

    function _supplyForkCollateral(uint256 collateral) private {
        deal(NVDA, address(this), collateral);
        require(IERC20(NVDA).approve(MORPHO, collateral), "Morpho NVDA approval failed");
        IMorphoAuthorizationFork(MORPHO).setAuthorization(address(router), true);
        IMorphoPurview.MarketParams memory params = IMorphoPurview(MORPHO).idToMarketParams(MARKET_ID);
        IMorphoPurview(MORPHO).supplyCollateral(params, collateral, address(this), "");
    }

    function _borrowOracleFresh() private view returns (bool) {
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            IChainlinkFeedPurview(FEED).latestRoundData();
        if (
            answer <= 0 || updatedAt == 0 || updatedAt > block.timestamp || answeredInRound < roundId
                || block.timestamp - updatedAt > 3_660
        ) return false;
        (bool ok, bytes memory result) = NVDA.staticcall(abi.encodeWithSignature("oraclePaused()"));
        return ok && result.length >= 32 && !abi.decode(result, (bool));
    }

    function _quote(uint256 amountIn) private returns (uint256 amountOut) {
        (amountOut,,,) = IQuoterV2PurviewFork(QUOTER_V2).quoteExactInputSingle(
            IQuoterV2PurviewFork.QuoteExactInputSingleParams({
                tokenIn: NVDA,
                tokenOut: USDG,
                amountIn: amountIn,
                fee: 500,
                sqrtPriceLimitX96: 0
            })
        );
        require(amountOut > 0, "fork quote returned zero output");
    }

    function _sign(bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vmFork.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }
}
