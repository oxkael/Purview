// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PurviewBorrowPolicy} from "./PurviewBorrowPolicy.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IMorphoPurview {
    struct MarketParams {
        address loanToken;
        address collateralToken;
        address oracle;
        address irm;
        uint256 lltv;
    }

    function idToMarketParams(bytes32 id) external view returns (MarketParams memory);
    function isAuthorized(address authorizer, address authorized) external view returns (bool);
    function supplyCollateral(MarketParams calldata params, uint256 assets, address onBehalf, bytes calldata data)
        external;
    function borrow(MarketParams calldata params, uint256 assets, uint256 shares, address onBehalf, address receiver)
        external returns (uint256 assetsBorrowed, uint256 sharesBorrowed);
    function position(bytes32 id, address user)
        external view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral);
    function market(bytes32 id) external view returns (
        uint128 totalSupplyAssets,
        uint128 totalSupplyShares,
        uint128 totalBorrowAssets,
        uint128 totalBorrowShares,
        uint128 lastUpdate,
        uint128 fee
    );
}

interface IMorphoOraclePurview {
    function price() external view returns (uint256);
}

interface IChainlinkFeedPurview {
    function decimals() external view returns (uint8);
    function latestRoundData()
        external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

interface IUniswapFactoryPurview {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface ISwapRouter02Purview {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
    function multicall(uint256 deadline, bytes[] calldata data) external payable returns (bytes[] memory results);
}

/// @notice Fixed-path Uniswap V3 + Morpho Blue router for the verified NVDA/USDG market.
/// @dev A backend execution signer must attest to the exact plan after all off-chain gates pass.
///      This contract is not deployable until its immutable configuration and signer are reviewed.
contract PurviewRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 private constant WAD = 1e18;
    uint256 private constant ORACLE_PRICE_SCALE = 1e36;
    uint256 private constant MAX_DEADLINE_WINDOW = 120;
    uint256 private constant OPEN_MARKET_MAX_ORACLE_AGE = 3_660;
    uint256 private constant CLOSED_SELL_MAX_ORACLE_AGE = 72 hours;
    uint256 private constant HOLIDAY_SELL_MAX_ORACLE_AGE = 96 hours;
    uint256 private constant MAX_ALLOWED_ORACLE_AGE = HOLIDAY_SELL_MAX_ORACLE_AGE;
    uint8 private constant ACTION_SELL = 1;
    uint8 private constant ACTION_BORROW = 2;
    uint8 private constant ACTION_HYBRID = 3;
    uint256 private constant MAX_ORACLE_DEVIATION_BPS = 200;
    uint256 private constant BPS = 10_000;
    uint256 private constant EXPECTED_CHAIN_ID = 4663;
    bytes32 private constant MARKET_ID = 0x66306c087add8907752320b309934abcc354d21626de8115c79df49d9c214edc;
    bytes32 private constant AUTH_TYPEHASH = keccak256(
        "Execution(uint8 action,address user,uint256 amountIn,uint256 maxSellAmount,uint256 collateralToSupply,uint256 borrowAmount,uint256 maxBorrowAmount,uint256 minOutput,uint24 fee,uint256 oracleMaxAgeSeconds,uint256 deadline,uint256 chainId,address router)"
    );

    address public immutable morpho;
    address public immutable nvda;
    address public immutable usdg;
    address public immutable chainlinkFeed;
    address public immutable uniswapFactory;
    address public immutable swapRouter02;
    address public immutable executionSigner;
    uint256 public immutable maxOracleAgeSeconds;

    mapping(bytes32 => bool) public usedAuthorizations;

    error InvalidConfiguration();
    error InvalidExecution();
    error DeadlineExpired();
    error DeadlineTooFar();
    error UnsupportedFee(uint24 fee);
    error InvalidPool(uint24 fee, address actual, address expected);
    error InvalidAuthorization();
    error AuthorizationAlreadyUsed();
    error OracleUnsafe();
    error OracleDeviation();
    error BorrowLimitExceeded();
    error LtvLimitExceeded();
    error MorphoAuthorizationRequired();

