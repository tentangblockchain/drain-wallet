const TronChainMonitor = require('./monitors/TronChainMonitor');
const EVMChainMonitor = require('./monitors/EVMChainMonitor');
const SolanaChainMonitor = require('./monitors/SolanaChainMonitor');

class MultiChainOrchestrator {
  constructor() {
    this.monitors = [];
    this.activeMonitors = [];
  }

  log(message) {
    console.log(`[ORCHESTRATOR] ${message}`);
  }

  error(message) {
    console.error(`[ORCHESTRATOR] ❌ ${message}`);
  }

  parseEnvList(envValue, defaultValue = []) {
    if (!envValue) return defaultValue;
    return envValue.split(',').map(v => v.trim()).filter(v => v);
  }

  async initializeTron() {
    const hasLegacyConfig = process.env.PRIVATE_KEY && process.env.DESTINATION_WALLET;
    const isExplicitlyEnabled = process.env.TRON_ENABLED === 'true';
    const isExplicitlyDisabled = process.env.TRON_ENABLED === 'false';

    if (isExplicitlyDisabled) {
      this.log('TRON monitoring explicitly disabled');
      return null;
    }

    if (!isExplicitlyEnabled && !hasLegacyConfig) {
      this.log('TRON monitoring disabled (no configuration found)');
      return null;
    }

    const privateKey = process.env.TRON_PRIVATE_KEY || process.env.PRIVATE_KEY;
    const destinationWallet = process.env.DESTINATION_WALLET_TRON || process.env.DESTINATION_WALLET;

    if (!privateKey || !destinationWallet) {
      this.error('TRON private key or destination wallet not set');
      return null;
    }

    if (hasLegacyConfig && !isExplicitlyEnabled) {
      this.log('⚠️ Using legacy .env format - consider updating to new format (see .env.example)');
    }

    const config = {
      privateKey,
      destinationWallet,
      rpcEndpoints: this.parseEnvList(
        process.env.TRON_RPC_ENDPOINTS || process.env.RPC_ENDPOINTS,
        ['https://api.trongrid.io', 'https://api.tronstack.io']
      ),
      usdtContract: process.env.TRON_USDT_CONTRACT || process.env.USDT_CONTRACT_ADDRESS || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      normalFeeLimit: parseInt(process.env.TRON_NORMAL_FEE_LIMIT || process.env.NORMAL_FEE_LIMIT) || 15000000,
      emergencyFeeLimit: parseInt(process.env.TRON_EMERGENCY_FEE_LIMIT || process.env.EMERGENCY_FEE_LIMIT) || 50000000,
      monitoringInterval: parseInt(process.env.MONITORING_INTERVAL_MS) || 5000
    };

    const monitor = new TronChainMonitor(config);
    return monitor;
  }

  async initializeEVM(network) {
    const envPrefix = network.toUpperCase();

    if (process.env[`${envPrefix}_ENABLED`] !== 'true') {
      this.log(`${network} monitoring disabled`);
      return null;
    }

    if (!process.env[`${envPrefix}_PRIVATE_KEY`] || !process.env.DESTINATION_WALLET) {
      this.error(`${envPrefix}_PRIVATE_KEY or DESTINATION_WALLET not set`);
      return null;
    }

    const config = {
      privateKey: process.env[`${envPrefix}_PRIVATE_KEY`],
      destinationWallet: process.env.DESTINATION_WALLET,
      rpcEndpoints: this.parseEnvList(process.env[`${envPrefix}_RPC_ENDPOINTS`]),
      monitoringInterval: parseInt(process.env.MONITORING_INTERVAL_MS) || 5000
    };

    if (config.rpcEndpoints.length === 0) {
      this.error(`No RPC endpoints configured for ${network}`);
      return null;
    }

    const monitor = new EVMChainMonitor(network, config);
    return monitor;
  }

