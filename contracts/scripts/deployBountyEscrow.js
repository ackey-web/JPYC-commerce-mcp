import { ethers } from "hardhat";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Polygon Amoy testnet JPYC (ERC-20 mock or actual test token)
// For mainnet: 0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB
const JPYC_ADDRESS_DEFAULTS = {
  80002: process.env.JPYC_ADDRESS_AMOY || "", // Amoy: must be set
  137: "0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB", // Polygon mainnet
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log(`Network: ${network.name} (chainId: ${chainId})`);
  console.log(`Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} MATIC`);

  if (balance === 0n) {
    throw new Error("Deployer has no MATIC. Fund via https://faucet.polygon.technology/");
  }

  // Resolve JPYC address
  const jpycAddress =
    process.env.JPYC_ADDRESS || JPYC_ADDRESS_DEFAULTS[chainId] || "";

  if (!jpycAddress) {
    throw new Error(
      "JPYC_ADDRESS env var is required.\n" +
        "  Amoy: deploy MockJPYC first or set JPYC_ADDRESS_AMOY.\n" +
        "  Mainnet: 0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB"
    );
  }
  console.log(`JPYC: ${jpycAddress}`);

  // Admin defaults to deployer if not overridden
  const adminAddress = process.env.BOUNTY_ADMIN_ADDRESS || deployer.address;
  console.log(`Admin: ${adminAddress}`);

  if (!ethers.isAddress(jpycAddress)) {
    throw new Error(`Invalid JPYC_ADDRESS: ${jpycAddress}`);
  }
  if (!ethers.isAddress(adminAddress)) {
    throw new Error(`Invalid BOUNTY_ADMIN_ADDRESS: ${adminAddress}`);
  }

  // Deploy
  console.log("\nDeploying BountyEscrow...");
  const BountyEscrow = await ethers.getContractFactory("BountyEscrow");
  const escrow = await BountyEscrow.deploy(jpycAddress, adminAddress);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  const deployTx = escrow.deploymentTransaction();
  console.log(`BountyEscrow deployed: ${address}`);
  console.log(`Tx hash: ${deployTx.hash}`);

  // Post-deploy verification
  const deployedJpyc = await escrow.jpyc();
  const deployedAdmin = await escrow.admin();
  const protocolFee = await escrow.PROTOCOL_FEE_BPS();
  const claimTimeout = await escrow.CLAIM_TIMEOUT();
  const pauseTimelock = await escrow.PAUSE_TIMELOCK();

  console.log("\n--- Post-deploy state ---");
  console.log(`jpyc:              ${deployedJpyc}`);
  console.log(`admin:             ${deployedAdmin}`);
  console.log(`PROTOCOL_FEE_BPS:  ${protocolFee}`);
  console.log(`CLAIM_TIMEOUT:     ${claimTimeout} seconds (${Number(claimTimeout) / 86400} days)`);
  console.log(`PAUSE_TIMELOCK:    ${pauseTimelock} seconds (${Number(pauseTimelock) / 3600} hours)`);

  if (deployedJpyc.toLowerCase() !== jpycAddress.toLowerCase()) {
    throw new Error("jpyc address mismatch after deploy");
  }
  if (deployedAdmin.toLowerCase() !== adminAddress.toLowerCase()) {
    throw new Error("admin address mismatch after deploy");
  }
  if (protocolFee !== 0n) {
    throw new Error(`PROTOCOL_FEE_BPS should be 0, got ${protocolFee}`);
  }

  // Save deployment record
  const deploymentsDir = join(__dirname, "..", "deployments");
  if (!existsSync(deploymentsDir)) {
    mkdirSync(deploymentsDir, { recursive: true });
  }

  const record = {
    network: network.name,
    chainId,
    contract: "BountyEscrow",
    address,
    txHash: deployTx.hash,
    deployer: deployer.address,
    constructorArgs: {
      jpyc: jpycAddress,
      admin: adminAddress,
    },
    constants: {
      PROTOCOL_FEE_BPS: Number(protocolFee),
      CLAIM_TIMEOUT_SECONDS: Number(claimTimeout),
      PAUSE_TIMELOCK_SECONDS: Number(pauseTimelock),
    },
    deployedAt: new Date().toISOString(),
  };

  const outPath = join(deploymentsDir, `bounty-escrow-${chainId}.json`);
  writeFileSync(outPath, JSON.stringify(record, null, 2));
  console.log(`\nDeployment record saved: ${outPath}`);

  // Polygonscan verification hint
  const explorers = {
    80002: "https://amoy.polygonscan.com",
    137: "https://polygonscan.com",
  };
  const explorer = explorers[chainId];
  if (explorer) {
    console.log(`\nExplorer: ${explorer}/address/${address}`);
    console.log(
      `Verify: npx hardhat verify --network ${network.name} ${address} ${jpycAddress} ${adminAddress}`
    );
  }

  // .env guidance
  const envKey =
    chainId === 80002
      ? "BOUNTY_ESCROW_ADDRESS_AMOY"
      : "BOUNTY_ESCROW_ADDRESS_MAINNET";
  console.log(`\nAdd to .env:\n  ${envKey}=${address}`);

  return address;
}

main()
  .then((addr) => {
    console.log(`\nDone. BountyEscrow: ${addr}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
