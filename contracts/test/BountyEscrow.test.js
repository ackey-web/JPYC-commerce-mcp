import { expect } from 'chai';
import hre from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';

const { ethers } = hre;

// ─── テスト定数 ───────────────────────────────────────────────────────────────

const AMOUNT        = ethers.parseUnits('500', 18); // 500 JPYC
const JOB_KEY       = ethers.keccak256(ethers.toUtf8Bytes('job-1'));
const JOB_KEY_2     = ethers.keccak256(ethers.toUtf8Bytes('job-2'));
const PROPOSAL_HASH = ethers.keccak256(ethers.toUtf8Bytes('proposal-ipfs-cid'));
const DELIVERABLE   = ethers.keccak256(ethers.toUtf8Bytes('deliverable-ipfs-cid'));
const CLAIM_TIMEOUT = 90 * 24 * 60 * 60; // 90日（秒）
const PAUSE_TIMELOCK = 48 * 60 * 60;     // 48時間（秒）

// JobStatus 列挙値（コントラクトと同じ順序）
const JobStatus = { OPEN: 0n, ASSIGNED: 1n, SUBMITTED: 2n, RELEASED: 3n, AUTO_RELEASED: 4n, CANCELLED: 5n };

// ─── フィクスチャ ─────────────────────────────────────────────────────────────

async function deployFixture() {
  const [admin, client, worker, attacker, other] = await ethers.getSigners();

  const MockJPYC = await ethers.getContractFactory('MockJPYC');
  const jpyc = await MockJPYC.deploy();
  await jpyc.waitForDeployment();

  const BountyEscrow = await ethers.getContractFactory('BountyEscrow');
  const escrow = await BountyEscrow.deploy(admin.address, await jpyc.getAddress());
  await escrow.waitForDeployment();

  // client に 10,000 JPYC を mint して approve
  await jpyc.mint(client.address, ethers.parseUnits('10000', 18));
  await jpyc.connect(client).approve(await escrow.getAddress(), ethers.MaxUint256);

  return { escrow, jpyc, admin, client, worker, attacker, other };
}

// ─── ヘルパー: openBounty まで進める ─────────────────────────────────────────

async function openJob(escrow, client, jobKey = JOB_KEY) {
  const tx = await escrow.connect(client).openBounty(jobKey, AMOUNT);
  await tx.wait();
}

// ─── ヘルパー: ASSIGNED まで進める ───────────────────────────────────────────

async function assignJob(escrow, jpyc, client, worker, jobKey = JOB_KEY) {
  await openJob(escrow, client, jobKey);
  const bidTx = await escrow.connect(worker).submitBid(jobKey, AMOUNT, PROPOSAL_HASH);
  const bidReceipt = await bidTx.wait();
  // BidSubmitted イベントから bidId を取得
  const bidEvent = bidReceipt.logs.find(l => {
    try { return escrow.interface.parseLog(l).name === 'BidSubmitted'; } catch { return false; }
  });
  const bidId = escrow.interface.parseLog(bidEvent).args.bidId;
  await escrow.connect(client).acceptBid(jobKey, bidId);
  return bidId;
}

// ─── ヘルパー: SUBMITTED まで進める ──────────────────────────────────────────

async function submitJob(escrow, jpyc, client, worker, jobKey = JOB_KEY) {
  await assignJob(escrow, jpyc, client, worker, jobKey);
  await escrow.connect(worker).submitDeliverable(jobKey, DELIVERABLE);
}

// ─────────────────────────────────────────────────────────────────────────────
// テストスイート
// ─────────────────────────────────────────────────────────────────────────────