    event HybridExecuted(
        address indexed user,
        uint256 amountSold,
        uint256 amountOut,
        uint256 collateralSupplied,
        uint256 amountBorrowed,
        uint24 fee
    );

    constructor(
        address morpho_,
        address nvda_,
        address usdg_,
        address chainlinkFeed_,
        address uniswapFactory_,
        address swapRouter02_,
        address executionSigner_,
        uint256 maxOracleAgeSeconds_
    ) {
        if (
            morpho_ == address(0) || nvda_ == address(0) || usdg_ == address(0) || chainlinkFeed_ == address(0)
                || uniswapFactory_ == address(0) || swapRouter02_ == address(0) || executionSigner_ == address(0)
                || maxOracleAgeSeconds_ == 0 || maxOracleAgeSeconds_ > MAX_ALLOWED_ORACLE_AGE
        ) revert InvalidConfiguration();
        morpho = morpho_;
        nvda = nvda_;
        usdg = usdg_;
        chainlinkFeed = chainlinkFeed_;
        uniswapFactory = uniswapFactory_;
        swapRouter02 = swapRouter02_;
        executionSigner = executionSigner_;
        maxOracleAgeSeconds = maxOracleAgeSeconds_;

        IMorphoPurview.MarketParams memory params = IMorphoPurview(morpho_).idToMarketParams(MARKET_ID);
        if (params.loanToken != usdg_ || params.collateralToken != nvda_ || params.lltv != 625_000_000_000_000_000) {
            revert InvalidConfiguration();
        }
        if (IERC20Metadata(nvda_).decimals() != 18 || IERC20Metadata(usdg_).decimals() != 6) {
            revert InvalidConfiguration();
        }
    }

    /// @notice Atomically execute a swap and/or collateral supply before borrowing USDG.
    /// @dev The recipient and position owner are always msg.sender. No targets or calldata are caller-selectable.
    ///      The backend signature must bind this exact request and must only be issued after every approved
    ///      off-chain gate, including session and jurisdiction checks, passes.
    function executeHybrid(
        uint256 amountIn,
        uint256 maxSellAmount,
        uint256 collateralToSupply,
        uint256 borrowAmount,
        uint256 maxBorrowAmount,
        uint256 minOutput,
        uint24 fee,
        uint256 deadline,
        bytes calldata authorization
    ) external nonReentrant returns (uint256 amountOut, uint256 amountBorrowed) {
        if (block.chainid != EXPECTED_CHAIN_ID) revert InvalidConfiguration();
        if (borrowAmount == 0) revert InvalidExecution();
        if (amountIn == 0) {
            // Collateral-supply-only HYBRID: no swap leg, but still an atomic
            // supply + borrow under this router's same authorization and risk checks.
            if (collateralToSupply == 0 || maxSellAmount != 0 || minOutput != 0 || fee != 0) revert InvalidExecution();
        } else {
            if (minOutput == 0 || amountIn > maxSellAmount || maxSellAmount == 0) revert InvalidExecution();
            _validateFeePool(fee);
        }
        if (borrowAmount > maxBorrowAmount || maxBorrowAmount == 0) revert BorrowLimitExceeded();
        // The execution deadline is capped at 120 seconds, beyond plausible block timestamp drift.
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline < block.timestamp) revert DeadlineExpired();
        // The execution deadline is capped at 120 seconds, beyond plausible block timestamp drift.
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert DeadlineTooFar();
        _consumeAuthorization(
            _authorizationHash(
                ACTION_HYBRID, msg.sender, amountIn, maxSellAmount, collateralToSupply, borrowAmount,
                maxBorrowAmount, minOutput, fee, OPEN_MARKET_MAX_ORACLE_AGE, deadline
            ),
            authorization
        );
        if (!IMorphoPurview(morpho).isAuthorized(msg.sender, address(this))) revert MorphoAuthorizationRequired();

