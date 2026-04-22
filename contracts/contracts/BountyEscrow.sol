// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BountyEscrow
 * @notice JPYC Commerce MCP — エージェント間バウンティ決済エスクロー
 *
 * @dev 設計原則（絶対厳守）:
 *   - ノンカストディアル最大強度: admin withdraw 関数は存在しない
 *   - immutable コントラクト: upgradeable proxy 禁止
 *   - protocolFeeBps = 0 で固定（変更は新コントラクトデプロイ方式）
 *   - pause は 48 時間タイムロック遅延（緊急時のみ）
 *   - dispute/仲裁: Phase 0+ では未実装（期限失効による自動解決のみ）
 *   - EIP-3009 対応: JPYC v2 transferWithAuthorization でガスレス送金
 *
 * ステートマシン:
 *   OPEN → ASSIGNED → SUBMITTED → CONFIRMED → RELEASED
 *                               ↓ (CLAIM_TIMEOUT 後)
 *                           AUTO_RELEASED
 *
 * MCP との役割分担:
 *   MCP サーバー: calldata を生成して返すのみ（秘密鍵を保有しない）
 *   ユーザー: 自分のウォレットで署名・ブロードキャスト
 *   このコントラクト: ルールに基づき JPYC を保管・解放する
 */
contract BountyEscrow is ReentrancyGuard {

    // ─── 定数 ─────────────────────────────────────────────────────────────────

    /// @notice 納品後に確認がない場合、ワーカーが自動払出できるまでの期間
    uint64 public constant CLAIM_TIMEOUT = 90 days;

    /// @notice pause 有効化に必要なタイムロック（緊急時のみ使用）
    uint64 public constant PAUSE_TIMELOCK = 48 hours;

    /// @notice プロトコルフィー = 0（immutable 固定、変更は新コントラクトデプロイ）
    uint256 public constant PROTOCOL_FEE_BPS = 0;

    // ─── immutable ────────────────────────────────────────────────────────────

    /// @notice 決済トークン（JPYC v2 on Polygon）
    address public immutable jpyc;

    /// @notice コントラクト管理者（multisig 推奨、pause タイムロック発動権限のみ）
    address public immutable admin;

    // ─── ステート ─────────────────────────────────────────────────────────────

    enum JobStatus {
        OPEN,          // バウンティ公開中
        ASSIGNED,      // ワーカー決定済み
        SUBMITTED,     // 成果物提出済み（CLAIM_TIMEOUT タイムロック開始）
        RELEASED,      // 支払い完了（confirmDelivery 経由）
        AUTO_RELEASED  // タイムロック経過による自動払出
    }

    /// @dev storage packing: client+worker は address(20B)、amount は uint128(16B) で 1 slot に収める
    struct Job {
        address client;
        address worker;          // address(0) = 未アサイン
        uint128 amount;          // JPYC デポジット額（JPYC は 18 decimals、uint128 で ~3.4×10^20 まで対応）
        uint64  submittedAt;     // submitDeliverable 時刻（タイムロック起点）
        uint64  createdAt;
        JobStatus status;
        bytes32 deliverableHash; // 成果物ハッシュ（IPFS CID 等）
    }

    struct Bid {
        address bidder;
        uint128 bidAmount;    // 提示金額（参考値）
        bytes32 proposalHash; // 提案内容ハッシュ
        bool    accepted;
    }

    /// @dev jobKey（bytes32）=> 内部 jobId（uint64）、0 = 存在しない
    mapping(bytes32 => uint64) private _keyToId;

    /// @dev 内部 jobId => Job
    mapping(uint64 => Job) public jobs;

    /// @dev bidId（uint64）=> Bid
    mapping(uint64 => Bid) public bids;

    /// @dev jobId => アサイン済み bidId
    mapping(uint64 => uint64) public assignedBid;

    uint64 private _nextJobId;
    uint64 private _nextBidId;

    // ─── pause タイムロック ────────────────────────────────────────────────────

    bool    public paused;
    bool    public pauseScheduled;
    uint64  public pauseScheduledAt; // 0 = スケジュールなし

    // ─── カスタムエラー（Gas 最適化: string より安い）────────────────────────

    error NotAdmin();
    error ContractPaused();
    error ContractNotPaused();
    error PauseNotScheduled();
    error PauseTimelockActive(uint64 availableAt);
    error JobNotFound(bytes32 jobKey);
    error JobAlreadyExists(bytes32 jobKey);
    error InvalidStatus(uint64 jobId, JobStatus current);
    error NotClient(uint64 jobId);
    error NotWorker(uint64 jobId);
    error BidNotFound(uint64 bidId);
    error ClaimTimelockActive(uint64 jobId, uint64 availableAt);
    error ZeroAmount();
    error TransferFailed();

    // ─── イベント ─────────────────────────────────────────────────────────────

    event BountyOpened(uint64 indexed jobId, bytes32 indexed jobKey, address indexed client, uint128 amount);
    event BidSubmitted(uint64 indexed bidId, uint64 indexed jobId, address indexed bidder, uint128 bidAmount);
    event BidAccepted(uint64 indexed jobId, uint64 indexed bidId, address worker);
    event DeliverableSubmitted(uint64 indexed jobId, address indexed worker, bytes32 deliverableHash);
    event DeliveryConfirmed(uint64 indexed jobId, address indexed worker, uint128 amount);
    event AutoReleased(uint64 indexed jobId, address indexed worker, uint128 amount, uint64 claimedAt);
    event PauseScheduled(uint64 availableAt);
    event PauseCancelled();
    event PauseActivated();
    event Unpaused();

    // ─── Modifier ─────────────────────────────────────────────────────────────

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier onlyInStatus(uint64 jobId, JobStatus expected) {
        if (jobs[jobId].status != expected) revert InvalidStatus(jobId, jobs[jobId].status);
        _;
    }

    // ─── コンストラクタ ────────────────────────────────────────────────────────

    /**
     * @param _admin 管理者アドレス（multisig 推奨、pause タイムロック発動のみ）
     * @param _jpyc  JPYC v2 コントラクトアドレス（Polygon mainnet / Amoy testnet）
     */
    constructor(address _admin, address _jpyc) {
        require(_admin != address(0), "ZeroAdmin");
        require(_jpyc  != address(0), "ZeroJPYC");
        admin = _admin;
        jpyc  = _jpyc;
        _nextJobId = 1;
        _nextBidId = 1;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // デポジット / バウンティ開設
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice EIP-3009 transferWithAuthorization でガスレスデポジット＆バウンティ開設
     * @dev JPYC v2 が EIP-3009 を実装していることをデプロイ前に Amoy で確認すること
     * @param jobKey      クライアント指定の一意キー（keccak256(clientAddr, nonce) 推奨）
     * @param amount      デポジット額（JPYC 最小単位、1 JPYC = 1e18）
     * @param validAfter  EIP-3009 署名有効開始時刻
     * @param validBefore EIP-3009 署名有効期限
     * @param nonce3009   EIP-3009 nonce（署名ごとに一意、JPYC 側で使用済みチェック）
     * @param v r s       EIP-712 署名
     */
    function depositWithAuthorization(
        bytes32 jobKey,
        uint128 amount,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce3009,
        uint8   v,
        bytes32 r,
        bytes32 s
    ) external whenNotPaused returns (uint64 jobId) {
        if (amount == 0) revert ZeroAmount();
        if (_keyToId[jobKey] != 0) revert JobAlreadyExists(jobKey);

        // EIP-3009: クライアント → このコントラクトへ JPYC を移送
        IEIP3009(jpyc).transferWithAuthorization(
            msg.sender, address(this), amount,
            validAfter, validBefore, nonce3009,
            v, r, s
        );

        jobId = _createJob(jobKey, msg.sender, amount);
        emit BountyOpened(jobId, jobKey, msg.sender, amount);
    }

    /**
     * @notice 通常 approve → transferFrom 経由でデポジット（EIP-3009 非対応環境向け）
     * @dev 事前に `jpyc.approve(address(this), amount)` が必要
     */
    function openBounty(
        bytes32 jobKey,
        uint128 amount
    ) external whenNotPaused returns (uint64 jobId) {
        if (amount == 0) revert ZeroAmount();
        if (_keyToId[jobKey] != 0) revert JobAlreadyExists(jobKey);

        _safeTransferFrom(msg.sender, address(this), amount);

        jobId = _createJob(jobKey, msg.sender, amount);
        emit BountyOpened(jobId, jobKey, msg.sender, amount);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 入札・アサイン
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice バウンティに入札する（OPEN 状態）
     * @param jobKey      対象バウンティの一意キー
     * @param bidAmount   提示金額（参考値、実際の支払いは Job.amount 全額）
     * @param proposalHash 提案内容ハッシュ（IPFS CID 等）
     */
    function submitBid(
        bytes32 jobKey,
        uint128 bidAmount,
        bytes32 proposalHash
    ) external whenNotPaused returns (uint64 bidId) {
        uint64 jobId = _requireJobId(jobKey);
        if (jobs[jobId].status != JobStatus.OPEN) revert InvalidStatus(jobId, jobs[jobId].status);

        bidId = _nextBidId++;
        bids[bidId] = Bid({
            bidder:       msg.sender,
            bidAmount:    bidAmount,
            proposalHash: proposalHash,
            accepted:     false
        });
        emit BidSubmitted(bidId, jobId, msg.sender, bidAmount);
    }

    /**
     * @notice クライアントが入札を受諾し、ワーカーをアサインする（OPEN → ASSIGNED）
     */
    function acceptBid(bytes32 jobKey, uint64 bidId)
        external
        nonReentrant
        whenNotPaused
    {
        uint64 jobId = _requireJobId(jobKey);
        Job storage j = jobs[jobId];

        if (j.status != JobStatus.OPEN)       revert InvalidStatus(jobId, j.status);
        if (msg.sender != j.client)            revert NotClient(jobId);
        if (bids[bidId].bidder == address(0))  revert BidNotFound(bidId);

        // Effects
        bids[bidId].accepted = true;
        j.worker             = bids[bidId].bidder;
        j.status             = JobStatus.ASSIGNED;
        assignedBid[jobId]   = bidId;

        emit BidAccepted(jobId, bidId, j.worker);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 成果物提出・確認・払出
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice ワーカーが成果物を提出する（ASSIGNED → SUBMITTED）
     * @dev submittedAt を記録し、CLAIM_TIMEOUT タイムロックを起動する
     * @param deliverableHash 成果物ハッシュ（IPFS CID、GitHub PR URL のハッシュ等）
     */
    function submitDeliverable(bytes32 jobKey, bytes32 deliverableHash)
        external
        whenNotPaused
    {
        uint64 jobId = _requireJobId(jobKey);
        Job storage j = jobs[jobId];

        if (j.status != JobStatus.ASSIGNED) revert InvalidStatus(jobId, j.status);
        if (msg.sender != j.worker)         revert NotWorker(jobId);

        // Effects
        j.status          = JobStatus.SUBMITTED;
        j.submittedAt     = uint64(block.timestamp);
        j.deliverableHash = deliverableHash;

        emit DeliverableSubmitted(jobId, msg.sender, deliverableHash);
    }

    /**
     * @notice クライアントが成果物を確認し、JPYC をワーカーに解放する（SUBMITTED → RELEASED）
     * @dev CEI パターン厳守。nonReentrant で二重払い防止。
     */
    function confirmDelivery(bytes32 jobKey)
        external
        nonReentrant
        whenNotPaused
    {
        uint64 jobId = _requireJobId(jobKey);
        Job storage j = jobs[jobId];

        if (j.status != JobStatus.SUBMITTED) revert InvalidStatus(jobId, j.status);
        if (msg.sender != j.client)          revert NotClient(jobId);

        // Effects（Interaction より前）
        j.status = JobStatus.RELEASED;
        uint128 amount = j.amount;
        address worker = j.worker;

        // Interaction
        _safeTransfer(worker, amount);
        emit DeliveryConfirmed(jobId, worker, amount);
    }

    /**
     * @notice CLAIM_TIMEOUT（90日）経過後、ワーカーが自動払出を請求する（SUBMITTED → AUTO_RELEASED）
     * @dev 人間仲裁なし。クライアントが期限内に confirmDelivery しない場合に発動。
     *      pause 中でも claimExpired は実行可能（ワーカー保護）。
     */
    function claimExpired(bytes32 jobKey)
        external
        nonReentrant
    {
        uint64 jobId = _requireJobId(jobKey);
        Job storage j = jobs[jobId];

        if (j.status != JobStatus.SUBMITTED) revert InvalidStatus(jobId, j.status);
        if (msg.sender != j.worker)          revert NotWorker(jobId);

        uint64 availableAt = j.submittedAt + CLAIM_TIMEOUT;
        if (block.timestamp < availableAt)   revert ClaimTimelockActive(jobId, availableAt);

        // Effects
        j.status = JobStatus.AUTO_RELEASED;
        uint128 amount = j.amount;
        address worker = j.worker;

        // Interaction
        _safeTransfer(worker, amount);
        emit AutoReleased(jobId, worker, amount, uint64(block.timestamp));
    }

    // ──────────────────────────────────────────────────────────────────────────
    // pause タイムロック（48時間遅延、緊急時のみ）
    // ──────────────────────────────────────────────────────────────────────────

    /**
     * @notice pause を 48時間後に有効化するようスケジュールする
     * @dev admin（multisig 推奨）が発動。SUBMITTED 状態のジョブは claimExpired で保護。
     */
    function schedulePause() external onlyAdmin {
        pauseScheduledAt = uint64(block.timestamp) + PAUSE_TIMELOCK;
        pauseScheduled   = true;
        emit PauseScheduled(pauseScheduledAt);
    }

    /// @notice スケジュール済みの pause をキャンセルする
    function cancelScheduledPause() external onlyAdmin {
        pauseScheduled   = false;
        pauseScheduledAt = 0;
        emit PauseCancelled();
    }

    /// @notice タイムロック経過後に pause を有効化する
    function activatePause() external onlyAdmin {
        if (!pauseScheduled)                    revert PauseNotScheduled();
        if (block.timestamp < pauseScheduledAt) revert PauseTimelockActive(pauseScheduledAt);
        paused           = true;
        pauseScheduled   = false;
        pauseScheduledAt = 0;
        emit PauseActivated();
    }

    /// @notice pause を解除する
    function unpause() external onlyAdmin {
        if (!paused) revert ContractNotPaused();
        paused = false;
        emit Unpaused();
    }

    // ──────────────────────────────────────────────────────────────────────────
    // ビュー
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice jobKey から Job を取得する
    function getJob(bytes32 jobKey) external view returns (Job memory) {
        return jobs[_requireJobId(jobKey)];
    }

    /// @notice jobKey から 内部 jobId を取得する（0 = 存在しない）
    function getJobId(bytes32 jobKey) external view returns (uint64) {
        return _keyToId[jobKey];
    }

    /**
     * @notice claimExpired が実行可能になる時刻を返す
     * @return 0 = SUBMITTED 状態でない、または存在しない jobKey
     */
    function claimAvailableAt(bytes32 jobKey) external view returns (uint64) {
        uint64 jobId = _keyToId[jobKey];
        if (jobId == 0) return 0;
        Job storage j = jobs[jobId];
        if (j.status != JobStatus.SUBMITTED) return 0;
        return j.submittedAt + CLAIM_TIMEOUT;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 内部ヘルパー
    // ──────────────────────────────────────────────────────────────────────────

    function _createJob(bytes32 jobKey, address client, uint128 amount)
        internal returns (uint64 jobId)
    {
        jobId = _nextJobId++;
        jobs[jobId] = Job({
            client:          client,
            worker:          address(0),
            amount:          amount,
            submittedAt:     0,
            createdAt:       uint64(block.timestamp),
            status:          JobStatus.OPEN,
            deliverableHash: bytes32(0)
        });
        _keyToId[jobKey] = jobId;
    }

    function _requireJobId(bytes32 jobKey) internal view returns (uint64 jobId) {
        jobId = _keyToId[jobKey];
        if (jobId == 0) revert JobNotFound(jobKey);
    }

    /// @dev ERC-20 safeTransfer（return value チェック付き、OZ SafeERC20 相当）
    function _safeTransfer(address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            jpyc.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    /// @dev ERC-20 safeTransferFrom
    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            jpyc.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}

// ─── EIP-3009 インターフェース ────────────────────────────────────────────────
// JPYC v2 (Polygon mainnet 0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB / Amoy) が実装
// デプロイ前に Amoy で transferWithAuthorization の動作確認を行うこと

interface IEIP3009 {
    /**
     * @param from        送金元（EIP-712 署名者）
     * @param to          送金先（このコントラクト）
     * @param value       送金額
     * @param validAfter  署名有効開始時刻
     * @param validBefore 署名有効期限
     * @param nonce       使い捨て nonce（JPYC 側で再利用リジェクト）
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
    ) external;
}
