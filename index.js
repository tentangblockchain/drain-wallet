require('dotenv').config();
const MultiChainOrchestrator = require('./MultiChainOrchestrator');

function validateEnv() {
  const enabledChains = [];

  const hasLegacyTronConfig = process.env.PRIVATE_KEY && process.env.DESTINATION_WALLET;
  const isTronExplicitlyEnabled = process.env.TRON_ENABLED === 'true';
  const isTronExplicitlyDisabled = process.env.TRON_ENABLED === 'false';

  if (isTronExplicitlyEnabled || (hasLegacyTronConfig && !isTronExplicitlyDisabled)) {
    const privateKey = process.env.TRON_PRIVATE_KEY || process.env.PRIVATE_KEY;
    const destWallet = process.env.DESTINATION_WALLET_TRON || process.env.DESTINATION_WALLET;

    if (!privateKey || !destWallet) {
      console.error('❌ TRON configuration incomplete');
      return false;
    }

    if (hasLegacyTronConfig && !isTronExplicitlyEnabled) {
      console.log('⚠️ Detected legacy .env format - using TRON with backward compatibility');
    }

    enabledChains.push('TRON');
  }

  const evmChains = ['ETHEREUM', 'BASE', 'ARBITRUM', 'SEPOLIA'];
  for (const chain of evmChains) {
    if (process.env[`${chain}_ENABLED`] === 'true') {
      if (!process.env[`${chain}_PRIVATE_KEY`] || !process.env.DESTINATION_WALLET) {
        console.error(`❌ ${chain} enabled but missing ${chain}_PRIVATE_KEY or DESTINATION_WALLET`);
        return false;
      }
      if (!process.env[`${chain}_RPC_ENDPOINTS`]) {
        console.error(`❌ ${chain} enabled but missing ${chain}_RPC_ENDPOINTS`);
        return false;
      }
      enabledChains.push(chain);
    }
  }

  if (process.env.SOLANA_ENABLED === 'true') {
    if (!process.env.SOLANA_PRIVATE_KEY || !process.env.DESTINATION_WALLET_SOLANA) {
      console.error('❌ Solana enabled but missing SOLANA_PRIVATE_KEY or DESTINATION_WALLET_SOLANA');
      return false;
    }
    enabledChains.push('SOLANA');
  }

  if (enabledChains.length === 0) {
    console.error('❌ No chains enabled! Please configure at least one chain.');
    console.error('💡 New format: Set TRON_ENABLED=true in .env');
    console.error('💡 Legacy format: Set PRIVATE_KEY and DESTINATION_WALLET in .env');
    return false;
  }

  console.log('✅ Configuration validated');
  console.log(`📋 Enabled chains: ${enabledChains.join(', ')}\n`);
  return true;
}

async function main() {
  console.log('🛡️🛡️🛡️ MULTI-CHAIN ANTI-DRAINER 🛡️🛡️🛡️\n');
  console.log('🎯 Maximum speed + reliability');
  console.log('⚡ Fire-and-forget broadcasting');
  console.log('🔄 Auto-retry on failure');
  console.log('🌐 Multi-chain parallel monitoring\n');

  if (!validateEnv()) {
    process.exit(1);
  }

  const orchestrator = new MultiChainOrchestrator();

  process.on('SIGINT', () => {
    console.log('\n\n🛑 Shutdown signal received...');
    orchestrator.stop();
    process.exit(0);
  });

  try {
    await orchestrator.start();
  } catch (error) {
    console.error('❌ Fatal:', error.message);
    process.exit(1);
  }
}

main();