        IMorphoPurview.MarketParams memory params = IMorphoPurview(morpho).idToMarketParams(MARKET_ID);
        if (
            params.loanToken != usdg || params.collateralToken != nvda
                || params.lltv != 625_000_000_000_000_000
        ) revert InvalidConfiguration();
        _checkOracle(params.oracle, OPEN_MARKET_MAX_ORACLE_AGE);

        IERC20(nvda).safeTransferFrom(msg.sender, address(this), amountIn + collateralToSupply);
        if (amountIn != 0) {
            IERC20(nvda).forceApprove(swapRouter02, amountIn);
            uint256 usdgBefore = IERC20(usdg).balanceOf(address(this));
            ISwapRouter02Purview.ExactInputSingleParams memory swapParams = ISwapRouter02Purview.ExactInputSingleParams({
                tokenIn: nvda,
                tokenOut: usdg,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOutput,
                sqrtPriceLimitX96: 0
            });
            bytes[] memory calls = new bytes[](1);
            calls[0] = abi.encodeCall(ISwapRouter02Purview.exactInputSingle, (swapParams));
            // The USDG balance delta below is the authoritative swap result and minimum-output check.
            // forge-lint: disable-next-line(unused-return)
            ISwapRouter02Purview(swapRouter02).multicall(deadline, calls);
            IERC20(nvda).forceApprove(swapRouter02, 0);
            amountOut = IERC20(usdg).balanceOf(address(this)) - usdgBefore;
            if (amountOut < minOutput) revert InvalidExecution();
        }
        IERC20(nvda).forceApprove(morpho, collateralToSupply);
        if (collateralToSupply != 0) {
            IMorphoPurview(morpho).supplyCollateral(params, collateralToSupply, msg.sender, "");
        }
        IERC20(nvda).forceApprove(morpho, 0);
        // Borrow shares are unused; the router bounds and reports actual borrowed assets and never repays by shares.
        // forge-lint: disable-next-line(unused-return)
        (amountBorrowed,) = IMorphoPurview(morpho).borrow(params, borrowAmount, 0, msg.sender, msg.sender);
        if (amountBorrowed > maxBorrowAmount) revert BorrowLimitExceeded();
        _enforceOperationalLtv(params, msg.sender);

        if (amountOut != 0) IERC20(usdg).safeTransfer(msg.sender, amountOut);
        // Every execution entry point is nonReentrant; emit only after swap, borrow, and limit checks succeed.
        // forge-lint: disable-next-line(reentrancy-events)
        emit HybridExecuted(msg.sender, amountIn, amountOut, collateralToSupply, amountBorrowed, fee);
    }

