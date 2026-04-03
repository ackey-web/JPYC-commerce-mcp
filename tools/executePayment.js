/**
 * Tool 5 (v2): execute_payment
 * 承認された条件でJPYC送金を実行する
 *
 * モード:
 * - RELAYER_PRIVATE_KEY 設定あり → Polygon上でJPYC transferFrom を実行
 * - 未設定 → モックtx_hash（デモモード）
 *
 * JPYC送金フロー:
 * 1. Relayerウォレットが from_wallet の approve 済み JPYC を transferFrom で to_wallet へ送金
 * 2. tx_hash を mcp_payments に記録
 */
import { supabase } from '../lib/supabase.js';

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

const JPYC_CONTRACT = process.env.JPYC_CONTRACT_ADDRESS || '0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29';

/**
 * JPYC金額をwei単位に変換（18 decimals）
 */
function jpycToWei(amount) {
  // BigIntで精度を保つ
  return BigInt(amount) * BigInt(10 ** 18);
}

export default async function handler({ negotiation_id, from_wallet, to_wallet }) {
  // 交渉データを取得
  const { data: negotiation, error } = await supabase
    .from('mcp_negotiations')
    .select('*')
    .eq('id', negotiation_id)
    .single();

  if (error || !negotiation) {
    throw new Error(`交渉ID ${negotiation_id} が見つかりません`);
  }

  if (negotiation.status !== 'approved') {
    throw new Error('この交渉はまだ承認されていません');
  }

  const amount = negotiation.proposed_amount;
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  const rpcUrl = process.env.POLYGON_RPC_URL || process.env.VITE_ALCHEMY_RPC_URL || 'https://polygon-rpc.com';

  // 正規Ethereumアドレスかチェック（0x + 40hex）
  const isValidAddress = (addr) => /^0x[0-9a-fA-F]{40}$/.test(addr);
  const canGoLive = relayerKey && isValidAddress(from_wallet) && isValidAddress(to_wallet);

  let tx_hash;
  let autoApproved = false;

  if (canGoLive) {
    // === 本番モード: Polygon上でJPYC送金 ===
    const { ethers } = await import('ethers');
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    const relayerWallet = new ethers.Wallet(relayerKey, provider);
    const jpyc = new ethers.Contract(JPYC_CONTRACT, ERC20_ABI, relayerWallet);

    const amountWei = jpycToWei(amount);

    // 事前チェック: allowance
    const allowance = await jpyc.allowance(from_wallet, relayerWallet.address);
    if (allowance.lt(amountWei)) {
      throw new Error(
        `JPYC allowance不足: ${from_wallet} → Relayer(${relayerWallet.address}) の承認額が ${amount} JPYC 未満です。` +
        `現在の承認額: ${ethers.utils.formatUnits(allowance, 18)} JPYC`
      );
    }

    // 事前チェック: balance
    const balance = await jpyc.balanceOf(from_wallet);
    if (balance.lt(amountWei)) {
      throw new Error(
        `JPYC残高不足: ${from_wallet} の残高が ${amount} JPYC 未満です。` +
        `現在の残高: ${ethers.utils.formatUnits(balance, 18)} JPYC`
      );
    }

    // transferFrom 実行
    console.error(`[execute_payment] JPYC送金実行: ${from_wallet} → ${to_wallet}, ${amount} JPYC`);
    const tx = await jpyc.transferFrom(from_wallet, to_wallet, amountWei, {
      maxFeePerGas: ethers.utils.parseUnits('200', 'gwei'),
      maxPriorityFeePerGas: ethers.utils.parseUnits('50', 'gwei'),
      gasLimit: 100000,
    });

    console.error(`[execute_payment] TX送信: ${tx.hash}`);
    const receipt = await tx.wait();

    if (receipt.status !== 1) {
      throw new Error(`トランザクション失敗: ${tx.hash}`);
    }

    tx_hash = tx.hash;
    console.error(`[execute_payment] 送金完了: ${tx_hash} (block: ${receipt.blockNumber})`);
  } else {
    // === デモモード: モックトランザクション ===
    tx_hash = `mock_tx_${Date.now()}`;
    console.error(`[execute_payment] デモモード: ${tx_hash}`);
  }

  // request_human_approval で自動承認されたか確認
  const { data: paymentCheck } = await supabase
    .from('mcp_negotiations')
    .select('status')
    .eq('id', negotiation_id)
    .single();

  // mcp_payments に記録
  const { data: payment, error: insertError } = await supabase
    .from('mcp_payments')
    .insert({
      negotiation_id,
      from_wallet,
      to_wallet,
      amount,
      tx_hash,
      auto_approved: autoApproved,
    })
    .select('id')
    .single();

  if (insertError) {
    throw new Error(`送金記録の保存に失敗: ${insertError.message}`);
  }

  return {
    payment_id: payment.id,
    tx_hash,
    amount,
    mode: canGoLive ? 'live' : 'mock',
  };
}
