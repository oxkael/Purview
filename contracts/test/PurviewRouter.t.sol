// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {PurviewRouter, IMorphoPurview, ISwapRouter02Purview} from "../src/PurviewRouter.sol";

interface IMockERC20Purview {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface VmPurview {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function chainId(uint256 newChainId) external;
    function warp(uint256 newTimestamp) external;
    function prank(address sender) external;
    function expectRevert() external;
}

contract MockTokenPurview {
    uint8 public immutable decimals;
    bool public paused;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint8 decimals_) { decimals = decimals_; }
    function oraclePaused() external view returns (bool) { return paused; }
    function setPaused(bool value) external { paused = value; }
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockMorphoOraclePurview {
    uint256 public price = 230e24;
}

contract MockChainlinkPurview {
    uint8 public constant decimals = 8;
    uint80 public roundId = 1;
    int256 public answer = 23_000_000_000;
    uint256 public updatedAt = 1_800_000_000;
    uint80 public answeredInRound = 1;
    function setUpdatedAt(uint256 value) external { updatedAt = value; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }
}

contract MockFactoryPurview {
    mapping(uint24 => address) public pools;
    function setPool(uint24 fee, address pool) external { pools[fee] = pool; }
    function getPool(address, address, uint24 fee) external view returns (address) { return pools[fee]; }
}

contract MockSwapRouter02Purview {
    bool public fail;
    uint256 public outputFactor = 230;
    function setFail(bool value) external { fail = value; }
    function multicall(uint256 deadline, bytes[] calldata data) external returns (bytes[] memory results) {
        require(block.timestamp <= deadline, "deadline");
        require(data.length == 1, "call-count");
        ISwapRouter02Purview.ExactInputSingleParams memory p =
            abi.decode(_stripSelector(data[0]), (ISwapRouter02Purview.ExactInputSingleParams));
        require(!fail, "swap-failed");
        require(p.fee == 500 && p.sqrtPriceLimitX96 == 0, "bad-swap-params");
        MockTokenPurview(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        uint256 out = p.amountIn * outputFactor / 1e12;
        require(out >= p.amountOutMinimum, "min-out");
        MockTokenPurview(p.tokenOut).mint(p.recipient, out);
        results = new bytes[](1);
        results[0] = abi.encode(out);
    }
    function _stripSelector(bytes calldata input) private pure returns (bytes calldata) {
        return input[4:];
    }
}

contract MockMorphoPurview {
    IMorphoPurview.MarketParams private params;
    mapping(address => bool) public authorized;
    mapping(address => uint128) public collateral;
    mapping(address => uint128) public borrowShares;
    uint128 public totalBorrowAssets;
    uint128 public totalBorrowShares;
    bool public failBorrow;

    constructor(address nvda, address usdg, address oracle) {
        params = IMorphoPurview.MarketParams(usdg, nvda, oracle, address(0x1234), 625_000_000_000_000_000);
    }
    function setAuthorized(address user, bool value) external { authorized[user] = value; }
    function setFailBorrow(bool value) external { failBorrow = value; }
    function idToMarketParams(bytes32) external view returns (IMorphoPurview.MarketParams memory) { return params; }
    function isAuthorized(address user, address router) external view returns (bool) {
        return router == address(0) ? false : authorized[user];
    }
    function supplyCollateral(IMorphoPurview.MarketParams calldata, uint256 assets, address onBehalf, bytes calldata)
        external
    {
        require(IMockERC20Purview(params.collateralToken).transferFrom(msg.sender, address(this), assets));
        collateral[onBehalf] += uint128(assets);
    }
    function borrow(IMorphoPurview.MarketParams calldata, uint256 assets, uint256, address onBehalf, address receiver)
        external returns (uint256, uint256)
    {
        require(!failBorrow, "borrow-failed");
        borrowShares[onBehalf] += uint128(assets);
        totalBorrowAssets += uint128(assets);
        totalBorrowShares += uint128(assets);
        require(IMockERC20Purview(params.loanToken).transfer(receiver, assets));
        return (assets, assets);
    }
    function position(bytes32, address user) external view returns (uint256, uint128, uint128) {
        return (0, borrowShares[user], collateral[user]);
    }
    function market(bytes32) external view returns (uint128, uint128, uint128, uint128, uint128, uint128) {
        return (100_000_000e6, 100_000_000e6, totalBorrowAssets, totalBorrowShares, uint128(block.timestamp), 0);
    }
}

contract PurviewRouterTest {
    VmPurview private constant vm = VmPurview(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant SIGNER_KEY = 0xA11CE;
    address private constant POOL_500 = 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3;
    MockTokenPurview private nvda;
    MockTokenPurview private usdg;
    MockMorphoOraclePurview private oracle;
    MockChainlinkPurview private feed;
    MockFactoryPurview private factory;
    MockSwapRouter02Purview private swap;
    MockMorphoPurview private morpho;
    PurviewRouter private router;
    address private user;

    function setUp() public {
        vm.chainId(4663);
        vm.warp(1_800_000_000);
        user = address(0xBEEF);
        nvda = new MockTokenPurview(18);
        usdg = new MockTokenPurview(6);
        oracle = new MockMorphoOraclePurview();
        feed = new MockChainlinkPurview();
        factory = new MockFactoryPurview();
        swap = new MockSwapRouter02Purview();
        morpho = new MockMorphoPurview(address(nvda), address(usdg), address(oracle));
        factory.setPool(500, POOL_500);
        router = new PurviewRouter(
            address(morpho), address(nvda), address(usdg), address(feed), address(factory), address(swap),
            vm.addr(SIGNER_KEY), 3_660
        );
        morpho.setAuthorized(user, true);
        nvda.mint(user, 11e18);
        usdg.mint(address(morpho), 100_000e6);
    }

    function testAtomicSwapSupplyBorrowSucceedsWithinBounds() public {
        (uint256 amountIn, uint256 collateralIn, uint256 borrowAmount, uint256 minOut, uint256 deadline) = _sample();
        bytes memory proof = _sign(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, deadline);
        vm.prank(user);
        nvda.approve(address(router), amountIn + collateralIn);
        vm.prank(user);
        (uint256 out, uint256 borrowed) = router.executeHybrid(
            amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, 500, deadline, proof
        );
        require(out == 230e6 && borrowed == borrowAmount, "wrong return values");
        require(usdg.balanceOf(user) == 730e6, "USDG not delivered");
        require(morpho.collateral(user) == collateralIn, "collateral not supplied");
        vm.expectRevert();
        vm.prank(user);
        router.executeHybrid(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, 500, deadline, proof);
    }

    function testMaximumSellViolationReverts() public {
        (uint256 amountIn, uint256 collateralIn, uint256 borrowAmount, uint256 minOut, uint256 deadline) = _sample();
        bytes memory proof = _sign(amountIn, amountIn - 1, collateralIn, borrowAmount, 600e6, minOut, deadline);
        vm.expectRevert();
        vm.prank(user);
        router.executeHybrid(amountIn, amountIn - 1, collateralIn, borrowAmount, 600e6, minOut, 500, deadline, proof);
    }

    function testBorrowFailureRevertsSwapAndCollateralSupply() public {
        (uint256 amountIn, uint256 collateralIn, uint256 borrowAmount, uint256 minOut, uint256 deadline) = _sample();
        bytes memory proof = _sign(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, deadline);
        vm.prank(user);
        nvda.approve(address(router), amountIn + collateralIn);
        morpho.setFailBorrow(true);
        vm.expectRevert();
        vm.prank(user);
        router.executeHybrid(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, 500, deadline, proof);
        require(nvda.balanceOf(user) == 11e18, "NVDA transfer escaped revert");
        require(usdg.balanceOf(user) == 0, "swap output escaped revert");
        require(morpho.collateral(user) == 0, "collateral supply escaped revert");
    }

    function testSwapFailureRevertsWholeRoute() public {
        (uint256 amountIn, uint256 collateralIn, uint256 borrowAmount, uint256 minOut, uint256 deadline) = _sample();
        bytes memory proof = _sign(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, deadline);
        vm.prank(user);
        nvda.approve(address(router), amountIn + collateralIn);
        swap.setFail(true);
        vm.expectRevert();
        vm.prank(user);
        router.executeHybrid(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, 500, deadline, proof);
        require(nvda.balanceOf(user) == 11e18, "NVDA transfer escaped swap revert");
        require(usdg.balanceOf(user) == 0, "USDG escaped swap revert");
        require(morpho.collateral(user) == 0, "collateral supply escaped swap revert");
    }

    function testStaleOracleBlocksAndRevertsWholeRoute() public {
        (uint256 amountIn, uint256 collateralIn, uint256 borrowAmount, uint256 minOut, uint256 deadline) = _sample();
        bytes memory proof = _sign(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, deadline);
        vm.prank(user);
        nvda.approve(address(router), amountIn + collateralIn);
        feed.setUpdatedAt(block.timestamp - 3_661);
        vm.expectRevert();
        vm.prank(user);
        router.executeHybrid(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, 500, deadline, proof);
        require(nvda.balanceOf(user) == 11e18, "NVDA transfer escaped revert");
    }

    function testMinimumOutputFailureRevertsWholeRoute() public {
        (uint256 amountIn, uint256 collateralIn, uint256 borrowAmount,, uint256 deadline) = _sample();
        uint256 minOut = 231e6;
        bytes memory proof = _sign(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, deadline);
        vm.prank(user);
        nvda.approve(address(router), amountIn + collateralIn);
        vm.expectRevert();
        vm.prank(user);
        router.executeHybrid(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, 500, deadline, proof);
        require(nvda.balanceOf(user) == 11e18, "NVDA transfer escaped revert");
        require(morpho.collateral(user) == 0, "collateral supply escaped revert");
    }

    function testOperationalLtvFailureRevertsBorrowAndSwap() public {
        (uint256 amountIn, uint256 collateralIn,,, uint256 deadline) = _sample();
        uint256 borrowAmount = 2_000e6;
        uint256 maxBorrow = 3_000e6;
        uint256 minOut = 220e6;
        bytes memory proof = _sign(amountIn, 1e18, collateralIn, borrowAmount, maxBorrow, minOut, deadline);
        vm.prank(user);
        nvda.approve(address(router), amountIn + collateralIn);
        vm.expectRevert();
        vm.prank(user);
        router.executeHybrid(amountIn, 1e18, collateralIn, borrowAmount, maxBorrow, minOut, 500, deadline, proof);
        require(nvda.balanceOf(user) == 11e18, "NVDA transfer escaped revert");
        require(usdg.balanceOf(user) == 0, "swap output escaped revert");
        require(morpho.collateral(user) == 0, "collateral supply escaped revert");
    }

    function testBorrowAboveSignedMaximumReverts() public {
        (uint256 amountIn, uint256 collateralIn, uint256 borrowAmount, uint256 minOut, uint256 deadline) = _sample();
        uint256 maxBorrow = borrowAmount - 1;
        bytes memory proof = _sign(amountIn, 1e18, collateralIn, borrowAmount, maxBorrow, minOut, deadline);
        vm.expectRevert();
        vm.prank(user);
        router.executeHybrid(amountIn, 1e18, collateralIn, borrowAmount, maxBorrow, minOut, 500, deadline, proof);
    }

    function testMorphoAuthorizationIsRequired() public {
        (uint256 amountIn, uint256 collateralIn, uint256 borrowAmount, uint256 minOut, uint256 deadline) = _sample();
        bytes memory proof = _sign(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, deadline);
        vm.prank(user);
        nvda.approve(address(router), amountIn + collateralIn);
        morpho.setAuthorized(user, false);
        vm.expectRevert();
        vm.prank(user);
        router.executeHybrid(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, 500, deadline, proof);
        require(nvda.balanceOf(user) == 11e18, "NVDA transfer escaped authorization failure");
    }

    function testUnallowlistedFeeTierReverts() public {
        (uint256 amountIn, uint256 collateralIn, uint256 borrowAmount, uint256 minOut, uint256 deadline) = _sample();
        vm.expectRevert();
        vm.prank(user);
        router.executeHybrid(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, 10_000, deadline, "");
    }

    function testPausedNvdaOracleBlocksExecution() public {
        (uint256 amountIn, uint256 collateralIn, uint256 borrowAmount, uint256 minOut, uint256 deadline) = _sample();
        bytes memory proof = _sign(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, deadline);
        vm.prank(user);
        nvda.approve(address(router), amountIn + collateralIn);
        nvda.setPaused(true);
        vm.expectRevert();
        vm.prank(user);
        router.executeHybrid(amountIn, 1e18, collateralIn, borrowAmount, 600e6, minOut, 500, deadline, proof);
        require(nvda.balanceOf(user) == 11e18, "NVDA transfer escaped paused-oracle failure");
    }

    function _sample() private view returns (uint256, uint256, uint256, uint256, uint256) {
        return (1e18, 10e18, 500e6, 220e6, block.timestamp + 60);
    }

    function _sign(
        uint256 amountIn,
        uint256 maxSell,
        uint256 collateralIn,
        uint256 borrowAmount,
        uint256 maxBorrow,
        uint256 minOut,
        uint256 deadline
    ) private returns (bytes memory) {
        bytes32 digest = router.executionDigest(
            user, amountIn, maxSell, collateralIn, borrowAmount, maxBorrow, minOut, 500, deadline
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }
}