    /// @notice Swap wallet NVDA for USDG without supplying collateral or borrowing.
    /// @dev The backend signature attests that the session policy allows this oracle age. Only this
    ///      SELL action can use the longer closed-market freshness window.
    function executeSell(
        uint256 amountIn,
        uint256 maxSellAmount,
        uint256 minOutput,
        uint24 fee,
        uint256 oracleMaxAgeSeconds,
        uint256 deadline,
        bytes calldata authorization
    ) external nonReentrant returns (uint256 amountOut) {
        if (block.chainid != EXPECTED_CHAIN_ID) revert InvalidConfiguration();
        if (amountIn == 0 || maxSellAmount == 0 || amountIn > maxSellAmount || minOutput == 0) {
            revert InvalidExecution();
        }
        if (
            (oracleMaxAgeSeconds != OPEN_MARKET_MAX_ORACLE_AGE
                && oracleMaxAgeSeconds != CLOSED_SELL_MAX_ORACLE_AGE
                && oracleMaxAgeSeconds != HOLIDAY_SELL_MAX_ORACLE_AGE)
                || oracleMaxAgeSeconds > maxOracleAgeSeconds
        ) revert OracleUnsafe();
        _checkDeadline(deadline);
        _validateFeePool(fee);
        _consumeAuthorization(
            _authorizationHash(
                ACTION_SELL, msg.sender, amountIn, maxSellAmount, 0, 0, 0, minOutput, fee,
                oracleMaxAgeSeconds, deadline
            ),
            authorization
        );
        IMorphoPurview.MarketParams memory params = IMorphoPurview(morpho).idToMarketParams(MARKET_ID);
        _validateMarketParams(params);
        _checkOracle(params.oracle, oracleMaxAgeSeconds);

        IERC20(nvda).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(nvda).forceApprove(swapRouter02, amountIn);
        uint256 usdgBefore = IERC20(usdg).balanceOf(address(this));
        ISwapRouter02Purview.ExactInputSingleParams memory swapParams = ISwapRouter02Purview.ExactInputSingleParams({
            tokenIn: nvda,
            tokenOut: usdg,
            fee: fee,
            recipient: address(this),
            amountIn: amountIn,
            amountOutMinimum: minOutput,
            sqrtPriceLimitX96: 0
        });
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(ISwapRouter02Purview.exactInputSingle, (swapParams));
        // The USDG balance delta below is the authoritative swap result and minimum-output check.
        // forge-lint: disable-next-line(unused-return)
        ISwapRouter02Purview(swapRouter02).multicall(deadline, calls);
        IERC20(nvda).forceApprove(swapRouter02, 0);
        amountOut = IERC20(usdg).balanceOf(address(this)) - usdgBefore;
        if (amountOut < minOutput) revert InvalidExecution();
        IERC20(usdg).safeTransfer(msg.sender, amountOut);
    }

    /// @notice Borrow USDG against the caller's existing Morpho NVDA collateral.
    /// @dev Borrowing always uses the strict open-market freshness bound; closed-market borrowing is not allowed.
    function executeBorrow(
        uint256 borrowAmount,
        uint256 maxBorrowAmount,
        uint256 deadline,
        bytes calldata authorization
    ) external nonReentrant returns (uint256 amountBorrowed) {
        if (block.chainid != EXPECTED_CHAIN_ID) revert InvalidConfiguration();
        if (borrowAmount == 0 || maxBorrowAmount == 0 || borrowAmount > maxBorrowAmount) revert BorrowLimitExceeded();
        _checkDeadline(deadline);
        _consumeAuthorization(
            _authorizationHash(
                ACTION_BORROW, msg.sender, 0, 0, 0, borrowAmount, maxBorrowAmount, 0, 0,
                OPEN_MARKET_MAX_ORACLE_AGE, deadline
            ),
            authorization
        );
        if (!IMorphoPurview(morpho).isAuthorized(msg.sender, address(this))) revert MorphoAuthorizationRequired();
        IMorphoPurview.MarketParams memory params = IMorphoPurview(morpho).idToMarketParams(MARKET_ID);
        _validateMarketParams(params);
        _checkOracle(params.oracle, OPEN_MARKET_MAX_ORACLE_AGE);
        // Borrow shares are unused; the router bounds and reports actual borrowed assets and never repays by shares.
        // forge-lint: disable-next-line(unused-return)
        (amountBorrowed,) = IMorphoPurview(morpho).borrow(params, borrowAmount, 0, msg.sender, msg.sender);
        if (amountBorrowed > maxBorrowAmount) revert BorrowLimitExceeded();
        _enforceOperationalLtv(params, msg.sender);
    }

    /// @notice Returns the exact personal-sign digest expected for an execution request.
    /// @dev The backend should call this view and sign the returned 32-byte digest; this avoids duplicating
    ///      the Solidity ABI encoding in the backend. The signature still authorizes only this caller and plan.
    function executionDigest(
        address user,
        uint256 amountIn,
        uint256 maxSellAmount,
        uint256 collateralToSupply,
        uint256 borrowAmount,
        uint256 maxBorrowAmount,
        uint256 minOutput,
        uint24 fee,
        uint256 deadline
    ) external view returns (bytes32) {
        bytes32 planHash = _authorizationHash(
            ACTION_HYBRID, user, amountIn, maxSellAmount, collateralToSupply, borrowAmount,
            maxBorrowAmount, minOutput, fee, OPEN_MARKET_MAX_ORACLE_AGE, deadline
        );
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", planHash));
    }

