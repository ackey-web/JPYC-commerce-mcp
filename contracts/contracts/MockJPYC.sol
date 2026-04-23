// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title MockJPYC
 * @notice テスト専用 JPYC v2 互換トークン（ERC-20 + EIP-3009 署名検証付き）
 * @dev domain: name="JPY Coin", version="1" で JPYC v2 mainnet と同一の EIP-712 ドメイン
 *      本番デプロイには使用しないこと
 */
contract MockJPYC {
    using ECDSA for bytes32;

    // ─── ERC-20 メタデータ ───────────────────────────────────────────────────
    string public constant name     = "JPY Coin";
    string public constant symbol   = "JPYC";
    uint8  public constant decimals = 18;
    string public constant version  = "1";

    // ─── EIP-712 ─────────────────────────────────────────────────────────────
    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    // ─── ERC-20 ステート ─────────────────────────────────────────────────────
    uint256 public totalSupply;
    mapping(address => uint256)                     public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    // ─── EIP-3009: nonce 使用済み管理 ────────────────────────────────────────
    mapping(address => mapping(bytes32 => bool)) private _authState;

    // ─── イベント ─────────────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    constructor() {
        uint256 chainId;
        assembly { chainId := chainid() }
        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256(bytes(name)),
            keccak256(bytes(version)),
            chainId,
            address(this)
        ));
    }

    // ─── ERC-20 ──────────────────────────────────────────────────────────────

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
        require(balanceOf[from]              >= amount, "InsufficientBalance");
        require(allowance[from][msg.sender]  >= amount, "InsufficientAllowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from]             -= amount;
        balanceOf[to]               += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    // ─── EIP-3009 ─────────────────────────────────────────────────────────────

    /**
     * @notice EIP-3009 transferWithAuthorization（本番 JPYC v2 と同一の署名検証）
     * @param from        送金元（EIP-712 署名者）
     * @param to          送金先
     * @param value       送金額
     * @param validAfter  署名有効開始時刻（UNIX timestamp）
     * @param validBefore 署名有効期限（UNIX timestamp）
     * @param nonce       使い捨て nonce（bytes32）
     * @param v r s       EIP-712 署名
     */
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8   v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp > validAfter,     "AuthNotYetValid");
        require(block.timestamp < validBefore,    "AuthExpired");
        require(!_authState[from][nonce],         "AuthAlreadyUsed");
        require(balanceOf[from] >= value,         "InsufficientBalance");

        bytes32 structHash = keccak256(abi.encode(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
            from,
            to,
            value,
            validAfter,
            validBefore,
            nonce
        ));
        bytes32 digest = MessageHashUtils.toTypedDataHash(DOMAIN_SEPARATOR, structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == from, "InvalidSignature");

        _authState[from][nonce] = true;
        balanceOf[from] -= value;
        balanceOf[to]   += value;
        emit Transfer(from, to, value);
        emit AuthorizationUsed(from, nonce);
    }

    /**
     * @notice nonce の使用済み状態を確認する
     */
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
        return _authState[authorizer][nonce];
    }
}
