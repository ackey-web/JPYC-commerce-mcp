import { expect } from 'chai';
import hre from 'hardhat';
import { time } from '@nomicfoundation/hardhat-network-helpers';

const { ethers } = hre;

// ─── 定数 ─────────────────────────────────────────────────────────────────────

const AMOUNT         = ethers.parseUnits('500', 18);
const AMOUNT_SMALL   = ethers.parseUnits('100', 18);
const AMOUNT_128     = 500n; // uint128 raw（submitBid の bidAmount 用）
const PROPOSAL_HASH  = ethers.keccak256(ethers.toUtf8Bytes('proposal-ipfs-cid'));
const DELIVERABLE    = ethers.keccak256(ethers.toUtf8Bytes('deliverable-ipfs-cid'));
const CLAIM_TIMEOUT  = 90 * 24 * 60 * 60; // 90日（秒）

// JobStatus 列挙値（コントラクトと同じ順序）
const JobStatus = {
  OPEN:          0n,
  ASSIGNED:      1n,
  SUBMITTED:     2n,
  RELEASED:      3n,
  AUTO_RELEASED: 4n,
  CANCELLED:     5n,
};

function jobKey(seed) {
  return ethers.keccak256(ethers.toUtf8Bytes(seed));
}

// ─── フィクスチャ ─────────────────────────────────────────────────────────────

async function deployContracts() {
  const [admin, client, worker, worker2, other] = await ethers.getSigners();

  const MockJPYC = await ethers.getContractFactory('MockJPYC');
  const jpyc = await MockJPYC.deploy();
  await jpyc.waitForDeployment();

  const BountyEscrow = await ethers.getContractFactory('BountyEscrow');
  const escrow = await BountyEscrow.deploy(admin.address, await jpyc.getAddress());
  await escrow.waitForDeployment();

  // client に 100,000 JPYC を mint + MaxUint256 approve
  await jpyc.mint(client.address, ethers.parseUnits('100000', 18));
  await jpyc.connect(client).approve(await escrow.getAddress(), ethers.MaxUint256);

  return { escrow, jpyc, admin, client, worker, worker2, other };
}

// ─── ヘルパー: イベントをログから取得 ────────────────────────────────────────

function findEvent(receipt, contract, eventName) {
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed.name === eventName) return parsed;
    } catch { /* ignore */ }
  }
  return null;
}

// ─── ヘルパー: OPEN → ASSIGNED まで進める ────────────────────────────────────

async function openAndAssign(escrow, client, worker, key) {
  await escrow.connect(client).openBounty(key, AMOUNT);
  const bidTx      = await escrow.connect(worker).submitBid(key, AMOUNT_128, PROPOSAL_HASH);
  const bidReceipt = await bidTx.wait();
  const bidEvent   = findEvent(bidReceipt, escrow, 'BidSubmitted');
  const bidId      = bidEvent.args.bidId;
  await escrow.connect(client).acceptBid(key, bidId);
  return bidId;
}

// ─────────────────────────────────────────────────────────────────────────────
// テストスイート
// ─────────────────────────────────────────────────────────────────────────────