    function sellExecutionDigest(
        address user,
        uint256 amountIn,
        uint256 maxSellAmount,
        uint256 minOutput,
        uint24 fee,
        uint256 oracleMaxAgeSeconds,
        uint256 deadline
    ) external view returns (bytes32) {
        bytes32 planHash = _authorizationHash(
            ACTION_SELL, user, amountIn, maxSellAmount, 0, 0, 0, minOutput, fee, oracleMaxAgeSeconds, deadline
        );
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", planHash));
    }

    function borrowExecutionDigest(address user, uint256 borrowAmount, uint256 maxBorrowAmount, uint256 deadline)
        external view returns (bytes32)
    {
        bytes32 planHash = _authorizationHash(
            ACTION_BORROW, user, 0, 0, 0, borrowAmount, maxBorrowAmount, 0, 0,
            OPEN_MARKET_MAX_ORACLE_AGE, deadline
        );
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", planHash));
    }

    function _checkOracle(address marketOracle, uint256 maxAgeSeconds) private view {
        // startedAt is intentionally unused; updatedAt is the publication time used for freshness.
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) =
            // forge-lint: disable-next-line(unused-return)
            IChainlinkFeedPurview(chainlinkFeed).latestRoundData();
        if (
            answer <= 0 || updatedAt == 0 || answeredInRound < roundId
                || maxAgeSeconds == 0 || maxAgeSeconds > maxOracleAgeSeconds
        ) revert OracleUnsafe();
        // Future-dated rounds are rejected; accepted feeds have timestamp skew far below the stale-age window.
        // forge-lint: disable-next-line(block-timestamp)
        if (updatedAt > block.timestamp) revert OracleUnsafe();
        // The configured freshness bound is at least 3,660 seconds, far above plausible timestamp drift.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp - updatedAt > maxAgeSeconds) revert OracleUnsafe();
        (bool pausedOk, bytes memory pausedResult) = nvda.staticcall(abi.encodeWithSignature("oraclePaused()"));
        if (!pausedOk || pausedResult.length < 32 || abi.decode(pausedResult, (bool))) revert OracleUnsafe();