describe('BountyEscrow', function () {

  // ── 1. デプロイ ────────────────────────────────────────────────────────────

  describe('deployment', function () {
    it('admin と jpyc が immutable に設定される', async function () {
      const { escrow, jpyc, admin } = await deployFixture();
      expect(await escrow.admin()).to.equal(admin.address);
      expect(await escrow.jpyc()).to.equal(await jpyc.getAddress());
    });

    it('PROTOCOL_FEE_BPS は 0 固定', async function () {
      const { escrow } = await deployFixture();
      expect(await escrow.PROTOCOL_FEE_BPS()).to.equal(0n);
    });

    it('CLAIM_TIMEOUT は 90 日', async function () {
      const { escrow } = await deployFixture();
      expect(await escrow.CLAIM_TIMEOUT()).to.equal(BigInt(CLAIM_TIMEOUT));
    });

    it('PAUSE_TIMELOCK は 48 時間', async function () {
      const { escrow } = await deployFixture();
      expect(await escrow.PAUSE_TIMELOCK()).to.equal(BigInt(PAUSE_TIMELOCK));
    });

    it('admin withdraw 関数が存在しない（ノンカストディアル検証）', async function () {
      const { escrow } = await deployFixture();
      expect(escrow.interface.getFunction('adminWithdraw')).to.be.null;
      expect(escrow.interface.getFunction('withdraw')).to.be.null;
      expect(escrow.interface.getFunction('emergencyWithdraw')).to.be.null;
    });

    it('ゼロアドレスの admin / jpyc は revert', async function () {
      const BountyEscrow = await ethers.getContractFactory('BountyEscrow');
      const [admin] = await ethers.getSigners();
      const MockJPYC = await ethers.getContractFactory('MockJPYC');
      const jpyc = await MockJPYC.deploy();
      await jpyc.waitForDeployment();

      await expect(BountyEscrow.deploy(ethers.ZeroAddress, await jpyc.getAddress()))
        .to.be.revertedWith('ZeroAdmin');
      await expect(BountyEscrow.deploy(admin.address, ethers.ZeroAddress))
        .to.be.revertedWith('ZeroJPYC');
    });
  });

  // ── 2. openBounty (approve フォールバック) ──────────────────────────────────

  describe('openBounty', function () {
    it('JPYC をエスクローに移送し OPEN ステータスで Job を作成する', async function () {
      const { escrow, jpyc, client } = await deployFixture();
      const escrowAddr = await escrow.getAddress();
      const before = await jpyc.balanceOf(escrowAddr);

      await expect(escrow.connect(client).openBounty(JOB_KEY, AMOUNT))
        .to.emit(escrow, 'BountyOpened')
        .withArgs(1n, JOB_KEY, client.address, AMOUNT);

      expect(await jpyc.balanceOf(escrowAddr)).to.equal(before + AMOUNT);
      const job = await escrow.getJob(JOB_KEY);
      expect(job.status).to.equal(JobStatus.OPEN);
      expect(job.client).to.equal(client.address);
      expect(job.amount).to.equal(AMOUNT);
    });

    it('amount = 0 は ZeroAmount で revert', async function () {
      const { escrow, client } = await deployFixture();
      await expect(escrow.connect(client).openBounty(JOB_KEY, 0n))
        .to.be.revertedWithCustomError(escrow, 'ZeroAmount');
    });

    it('同一 jobKey の重複は JobAlreadyExists で revert', async function () {
      const { escrow, client } = await deployFixture();
      await openJob(escrow, client);
      await expect(escrow.connect(client).openBounty(JOB_KEY, AMOUNT))
        .to.be.revertedWithCustomError(escrow, 'JobAlreadyExists')
        .withArgs(JOB_KEY);
    });

    it('pause 中は ContractPaused で revert', async function () {
      const { escrow, admin, client } = await deployFixture();
      await escrow.connect(admin).schedulePause();
      await time.increase(PAUSE_TIMELOCK + 1);
      await escrow.connect(admin).activatePause();
      await expect(escrow.connect(client).openBounty(JOB_KEY, AMOUNT))
        .to.be.revertedWithCustomError(escrow, 'ContractPaused');
    });
  });

  // ── 3. depositWithAuthorization (EIP-3009) ─────────────────────────────────

  describe('depositWithAuthorization (EIP-3009)', function () {
    it('EIP-3009 署名なしスタブで JPYC をデポジットし Job を作成する', async function () {
      const { escrow, jpyc, client } = await deployFixture();
      const escrowAddr = await escrow.getAddress();
      const nonce = ethers.keccak256(ethers.toUtf8Bytes('nonce-1'));
      const now = BigInt(await time.latest());
      const validAfter  = now - 1n;
      const validBefore = now + 3600n;

      await expect(
        escrow.connect(client).depositWithAuthorization(
          JOB_KEY, AMOUNT,
          validAfter, validBefore, nonce,
          0, ethers.ZeroHash, ethers.ZeroHash
        )
      ).to.emit(escrow, 'BountyOpened').withArgs(1n, JOB_KEY, client.address, AMOUNT);

      expect(await jpyc.balanceOf(escrowAddr)).to.equal(AMOUNT);
    });

    it('期限切れ署名（validBefore 過去）は AuthExpired で revert', async function () {
      const { escrow, client } = await deployFixture();
      const nonce = ethers.keccak256(ethers.toUtf8Bytes('nonce-expired'));
      const now = BigInt(await time.latest());

      await expect(
        escrow.connect(client).depositWithAuthorization(
          JOB_KEY, AMOUNT,
          0n, now - 1n, nonce,  // validBefore = 過去
          0, ethers.ZeroHash, ethers.ZeroHash
        )
      ).to.be.revertedWith('AuthExpired');
    });

    it('同一 nonce の再利用は AuthAlreadyUsed で revert', async function () {
      const { escrow, jpyc, client } = await deployFixture();
      // 追加 mint と approve
      await jpyc.mint(client.address, AMOUNT);
      const nonce = ethers.keccak256(ethers.toUtf8Bytes('nonce-dup'));
      const now = BigInt(await time.latest());
      const va = now - 1n, vb = now + 3600n;

      await escrow.connect(client).depositWithAuthorization(
        JOB_KEY, AMOUNT, va, vb, nonce, 0, ethers.ZeroHash, ethers.ZeroHash
      );
      // 2回目（別 jobKey でも nonce が使用済み）
      await expect(
        escrow.connect(client).depositWithAuthorization(
          JOB_KEY_2, AMOUNT, va, vb, nonce, 0, ethers.ZeroHash, ethers.ZeroHash
        )
      ).to.be.revertedWith('AuthAlreadyUsed');
    });
  });

  // ── 4. submitBid ──────────────────────────────────────────────────────────

  describe('submitBid', function () {
    it('OPEN 状態の Job に入札できる', async function () {
      const { escrow, client, worker } = await deployFixture();
      await openJob(escrow, client);
      await expect(escrow.connect(worker).submitBid(JOB_KEY, AMOUNT, PROPOSAL_HASH))
        .to.emit(escrow, 'BidSubmitted')
        .withArgs(1n, 1n, worker.address, AMOUNT);
      const bid = await escrow.bids(1n);
      expect(bid.bidder).to.equal(worker.address);
    });

    it('OPEN 以外の状態は InvalidStatus で revert', async function () {
      const { escrow, jpyc, client, worker } = await deployFixture();
      await assignJob(escrow, jpyc, client, worker);
      await expect(escrow.connect(worker).submitBid(JOB_KEY, AMOUNT, PROPOSAL_HASH))
        .to.be.revertedWithCustomError(escrow, 'InvalidStatus');
    });

    it('存在しない jobKey は JobNotFound で revert', async function () {
      const { escrow, worker } = await deployFixture();
      await expect(escrow.connect(worker).submitBid(JOB_KEY, AMOUNT, PROPOSAL_HASH))
        .to.be.revertedWithCustomError(escrow, 'JobNotFound').withArgs(JOB_KEY);
    });
  });

  // ── 5. acceptBid ──────────────────────────────────────────────────────────

  describe('acceptBid', function () {
    it('クライアントが入札を受諾し ASSIGNED に遷移する', async function () {
      const { escrow, jpyc, client, worker } = await deployFixture();
      await openJob(escrow, client);
      const bidTx = await escrow.connect(worker).submitBid(JOB_KEY, AMOUNT, PROPOSAL_HASH);
      const bidReceipt = await bidTx.wait();
      const bidEvent = bidReceipt.logs.find(l => {
        try { return escrow.interface.parseLog(l).name === 'BidSubmitted'; } catch { return false; }
      });
      const bidId = escrow.interface.parseLog(bidEvent).args.bidId;

      await expect(escrow.connect(client).acceptBid(JOB_KEY, bidId))
        .to.emit(escrow, 'BidAccepted').withArgs(1n, bidId, worker.address);

      const job = await escrow.getJob(JOB_KEY);
      expect(job.status).to.equal(JobStatus.ASSIGNED);
      expect(job.worker).to.equal(worker.address);
    });

    it('クライアント以外は NotClient で revert', async function () {
      const { escrow, client, worker, attacker } = await deployFixture();
      await openJob(escrow, client);
      const bidTx = await escrow.connect(worker).submitBid(JOB_KEY, AMOUNT, PROPOSAL_HASH);
      const bidReceipt = await bidTx.wait();
      const bidEvent = bidReceipt.logs.find(l => {
        try { return escrow.interface.parseLog(l).name === 'BidSubmitted'; } catch { return false; }
      });
      const bidId = escrow.interface.parseLog(bidEvent).args.bidId;

      await expect(escrow.connect(attacker).acceptBid(JOB_KEY, bidId))
        .to.be.revertedWithCustomError(escrow, 'NotClient');
    });

    it('存在しない bidId は BidNotFound で revert', async function () {
      const { escrow, client } = await deployFixture();
      await openJob(escrow, client);
      await expect(escrow.connect(client).acceptBid(JOB_KEY, 999n))
        .to.be.revertedWithCustomError(escrow, 'BidNotFound').withArgs(999n);
    });
  });

  // ── 6. submitDeliverable ──────────────────────────────────────────────────

  describe('submitDeliverable', function () {
    it('ワーカーが成果物を提出し SUBMITTED に遷移する', async function () {
      const { escrow, jpyc, client, worker } = await deployFixture();
      await assignJob(escrow, jpyc, client, worker);
      await expect(escrow.connect(worker).submitDeliverable(JOB_KEY, DELIVERABLE))
        .to.emit(escrow, 'DeliverableSubmitted').withArgs(1n, worker.address, DELIVERABLE);
      const job = await escrow.getJob(JOB_KEY);
      expect(job.status).to.equal(JobStatus.SUBMITTED);
      expect(job.deliverableHash).to.equal(DELIVERABLE);
      expect(job.submittedAt).to.be.gt(0n);
    });

    it('ワーカー以外は NotWorker で revert', async function () {
      const { escrow, jpyc, client, worker, attacker } = await deployFixture();
      await assignJob(escrow, jpyc, client, worker);
      await expect(escrow.connect(attacker).submitDeliverable(JOB_KEY, DELIVERABLE))
        .to.be.revertedWithCustomError(escrow, 'NotWorker');
    });

    it('ASSIGNED 以外の状態は InvalidStatus で revert', async function () {
      const { escrow, client } = await deployFixture();
      await openJob(escrow, client);
      await expect(escrow.connect(client).submitDeliverable(JOB_KEY, DELIVERABLE))
        .to.be.revertedWithCustomError(escrow, 'InvalidStatus');
    });
  });

  // ── 7. confirmDelivery ────────────────────────────────────────────────────

  describe('confirmDelivery', function () {
    it('クライアントが確認し JPYC がワーカーに支払われる', async function () {
      const { escrow, jpyc, client, worker } = await deployFixture();
      await submitJob(escrow, jpyc, client, worker);
      const workerBefore = await jpyc.balanceOf(worker.address);

      await expect(escrow.connect(client).confirmDelivery(JOB_KEY))
        .to.emit(escrow, 'DeliveryConfirmed').withArgs(1n, worker.address, AMOUNT);

      expect(await jpyc.balanceOf(worker.address)).to.equal(workerBefore + AMOUNT);
      expect(await jpyc.balanceOf(await escrow.getAddress())).to.equal(0n);
      const job = await escrow.getJob(JOB_KEY);
      expect(job.status).to.equal(JobStatus.RELEASED);
    });

    it('クライアント以外は NotClient で revert', async function () {
      const { escrow, jpyc, client, worker, attacker } = await deployFixture();
      await submitJob(escrow, jpyc, client, worker);
      await expect(escrow.connect(attacker).confirmDelivery(JOB_KEY))
        .to.be.revertedWithCustomError(escrow, 'NotClient');
    });

    it('二重 confirmDelivery は InvalidStatus で revert', async function () {
      const { escrow, jpyc, client, worker } = await deployFixture();
      await submitJob(escrow, jpyc, client, worker);
      await escrow.connect(client).confirmDelivery(JOB_KEY);
      await expect(escrow.connect(client).confirmDelivery(JOB_KEY))
        .to.be.revertedWithCustomError(escrow, 'InvalidStatus');
    });

    it('SUBMITTED 以外は InvalidStatus で revert', async function () {
      const { escrow, jpyc, client, worker } = await deployFixture();
      await assignJob(escrow, jpyc, client, worker); // ASSIGNED 状態
      await expect(escrow.connect(client).confirmDelivery(JOB_KEY))
        .to.be.revertedWithCustomError(escrow, 'InvalidStatus');
    });
  });

  // ── 8. claimExpired (90日タイムロック) ────────────────────────────────────

  describe('claimExpired', function () {
    it('90日後にワーカーが自動払出できる', async function () {
      const { escrow, jpyc, client, worker } = await deployFixture();
      await submitJob(escrow, jpyc, client, worker);
      const workerBefore = await jpyc.balanceOf(worker.address);

      await time.increase(CLAIM_TIMEOUT + 1);

      await expect(escrow.connect(worker).claimExpired(JOB_KEY))
        .to.emit(escrow, 'AutoReleased');

      expect(await jpyc.balanceOf(worker.address)).to.equal(workerBefore + AMOUNT);
      const job = await escrow.getJob(JOB_KEY);
      expect(job.status).to.equal(JobStatus.AUTO_RELEASED);
    });

    it('90日未満は ClaimTimelockActive で revert', async function () {
      const { escrow, jpyc, client, worker } = await deployFixture();
      await submitJob(escrow, jpyc, client, worker);
      await time.increase(CLAIM_TIMEOUT - 10);
      await expect(escrow.connect(worker).claimExpired(JOB_KEY))
        .to.be.revertedWithCustomError(escrow, 'ClaimTimelockActive');
    });

    it('ワーカー以外は NotWorker で revert', async function () {
      const { escrow, jpyc, client, worker, attacker } = await deployFixture();
      await submitJob(escrow, jpyc, client, worker);
      await time.increase(CLAIM_TIMEOUT + 1);
      await expect(escrow.connect(attacker).claimExpired(JOB_KEY))
        .to.be.revertedWithCustomError(escrow, 'NotWorker');
    });

    it('pause 中でも claimExpired は実行可能（ワーカー保護）', async function () {
      const { escrow, jpyc, admin, client, worker } = await deployFixture();
      await submitJob(escrow, jpyc, client, worker);
      await time.increase(CLAIM_TIMEOUT + 1);

      // pause を有効化
      await escrow.connect(admin).schedulePause();
      await time.increase(PAUSE_TIMELOCK + 1);
      await escrow.connect(admin).activatePause();
      expect(await escrow.paused()).to.be.true;

      // pause 中でも claimExpired は成功する
      await expect(escrow.connect(worker).claimExpired(JOB_KEY))
        .to.emit(escrow, 'AutoReleased');
    });

    it('claimAvailableAt がタイムロック終了時刻を返す', async function () {
      const { escrow, jpyc, client, worker } = await deployFixture();
      await submitJob(escrow, jpyc, client, worker);
      const job = await escrow.getJob(JOB_KEY);
      const expectedAt = job.submittedAt + BigInt(CLAIM_TIMEOUT);
      expect(await escrow.claimAvailableAt(JOB_KEY)).to.equal(expectedAt);
    });
  });

  // ── 9. pause タイムロック ─────────────────────────────────────────────────

  describe('pause timelock', function () {
    it('schedulePause → 48時間後 → activatePause の順で有効化できる', async function () {
      const { escrow, admin } = await deployFixture();
      await expect(escrow.connect(admin).schedulePause())
        .to.emit(escrow, 'PauseScheduled');

      await time.increase(PAUSE_TIMELOCK + 1);
      await expect(escrow.connect(admin).activatePause())
        .to.emit(escrow, 'PauseActivated');

      expect(await escrow.paused()).to.be.true;
    });

    it('タイムロック前の activatePause は PauseTimelockActive で revert', async function () {
      const { escrow, admin } = await deployFixture();
      await escrow.connect(admin).schedulePause();
      await time.increase(PAUSE_TIMELOCK - 10);
      await expect(escrow.connect(admin).activatePause())
        .to.be.revertedWithCustomError(escrow, 'PauseTimelockActive');
    });

    it('schedulePause なしの activatePause は PauseNotScheduled で revert', async function () {
      const { escrow, admin } = await deployFixture();
      await expect(escrow.connect(admin).activatePause())
        .to.be.revertedWithCustomError(escrow, 'PauseNotScheduled');
    });

    it('cancelScheduledPause でスケジュールをキャンセルできる', async function () {
      const { escrow, admin } = await deployFixture();
      await escrow.connect(admin).schedulePause();
      await expect(escrow.connect(admin).cancelScheduledPause())
        .to.emit(escrow, 'PauseCancelled');
      await time.increase(PAUSE_TIMELOCK + 1);
      await expect(escrow.connect(admin).activatePause())
        .to.be.revertedWithCustomError(escrow, 'PauseNotScheduled');
    });

    it('unpause で解除できる', async function () {
      const { escrow, admin } = await deployFixture();
      await escrow.connect(admin).schedulePause();
      await time.increase(PAUSE_TIMELOCK + 1);
      await escrow.connect(admin).activatePause();
      await expect(escrow.connect(admin).unpause())
        .to.emit(escrow, 'Unpaused');
      expect(await escrow.paused()).to.be.false;
    });

    it('admin 以外の schedulePause は NotAdmin で revert', async function () {
      const { escrow, attacker } = await deployFixture();
      await expect(escrow.connect(attacker).schedulePause())
        .to.be.revertedWithCustomError(escrow, 'NotAdmin');
    });
  });

  // ── 10. 不正操作拒否 ─────────────────────────────────────────────────────

  describe('unauthorized operations', function () {
    it('攻撃者は confirmDelivery で JPYC を奪えない', async function () {
      const { escrow, jpyc, client, worker, attacker } = await deployFixture();
      await submitJob(escrow, jpyc, client, worker);
      await expect(escrow.connect(attacker).confirmDelivery(JOB_KEY))
        .to.be.revertedWithCustomError(escrow, 'NotClient');
    });

    it('攻撃者は claimExpired でワーカーの支払いを奪えない', async function () {
      const { escrow, jpyc, client, worker, attacker } = await deployFixture();
      await submitJob(escrow, jpyc, client, worker);
      await time.increase(CLAIM_TIMEOUT + 1);
      await expect(escrow.connect(attacker).claimExpired(JOB_KEY))
        .to.be.revertedWithCustomError(escrow, 'NotWorker');
    });

    it('ワーカーは confirmDelivery を自分で呼べない', async function () {
      const { escrow, jpyc, client, worker } = await deployFixture();
      await submitJob(escrow, jpyc, client, worker);
      await expect(escrow.connect(worker).confirmDelivery(JOB_KEY))
        .to.be.revertedWithCustomError(escrow, 'NotClient');
    });

    it('OPEN 状態で submitDeliverable は revert（ASSIGNED 必須）', async function () {
      const { escrow, client, worker } = await deployFixture();
      await openJob(escrow, client);
      await expect(escrow.connect(worker).submitDeliverable(JOB_KEY, DELIVERABLE))
        .to.be.revertedWithCustomError(escrow, 'InvalidStatus');
    });
  });

  // ── 11. ビュー関数 ────────────────────────────────────────────────────────

  describe('view functions', function () {
    it('getJobId が正しい jobId を返す', async function () {
      const { escrow, client } = await deployFixture();
      await openJob(escrow, client);
      expect(await escrow.getJobId(JOB_KEY)).to.equal(1n);
    });

    it('存在しない jobKey の getJob は JobNotFound で revert', async function () {
      const { escrow } = await deployFixture();
      const badKey = ethers.keccak256(ethers.toUtf8Bytes('nonexistent'));
      await expect(escrow.getJob(badKey))
        .to.be.revertedWithCustomError(escrow, 'JobNotFound');
    });

    it('SUBMITTED 以外の claimAvailableAt は 0 を返す', async function () {
      const { escrow, client } = await deployFixture();
      await openJob(escrow, client);
      expect(await escrow.claimAvailableAt(JOB_KEY)).to.equal(0n);
    });

    it('存在しない jobKey の claimAvailableAt は 0 を返す', async function () {
      const { escrow } = await deployFixture();
      expect(await escrow.claimAvailableAt(JOB_KEY)).to.equal(0n);
    });
  });

  // ── 12. 複数 Job の独立性 ─────────────────────────────────────────────────

  describe('multiple jobs', function () {
    it('複数の jobKey が独立して管理される', async function () {
      const { escrow, jpyc, client, worker } = await deployFixture();
      await jpyc.mint(client.address, AMOUNT); // 追加 mint

      await openJob(escrow, client, JOB_KEY);
      await openJob(escrow, client, JOB_KEY_2);

      expect(await escrow.getJobId(JOB_KEY)).to.equal(1n);
      expect(await escrow.getJobId(JOB_KEY_2)).to.equal(2n);

      // JOB_KEY だけ進める
      const bidTx = await escrow.connect(worker).submitBid(JOB_KEY, AMOUNT, PROPOSAL_HASH);
      const bidReceipt = await bidTx.wait();
      const bidEvent = bidReceipt.logs.find(l => {
        try { return escrow.interface.parseLog(l).name === 'BidSubmitted'; } catch { return false; }
      });
      const bidId = escrow.interface.parseLog(bidEvent).args.bidId;
      await escrow.connect(client).acceptBid(JOB_KEY, bidId);

      const job1 = await escrow.getJob(JOB_KEY);
      const job2 = await escrow.getJob(JOB_KEY_2);
      expect(job1.status).to.equal(JobStatus.ASSIGNED);
      expect(job2.status).to.equal(JobStatus.OPEN);
    });
  });

  // ── 13. cancelBounty (v2.1) ───────────────────────────────────────────────

  describe('cancelBounty', function () {
    it('OPEN → CANCELLED に遷移し、JPYC がクライアントに返金される', async function () {
      const { escrow, jpyc, client } = await deployFixture();
      await openJob(escrow, client);

      const clientBalBefore = await jpyc.balanceOf(client.address);
      await expect(escrow.connect(client).cancelBounty(JOB_KEY))
        .to.emit(escrow, 'BountyCancelled')
        .withArgs(1n, client.address);

      const job = await escrow.getJob(JOB_KEY);
      expect(job.status).to.equal(JobStatus.CANCELLED);

      const clientBalAfter = await jpyc.balanceOf(client.address);
      expect(clientBalAfter - clientBalBefore).to.equal(AMOUNT);
    });

    it('クライアント以外が cancelBounty を呼ぶと NotClient で revert', async function () {
      const { escrow, attacker, client } = await deployFixture();
      await openJob(escrow, client);

      await expect(escrow.connect(attacker).cancelBounty(JOB_KEY))
        .to.be.revertedWithCustomError(escrow, 'NotClient');
    });

    it('ASSIGNED 以降の cancelBounty は InvalidStatus で revert', async function () {
      const { escrow, client, worker } = await deployFixture();
      await openJob(escrow, client);

      const bidTx = await escrow.connect(worker).submitBid(JOB_KEY, AMOUNT, PROPOSAL_HASH);
      const bidReceipt = await bidTx.wait();
      const bidEvent = bidReceipt.logs.find(l => {
        try { return escrow.interface.parseLog(l).name === 'BidSubmitted'; } catch { return false; }
      });
      const bidId = escrow.interface.parseLog(bidEvent).args.bidId;
      await escrow.connect(client).acceptBid(JOB_KEY, bidId);

      await expect(escrow.connect(client).cancelBounty(JOB_KEY))
        .to.be.revertedWithCustomError(escrow, 'InvalidStatus');
    });

    it('存在しない jobKey の cancelBounty は JobNotFound で revert', async function () {
      const { escrow, client } = await deployFixture();
      const badKey = ethers.keccak256(ethers.toUtf8Bytes('nonexistent'));
      await expect(escrow.connect(client).cancelBounty(badKey))
        .to.be.revertedWithCustomError(escrow, 'JobNotFound');
    });

    it('cancelBounty 後は JPYC コントラクト残高がゼロになる', async function () {
      const { escrow, jpyc, client } = await deployFixture();
      await openJob(escrow, client);

      const escrowAddr = await escrow.getAddress();
      expect(await jpyc.balanceOf(escrowAddr)).to.equal(AMOUNT);

      await escrow.connect(client).cancelBounty(JOB_KEY);
      expect(await jpyc.balanceOf(escrowAddr)).to.equal(0n);
    });
  });

  // ── 14. schedulePause 重複防止 (v2.1) ────────────────────────────────────

  describe('schedulePause duplicate prevention', function () {
    it('schedulePause を二重呼び出しすると PauseAlreadyScheduled で revert', async function () {
      const { escrow, admin } = await deployFixture();
      await escrow.connect(admin).schedulePause();

      await expect(escrow.connect(admin).schedulePause())
        .to.be.revertedWithCustomError(escrow, 'PauseAlreadyScheduled');
    });

    it('cancelScheduledPause 後は再 schedulePause が成功する', async function () {
      const { escrow, admin } = await deployFixture();
      await escrow.connect(admin).schedulePause();
      await escrow.connect(admin).cancelScheduledPause();

      // 再スケジュールは revert しない
      await expect(escrow.connect(admin).schedulePause()).to.not.be.reverted;
      expect(await escrow.pauseScheduled()).to.equal(true);
    });

    it('cancelScheduledPause 後の activatePause は PauseNotScheduled で revert', async function () {
      const { escrow, admin } = await deployFixture();
      await escrow.connect(admin).schedulePause();
      await escrow.connect(admin).cancelScheduledPause();

      await expect(escrow.connect(admin).activatePause())
        .to.be.revertedWithCustomError(escrow, 'PauseNotScheduled');
    });
  });
});