describe('BountyEscrow — fullFlow integration', function () {

  // ── 1. MockJPYC ─────────────────────────────────────────────────────────────

  describe('MockJPYC (ERC-20 + EIP-3009)', function () {
    it('デプロイ: name/symbol/decimals/version が JPYC v2 と同一', async function () {
      const { jpyc } = await deployContracts();
      expect(await jpyc.name()).to.equal('JPY Coin');
      expect(await jpyc.symbol()).to.equal('JPYC');
      expect(await jpyc.decimals()).to.equal(18n);
      expect(await jpyc.version()).to.equal('1');
    });

    it('mint → balanceOf が正しく加算される', async function () {
      const { jpyc, worker } = await deployContracts();
      await jpyc.mint(worker.address, AMOUNT);
      expect(await jpyc.balanceOf(worker.address)).to.equal(AMOUNT);
    });

    it('transfer: 残高チェック + 正常転送', async function () {
      const { jpyc, client, worker } = await deployContracts();
      const before = await jpyc.balanceOf(client.address);
      await jpyc.connect(client).transfer(worker.address, AMOUNT);
      expect(await jpyc.balanceOf(client.address)).to.equal(before - AMOUNT);
      expect(await jpyc.balanceOf(worker.address)).to.equal(AMOUNT);
    });

    it('transferWithAuthorization: EIP-712 署名検証が通る', async function () {
      const { jpyc, client, worker } = await deployContracts();
      await jpyc.mint(client.address, AMOUNT);

      const domain = {
        name: 'JPY Coin',
        version: '1',
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await jpyc.getAddress(),
      };
      const types = {
        TransferWithAuthorization: [
          { name: 'from',        type: 'address' },
          { name: 'to',          type: 'address' },
          { name: 'value',       type: 'uint256' },
          { name: 'validAfter',  type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce',       type: 'bytes32' },
        ],
      };
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const now   = BigInt(await time.latest());
      const msgValue = {
        from:        client.address,
        to:          worker.address,
        value:       AMOUNT,
        validAfter:  now - 10n,
        validBefore: now + 3600n,
        nonce,
      };

      const sig = await client.signTypedData(domain, types, msgValue);
      const { v, r, s } = ethers.Signature.from(sig);

      const before = await jpyc.balanceOf(worker.address);
      await jpyc.transferWithAuthorization(
        client.address, worker.address, AMOUNT,
        msgValue.validAfter, msgValue.validBefore, nonce,
        v, r, s
      );
      expect(await jpyc.balanceOf(worker.address)).to.equal(before + AMOUNT);
    });

    it('authorizationState: 使用済み nonce は true を返す', async function () {
      const { jpyc, client, worker } = await deployContracts();
      await jpyc.mint(client.address, AMOUNT);

      const domain = {
        name: 'JPY Coin',
        version: '1',
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await jpyc.getAddress(),
      };
      const types = {
        TransferWithAuthorization: [
          { name: 'from',        type: 'address' },
          { name: 'to',          type: 'address' },
          { name: 'value',       type: 'uint256' },
          { name: 'validAfter',  type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce',       type: 'bytes32' },
        ],
      };
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const now   = BigInt(await time.latest());
      const msgValue = {
        from:        client.address,
        to:          worker.address,
        value:       AMOUNT,
        validAfter:  now - 10n,
        validBefore: now + 3600n,
        nonce,
      };

      const sig = await client.signTypedData(domain, types, msgValue);
      const { v, r, s } = ethers.Signature.from(sig);

      expect(await jpyc.authorizationState(client.address, nonce)).to.be.false;
      await jpyc.transferWithAuthorization(
        client.address, worker.address, AMOUNT,
        msgValue.validAfter, msgValue.validBefore, nonce, v, r, s
      );
      expect(await jpyc.authorizationState(client.address, nonce)).to.be.true;
    });

    it('EIP-712 署名が無効な場合はリバートする', async function () {
      const { jpyc, client, worker, other } = await deployContracts();
      await jpyc.mint(client.address, AMOUNT);

      const domain = {
        name: 'JPY Coin',
        version: '1',
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await jpyc.getAddress(),
      };
      const types = {
        TransferWithAuthorization: [
          { name: 'from',        type: 'address' },
          { name: 'to',          type: 'address' },
          { name: 'value',       type: 'uint256' },
          { name: 'validAfter',  type: 'uint256' },
          { name: 'validBefore', type: 'uint256' },
          { name: 'nonce',       type: 'bytes32' },
        ],
      };
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const now   = BigInt(await time.latest());
      const msgValue = {
        from:        client.address,
        to:          worker.address,
        value:       AMOUNT,
        validAfter:  now - 10n,
        validBefore: now + 3600n,
        nonce,
      };

      // other（別人）が署名
      const sig = await other.signTypedData(domain, types, msgValue);
      const { v, r, s } = ethers.Signature.from(sig);

      await expect(
        jpyc.transferWithAuthorization(
          client.address, worker.address, AMOUNT,
          msgValue.validAfter, msgValue.validBefore, nonce, v, r, s
        )
      ).to.be.revertedWith('InvalidSignature');
    });
  });

  // ── 2. openBounty → confirmDelivery (ハッピーパス) ──────────────────────────

  describe('ハッピーパス: openBounty → confirmDelivery', function () {
    it('OPEN → ASSIGNED → SUBMITTED → RELEASED の状態遷移', async function () {
      const { escrow, jpyc, client, worker } = await deployContracts();
      const key = jobKey('happy-path-1');

      // OPEN
      await escrow.connect(client).openBounty(key, AMOUNT);
      expect((await escrow.jobs(await escrow.getJobId(key))).status).to.equal(JobStatus.OPEN);

      // ASSIGNED
      const bidId = await openAndAssign(escrow, client, worker, jobKey('dummy-to-avoid-reuse'));
      // ここでは別キーを使うため改めて実行
      const key2 = jobKey('happy-path-1-full');
      await escrow.connect(client).openBounty(key2, AMOUNT);
      const bidTx      = await escrow.connect(worker).submitBid(key2, AMOUNT_128, PROPOSAL_HASH);
      const bidReceipt = await bidTx.wait();
      const bid2Id     = findEvent(bidReceipt, escrow, 'BidSubmitted').args.bidId;
      await escrow.connect(client).acceptBid(key2, bid2Id);

      const jobId2 = await escrow.getJobId(key2);
      expect((await escrow.jobs(jobId2)).status).to.equal(JobStatus.ASSIGNED);

      // SUBMITTED
      await escrow.connect(worker).submitDeliverable(key2, DELIVERABLE);
      expect((await escrow.jobs(jobId2)).status).to.equal(JobStatus.SUBMITTED);

      // RELEASED
      const workerBefore = await jpyc.balanceOf(worker.address);
      await escrow.connect(client).confirmDelivery(key2);
      expect((await escrow.jobs(jobId2)).status).to.equal(JobStatus.RELEASED);

      // 全額 worker 送金（fee 分配なし、PROTOCOL_FEE_BPS = 0）
      const workerAfter = await jpyc.balanceOf(worker.address);
      expect(workerAfter - workerBefore).to.equal(AMOUNT);
    });

    it('DeliveryConfirmed イベントの worker と amount が正しい', async function () {
      const { escrow, jpyc, client, worker } = await deployContracts();
      const key = jobKey('happy-path-events');

      await escrow.connect(client).openBounty(key, AMOUNT);
      const bidTx      = await escrow.connect(worker).submitBid(key, AMOUNT_128, PROPOSAL_HASH);
      const bidReceipt = await bidTx.wait();
      const bidId      = findEvent(bidReceipt, escrow, 'BidSubmitted').args.bidId;
      await escrow.connect(client).acceptBid(key, bidId);
      await escrow.connect(worker).submitDeliverable(key, DELIVERABLE);

      const releaseTx      = await escrow.connect(client).confirmDelivery(key);
      const releaseReceipt = await releaseTx.wait();
      const releaseEvent   = findEvent(releaseReceipt, escrow, 'DeliveryConfirmed');

      expect(releaseEvent).to.not.be.null;
      expect(releaseEvent.args.worker.toLowerCase()).to.equal(worker.address.toLowerCase());
      // DeliveryConfirmed.amount は uint128 なので AMOUNT と比較
      expect(releaseEvent.args.amount).to.equal(AMOUNT);
    });

    it('PROTOCOL_FEE_BPS = 0 → escrow 残高はゼロになる', async function () {
      const { escrow, jpyc, client, worker } = await deployContracts();
      const key = jobKey('fee-zero');

      await escrow.connect(client).openBounty(key, AMOUNT);
      const bidTx      = await escrow.connect(worker).submitBid(key, AMOUNT_128, PROPOSAL_HASH);
      const bidReceipt = await bidTx.wait();
      const bidId      = findEvent(bidReceipt, escrow, 'BidSubmitted').args.bidId;
      await escrow.connect(client).acceptBid(key, bidId);
      await escrow.connect(worker).submitDeliverable(key, DELIVERABLE);
      await escrow.connect(client).confirmDelivery(key);

      const escrowBalance = await jpyc.balanceOf(await escrow.getAddress());
      expect(escrowBalance).to.equal(0n);
    });
  });

  // ── 3. claimExpired (自動払出) ──────────────────────────────────────────────

  describe('claimExpired: 90日超過で worker が自動払出', function () {
    it('90日経過後に claimExpired → AUTO_RELEASED', async function () {
      const { escrow, jpyc, client, worker } = await deployContracts();
      const key = jobKey('claim-expired-1');

      await escrow.connect(client).openBounty(key, AMOUNT);
      const bidTx      = await escrow.connect(worker).submitBid(key, AMOUNT_128, PROPOSAL_HASH);
      const bidReceipt = await bidTx.wait();
      const bidId      = findEvent(bidReceipt, escrow, 'BidSubmitted').args.bidId;
      await escrow.connect(client).acceptBid(key, bidId);
      await escrow.connect(worker).submitDeliverable(key, DELIVERABLE);

      // 90日 + 1秒 経過
      await time.increase(CLAIM_TIMEOUT + 1);

      const workerBefore = await jpyc.balanceOf(worker.address);
      const claimTx      = await escrow.connect(worker).claimExpired(key);
      const claimReceipt = await claimTx.wait();

      const jobId = await escrow.getJobId(key);
      expect((await escrow.jobs(jobId)).status).to.equal(JobStatus.AUTO_RELEASED);

      const workerAfter = await jpyc.balanceOf(worker.address);
      expect(workerAfter - workerBefore).to.equal(AMOUNT);

      const autoEvent = findEvent(claimReceipt, escrow, 'AutoReleased');
      expect(autoEvent).to.not.be.null;
      expect(autoEvent.args.worker.toLowerCase()).to.equal(worker.address.toLowerCase());
    });

    it('90日未満では claimExpired がリバートする', async function () {
      const { escrow, client, worker } = await deployContracts();
      const key = jobKey('claim-not-expired');

      await escrow.connect(client).openBounty(key, AMOUNT);
      const bidTx      = await escrow.connect(worker).submitBid(key, AMOUNT_128, PROPOSAL_HASH);
      const bidReceipt = await bidTx.wait();
      const bidId      = findEvent(bidReceipt, escrow, 'BidSubmitted').args.bidId;
      await escrow.connect(client).acceptBid(key, bidId);
      await escrow.connect(worker).submitDeliverable(key, DELIVERABLE);

      // 89日しか経過していない
      await time.increase(89 * 24 * 60 * 60);

      await expect(escrow.connect(worker).claimExpired(key)).to.be.reverted;
    });

    it('worker 以外は claimExpired できない', async function () {
      const { escrow, client, worker, other } = await deployContracts();
      const key = jobKey('claim-auth');

      await escrow.connect(client).openBounty(key, AMOUNT);
      const bidTx      = await escrow.connect(worker).submitBid(key, AMOUNT_128, PROPOSAL_HASH);
      const bidReceipt = await bidTx.wait();
      const bidId      = findEvent(bidReceipt, escrow, 'BidSubmitted').args.bidId;
      await escrow.connect(client).acceptBid(key, bidId);
      await escrow.connect(worker).submitDeliverable(key, DELIVERABLE);
      await time.increase(CLAIM_TIMEOUT + 1);

      await expect(escrow.connect(other).claimExpired(key)).to.be.reverted;
    });
  });

  // ── 4. cancelBounty ──────────────────────────────────────────────────────────

  describe('cancelBounty: OPEN 状態から poster 自己返金', function () {
    it('OPEN → CANCELLED、client の残高が AMOUNT 返還される', async function () {
      const { escrow, jpyc, client } = await deployContracts();
      const key = jobKey('cancel-1');

      const clientBefore = await jpyc.balanceOf(client.address);
      await escrow.connect(client).openBounty(key, AMOUNT);

      const escrowAfterOpen = await jpyc.balanceOf(await escrow.getAddress());
      expect(escrowAfterOpen).to.equal(AMOUNT);

      await escrow.connect(client).cancelBounty(key);

      const jobId = await escrow.getJobId(key);
      expect((await escrow.jobs(jobId)).status).to.equal(JobStatus.CANCELLED);

      const clientAfter = await jpyc.balanceOf(client.address);
      expect(clientAfter).to.equal(clientBefore); // 全額返還
    });

    it('BountyCancelled イベントが emit される', async function () {
      const { escrow, client } = await deployContracts();
      const key = jobKey('cancel-event');

      await escrow.connect(client).openBounty(key, AMOUNT);
      const cancelTx      = await escrow.connect(client).cancelBounty(key);
      const cancelReceipt = await cancelTx.wait();
      const cancelEvent   = findEvent(cancelReceipt, escrow, 'BountyCancelled');

      expect(cancelEvent).to.not.be.null;
    });

    it('ASSIGNED 状態では cancelBounty がリバートする', async function () {
      const { escrow, client, worker } = await deployContracts();
      const key = jobKey('cancel-assigned');

      await escrow.connect(client).openBounty(key, AMOUNT);
      const bidTx      = await escrow.connect(worker).submitBid(key, AMOUNT_128, PROPOSAL_HASH);
      const bidReceipt = await bidTx.wait();
      const bidId      = findEvent(bidReceipt, escrow, 'BidSubmitted').args.bidId;
      await escrow.connect(client).acceptBid(key, bidId);

      await expect(escrow.connect(client).cancelBounty(key)).to.be.reverted;
    });

    it('client 以外は cancelBounty できない', async function () {
      const { escrow, client, other } = await deployContracts();
      const key = jobKey('cancel-auth');

      await escrow.connect(client).openBounty(key, AMOUNT);
      await expect(escrow.connect(other).cancelBounty(key)).to.be.reverted;
    });
  });

  // ── 5. 複数 job 並行 ─────────────────────────────────────────────────────────

  describe('複数 job 並行実行', function () {
    it('異なる jobKey で独立した状態を保持する', async function () {
      const { escrow, client, worker } = await deployContracts();
      const key1 = jobKey('parallel-1');
      const key2 = jobKey('parallel-2');

      await escrow.connect(client).openBounty(key1, AMOUNT);
      await escrow.connect(client).openBounty(key2, AMOUNT_SMALL);

      // job1: ASSIGNED まで進める
      const bid1Tx   = await escrow.connect(worker).submitBid(key1, AMOUNT_128, PROPOSAL_HASH);
      const bid1Rcpt = await bid1Tx.wait();
      const bid1Id   = findEvent(bid1Rcpt, escrow, 'BidSubmitted').args.bidId;
      await escrow.connect(client).acceptBid(key1, bid1Id);

      // job2: cancel
      await escrow.connect(client).cancelBounty(key2);

      const jobId1 = await escrow.getJobId(key1);
      const jobId2 = await escrow.getJobId(key2);
      expect((await escrow.jobs(jobId1)).status).to.equal(JobStatus.ASSIGNED);
      expect((await escrow.jobs(jobId2)).status).to.equal(JobStatus.CANCELLED);
    });
  });

  // ── 6. ノンカストディアル検証 ─────────────────────────────────────────────────

  describe('ノンカストディアル原則の検証', function () {
    it('admin withdraw 関数が存在しない', async function () {
      const { escrow } = await deployContracts();
      expect(escrow.interface.hasFunction('adminWithdraw')).to.be.false;
      expect(escrow.interface.hasFunction('withdrawAll')).to.be.false;
      expect(escrow.interface.hasFunction('emergencyWithdraw')).to.be.false;
    });

    it('upgradeable proxy ではない（実装コントラクトへの直接デプロイ）', async function () {
      const { escrow } = await deployContracts();
      expect(escrow.interface.hasFunction('upgradeTo')).to.be.false;
      expect(escrow.interface.hasFunction('upgradeToAndCall')).to.be.false;
    });

    it('PROTOCOL_FEE_BPS は 0 固定（immutable）', async function () {
      const { escrow } = await deployContracts();
      expect(await escrow.PROTOCOL_FEE_BPS()).to.equal(0n);
    });
  });
});