        uint8 feedDecimals = IChainlinkFeedPurview(chainlinkFeed).decimals();
        uint8 nvdaDecimals = IERC20Metadata(nvda).decimals();
        uint8 usdgDecimals = IERC20Metadata(usdg).decimals();
        uint256 exponent = 36 + uint256(usdgDecimals) - uint256(nvdaDecimals) - uint256(feedDecimals);
        if (exponent > 77) revert OracleUnsafe();
        // answer <= 0 reverted above, so this signed-to-unsigned conversion cannot truncate.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 chainlinkPrice = uint256(answer) * (10 ** exponent);
        uint256 marketPrice = IMorphoOraclePurview(marketOracle).price();
        if (marketPrice == 0) revert OracleUnsafe();
        uint256 delta = marketPrice > chainlinkPrice ? marketPrice - chainlinkPrice : chainlinkPrice - marketPrice;
        // Division before multiplication keeps the check safe from uint256 overflow.
        if (delta > chainlinkPrice / (BPS / MAX_ORACLE_DEVIATION_BPS)) revert OracleDeviation();
    }

    function _enforceOperationalLtv(IMorphoPurview.MarketParams memory params, address user) private view {
        uint256 cap = PurviewBorrowPolicy.operationalLltv(params.lltv);
        (, uint128 borrowShares, uint128 collateral,,) = _positionAndMarket(user);
        uint256 price = IMorphoOraclePurview(params.oracle).price();
        if (price == 0) revert OracleUnsafe();
        uint256 collateralValue = Math.mulDiv(uint256(collateral), price, ORACLE_PRICE_SCALE);
        uint256 debt = _borrowSharesToAssetsUp(borrowShares, user);
        uint256 maxDebt = Math.mulDiv(collateralValue, cap, WAD);
        if (debt > maxDebt) revert LtvLimitExceeded();
    }

    function _positionAndMarket(address user)
        private view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral, uint128 borrowAssets, uint128 borrowTotalShares)
    {
        (supplyShares, borrowShares, collateral) = IMorphoPurview(morpho).position(MARKET_ID, user);
        // Supply shares, total supply fields, lastUpdate, and fee are unused by borrow-LTV calculation.
        // forge-lint: disable-next-line(unused-return)
        (,, borrowAssets, borrowTotalShares,,) = IMorphoPurview(morpho).market(MARKET_ID);
    }

    function _borrowSharesToAssetsUp(uint128 shares, address user) private view returns (uint256) {
        (,,, uint128 totalBorrowAssets, uint128 totalBorrowShares) = _positionAndMarket(user);
        if (shares == 0 || totalBorrowShares == 0) return 0;
        uint256 product = uint256(shares) * uint256(totalBorrowAssets);
        uint256 quotient = product / totalBorrowShares;
        return product % totalBorrowShares == 0 ? quotient : quotient + 1;
    }

    function _validateFeePool(uint24 fee) private view {
        address expected;
        if (fee == 100) expected = 0xb75d2D02B0Ec3DE50d32e40A4F1A8DAE8acC4333;
        else if (fee == 500) expected = 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3;
        else if (fee == 3000) expected = 0xB944cec30Bd4175855215D767ADC81F39e5f7E2B;
        else revert UnsupportedFee(fee);
        address actual = IUniswapFactoryPurview(uniswapFactory).getPool(nvda, usdg, fee);
        if (actual != expected) revert InvalidPool(fee, actual, expected);
    }

    function _authorizationHash(
        uint8 action,
        address user,
        uint256 amountIn,
        uint256 maxSellAmount,
        uint256 collateralToSupply,
        uint256 borrowAmount,
        uint256 maxBorrowAmount,
        uint256 minOutput,
        uint24 fee,
        uint256 oracleMaxAgeSeconds,
        uint256 deadline
    ) private view returns (bytes32) {
        return keccak256(abi.encode(
            AUTH_TYPEHASH, action, user, amountIn, maxSellAmount, collateralToSupply, borrowAmount,
            maxBorrowAmount, minOutput, fee, oracleMaxAgeSeconds, deadline, block.chainid, address(this)
        ));
    }

    function _consumeAuthorization(bytes32 authorizationHash, bytes calldata authorization) private {
        if (usedAuthorizations[authorizationHash]) revert AuthorizationAlreadyUsed();
        if (!_validSigner(authorizationHash, authorization)) revert InvalidAuthorization();
        usedAuthorizations[authorizationHash] = true;
    }

    function _checkDeadline(uint256 deadline) private view {
        // The execution deadline is capped at 120 seconds, beyond plausible block timestamp drift.
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline < block.timestamp) revert DeadlineExpired();
        // The execution deadline is capped at 120 seconds, beyond plausible block timestamp drift.
        // forge-lint: disable-next-line(block-timestamp)
        if (deadline > block.timestamp + MAX_DEADLINE_WINDOW) revert DeadlineTooFar();
    }

    function _validateMarketParams(IMorphoPurview.MarketParams memory params) private view {
        if (
            params.loanToken != usdg || params.collateralToken != nvda
                || params.lltv != 625_000_000_000_000_000
        ) revert InvalidConfiguration();
    }

    function _validSigner(bytes32 hash, bytes calldata signature) private view returns (bool) {
        if (signature.length != 65) return false;
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v != 27 && v != 28) return false;
        if (uint256(s) > 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0) return false;
        address signer = ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)), v, r, s);
        return signer != address(0) && signer == executionSigner;
    }
}