  async initializeSolana() {
    if (process.env.SOLANA_ENABLED !== 'true') {
      this.log('Solana monitoring disabled');
      return null;
    }

    if (!process.env.SOLANA_PRIVATE_KEY || !process.env.DESTINATION_WALLET_SOLANA) {
      this.error('SOLANA_PRIVATE_KEY or DESTINATION_WALLET_SOLANA not set');
      return null;
    }

    const config = {
      privateKey: process.env.SOLANA_PRIVATE_KEY,
      destinationWallet: process.env.DESTINATION_WALLET_SOLANA,
      rpcEndpoints: this.parseEnvList(process.env.SOLANA_RPC_ENDPOINTS, [
        'https://api.mainnet-beta.solana.com'
      ]),
      usdtMint: process.env.SOLANA_USDT_MINT || 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      monitoringInterval: parseInt(process.env.MONITORING_INTERVAL_MS) || 5000
    };

    const monitor = new SolanaChainMonitor(config);
    return monitor;
  }

  async initializeAllMonitors() {
    this.log('🚀 Initializing Multi-Chain Anti-Drainer...\n');

    const tronMonitor = await this.initializeTron();
    if (tronMonitor) this.monitors.push(tronMonitor);

    const ethereumMonitor = await this.initializeEVM('ETHEREUM');
    if (ethereumMonitor) this.monitors.push(ethereumMonitor);

    const baseMonitor = await this.initializeEVM('BASE');
    if (baseMonitor) this.monitors.push(baseMonitor);

    const arbitrumMonitor = await this.initializeEVM('ARBITRUM');
    if (arbitrumMonitor) this.monitors.push(arbitrumMonitor);

    const sepoliaMonitor = await this.initializeEVM('SEPOLIA');
    if (sepoliaMonitor) this.monitors.push(sepoliaMonitor);

    const solanaMonitor = await this.initializeSolana();
    if (solanaMonitor) this.monitors.push(solanaMonitor);

    if (this.monitors.length === 0) {
      throw new Error('No chain monitors enabled! Please configure at least one chain.');
    }

    this.log(`✅ ${this.monitors.length} chain monitor(s) initialized\n`);
    return this.monitors;
  }

  async setupAllConnections() {
    this.log('🔗 Setting up connections for all chains...\n');

    const setupPromises = this.monitors.map(async (monitor) => {
      try {
        await monitor.setupConnection();
        this.activeMonitors.push(monitor);
        return { success: true, chain: monitor.chainName };
      } catch (error) {
        this.error(`Failed to setup ${monitor.chainName}: ${error.message}`);
        return { success: false, chain: monitor.chainName, error: error.message };
      }
    });

    const results = await Promise.allSettled(setupPromises);

    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const failed = results.filter(r => r.status === 'fulfilled' && !r.value.success);

    this.log(`\n📊 Connection Results:`);
    this.log(`   ✅ Connected: ${successful.length} chain(s)`);
    if (failed.length > 0) {
      this.log(`   ❌ Failed: ${failed.length} chain(s)`);
      failed.forEach(f => {
        if (f.value) this.log(`      - ${f.value.chain}: ${f.value.error}`);
      });
    }
    this.log('');

    if (this.activeMonitors.length === 0) {
      throw new Error('Failed to connect to any chain!');
    }
  }

  async startAllMonitors() {
    this.log('🛡️🛡️🛡️ MULTI-CHAIN ANTI-DRAINER PROTECTION 🛡️🛡️🛡️\n');
    this.log(`📋 Active Chains: ${this.activeMonitors.map(m => m.chainName).join(', ')}`);
    this.log(`⚡ All chains monitoring in parallel`);
    this.log(`🔄 Auto-retry on failures`);
    this.log(`🎯 Maximum speed protection\n`);

    const monitorPromises = this.activeMonitors.map(async (monitor) => {
      try {
        await monitor.startMonitoring();
      } catch (error) {
        this.error(`${monitor.chainName} monitoring error: ${error.message}`);
      }
    });

    await Promise.allSettled(monitorPromises);
  }

  async start() {
    try {
      await this.initializeAllMonitors();
      await this.setupAllConnections();
      await this.startAllMonitors();

      this.log('✅ Multi-Chain Anti-Drainer is now running!\n');
      this.log('Press Ctrl+C to stop\n');

    } catch (error) {
      this.error(`Fatal error: ${error.message}`);
      process.exit(1);
    }
  }

  stop() {
    this.log('⏹️ Stopping all monitors...');
    this.activeMonitors.forEach(monitor => monitor.stopMonitoring());
    this.log('✅ All monitors stopped');
  }
}

module.exports = MultiChainOrchestrator;