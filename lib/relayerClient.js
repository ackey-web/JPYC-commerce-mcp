/**
 * Pluggable Relayer Client — EIP-3009 gasless tx submission abstraction
 *
 * Non-custodial: this module submits pre-signed calldata only.
 * The MCP server never holds private keys.
 *
 * Supported providers (RELAYER_PROVIDER env var):
 *   "gelato"   — Gelato Relay v2 (sponsoredCall / non-ERC2771)
 *   "biconomy" — Biconomy Bundler (ERC-4337 UserOp)
 *   "custom"   — Any relay accepting { signedAuthorization, target, data }
 */

// Read env vars at call time (not module load time) to allow test overrides
const getConfig = () => ({
  PROVIDER: (process.env.RELAYER_PROVIDER || 'custom').toLowerCase(),
  RELAYER_URL: process.env.RELAYER_URL || '',
  RELAYER_API_KEY: process.env.RELAYER_API_KEY || '',
});

// Gelato Relay v2 API endpoint template (Amoy = chainId 80002, Mainnet = 137)
const GELATO_RELAY_BASE = 'https://relay.gelato.digital';

// Biconomy Bundler endpoint template
const BICONOMY_BUNDLER_BASE = 'https://bundler.biconomy.io/api/v2';

/**
 * Submit a relayed transaction.
 *
 * @param {object} params
 * @param {object} params.signedAuthorization - EIP-3009 authorization payload
 *   { from, to, value, validAfter, validBefore, nonce, v, r, s }
 * @param {string} params.target  - Contract address (JPYC or BountyEscrow)
 * @param {string} params.data    - ABI-encoded calldata (0x-prefixed hex)
 * @param {number} [params.chainId] - Chain ID (defaults to CHAIN_ID env var)
 * @returns {Promise<string>} Transaction hash (0x-prefixed)
 */
export async function submitRelayedTx({ signedAuthorization, target, data, chainId }) {
  const chain = chainId ?? parseInt(process.env.CHAIN_ID || '80002', 10);
  const { PROVIDER } = getConfig();

  switch (PROVIDER) {
    case 'gelato':
      return _submitGelato({ signedAuthorization, target, data, chainId: chain });
    case 'biconomy':
      return _submitBiconomy({ signedAuthorization, target, data, chainId: chain });
    case 'custom':
    default:
      return _submitCustom({ signedAuthorization, target, data, chainId: chain });
  }
}

/**
 * Build the EIP-3009 transferWithAuthorization calldata.
 * Useful for relaying JPYC transfers without gas.
 *
 * @param {object} auth - { from, to, value, validAfter, validBefore, nonce, v, r, s }
 * @returns {string} ABI-encoded calldata (0x-prefixed)
 */
export function buildTransferWithAuthorizationCalldata(auth) {
  // selector = keccak256("transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)")[0:4]
  // = 0xe3ee160e
  const selector = 'e3ee160e';

  const pad = (val, isBytes32 = false) => {
    const hex = isBytes32
      ? (val.startsWith('0x') ? val.slice(2) : val).padStart(64, '0')
      : BigInt(val).toString(16).padStart(64, '0');
    return hex;
  };

  const padAddr = (addr) => addr.replace(/^0x/, '').toLowerCase().padStart(64, '0');

  const args = [
    padAddr(auth.from),
    padAddr(auth.to),
    pad(auth.value),
    pad(auth.validAfter),
    pad(auth.validBefore),
    pad(auth.nonce, true),
    pad(auth.v),
    pad(auth.r, true),
    pad(auth.s, true),
  ];

  return '0x' + selector + args.join('');
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

async function _submitGelato({ signedAuthorization, target, data, chainId }) {
  const { RELAYER_API_KEY } = getConfig();
  if (!RELAYER_API_KEY) throw new Error('RELAYER_API_KEY is required for Gelato');

  // Gelato sponsoredCall: POST /relays/v2/sponsored-call
  const body = {
    chainId: chainId.toString(),
    target,
    data,
    // Pass authorization as metadata — Gelato forwards it via callWithSyncFee or sponsoredCall
    // For EIP-3009, the data already encodes the signed authorization
    sponsorApiKey: RELAYER_API_KEY,
  };

  const res = await fetch(`${GELATO_RELAY_BASE}/relays/v2/sponsored-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gelato relay failed (${res.status}): ${err}`);
  }

  const json = await res.json();

  // Gelato returns a taskId; poll for tx hash
  const taskId = json.taskId;
  if (!taskId) throw new Error('Gelato did not return taskId');

  return _pollGelatoTask(taskId);
}

async function _pollGelatoTask(taskId, maxAttempts = 20, intervalMs = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const res = await fetch(`${GELATO_RELAY_BASE}/tasks/status/${taskId}`);
    if (!res.ok) continue;

    const json = await res.json();
    const status = json.task?.taskState;

    if (status === 'ExecSuccess' && json.task?.transactionHash) {
      return json.task.transactionHash;
    }
    if (status === 'Cancelled' || status === 'ExecReverted') {
      throw new Error(`Gelato task ${taskId} failed with status: ${status}`);
    }
  }
  throw new Error(`Gelato task ${taskId} did not resolve after ${maxAttempts} polls`);
}

async function _submitBiconomy({ signedAuthorization, target, data, chainId }) {
  const { RELAYER_URL, RELAYER_API_KEY } = getConfig();
  if (!RELAYER_URL) throw new Error('RELAYER_URL is required for Biconomy');
  if (!RELAYER_API_KEY) throw new Error('RELAYER_API_KEY is required for Biconomy');

  // Biconomy Bundler: eth_sendUserOperation equivalent via their REST API
  // Using Biconomy's "gasless" native transfer endpoint
  const body = {
    to: target,
    data,
    from: signedAuthorization.from,
    // Pass signed authorization for EIP-3009 relay
    signedAuthorization,
  };

  const endpointUrl = RELAYER_URL || `${BICONOMY_BUNDLER_BASE}/${chainId}/rpc`;
  const res = await fetch(endpointUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': RELAYER_API_KEY,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_sendUserOperation',
      params: [body, '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Biconomy relay failed (${res.status}): ${err}`);
  }

  const json = await res.json();
  if (json.error) throw new Error(`Biconomy error: ${JSON.stringify(json.error)}`);

  // UserOpHash — caller may need to resolve to tx hash via bundler
  return json.result;
}

async function _submitCustom({ signedAuthorization, target, data, chainId }) {
  const { RELAYER_URL, RELAYER_API_KEY } = getConfig();
  if (!RELAYER_URL) throw new Error('RELAYER_URL is required for custom relayer');

  const body = {
    signedAuthorization,
    target,
    data,
    chainId,
  };

  const headers = { 'Content-Type': 'application/json' };
  if (RELAYER_API_KEY) headers['Authorization'] = `Bearer ${RELAYER_API_KEY}`;

  const res = await fetch(RELAYER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Custom relayer failed (${res.status}): ${err}`);
  }

  const json = await res.json();

  // Expect { txHash: "0x..." } or { transactionHash: "0x..." }
  const txHash = json.txHash || json.transactionHash || json.tx_hash;
  if (!txHash) throw new Error(`Custom relayer response missing txHash: ${JSON.stringify(json)}`);

  return txHash;
}
