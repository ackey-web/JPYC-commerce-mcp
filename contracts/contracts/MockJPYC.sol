// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

// テスト専用モック JPYC（ERC-20 + EIP-3009 stub）
// 本番デプロイには使用しないこと

contract MockJPYC {
    string public name     = "Mock JPYC";
    string public symbol   = "mJPYC";
    uint8  public decimals = 18;

    mapping(address => uint256)                      public balanceOf;
    mapping(address => mapping(address => uint256))  public allowance;
    // EIP-3009: nonce 使用済み管理
    mapping(address => mapping(bytes32 => bool))     public authorizationState;

    uint256 public totalSupply;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply   += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "InsufficientBalance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to]         += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "InsufficientBalance");
        require(allowance[from][msg.sender] >= amount, "InsufficientAllowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]            -= amount;
        balanceOf[to]              += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    // EIP-3009 stub: 署名検証はスキップ（テスト用）
    // 実際の JPYC v2 は EIP-712 署名を検証する
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8   /*v*/,
        bytes32 /*r*/,
        bytes32 /*s*/
    ) external {
        require(block.timestamp > validAfter,  "AuthNotYetValid");
        require(block.timestamp < validBefore, "AuthExpired");
        require(!authorizationState[from][nonce], "AuthAlreadyUsed");
        require(balanceOf[from] >= value, "InsufficientBalance");

        authorizationState[from][nonce] = true;
        balanceOf[from] -= value;
        balanceOf[to]   += value;
        emit Transfer(from, to, value);
        emit AuthorizationUsed(from, nonce);
    }
}
