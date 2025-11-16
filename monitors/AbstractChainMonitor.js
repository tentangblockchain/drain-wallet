class AbstractChainMonitor {
  constructor(chainName, config) {
    this.chainName = chainName;
    this.config = config;
    this.destinationWallet = config.destinationWallet;
    this.monitoringInterval = config.monitoringInterval || 3000; // Increased from 1s to 3s
    this.retryDelays = [5000, 10000, 20000, 40000, 60000];

    this.lastNativeBalance = null;
    this.lastUSDTBalance = null;
    this.lastExtraTokenBalances = {};
    this.transferInProgress = false;

    this.consecutiveFailures = 0;
    this.maxConsecutiveFailures = 3;
    this.lastTransferAttemptTime = null;
    this.broadcastedTxHashes = new Set();
    this.multisigDetected = false;

    this.monitoringIntervalHandle = null;
    this.lastLogTime = 0;
    this.logIntervalMs = 30000;
  }

  log(message) {
    console.log(`[${this.chainName}] ${message}`);
  }

  error(message) {
    console.error(`[${this.chainName}] ❌ ${message}`);
  }

  getBackoffDelay() {
    if (this.consecutiveFailures === 0) return 0;

    const delays = [2000, 5000, 10000, 15000, 30000];
    const index = Math.min(this.consecutiveFailures - 1, delays.length - 1);
    return delays[index];
  }

  async setupConnection() {
    throw new Error('setupConnection() must be implemented by subclass');
  }

  async getBalances() {
    throw new Error('getBalances() must be implemented by subclass');
  }

  async executeTransfer(nativeAmount, usdtAmount) {
    throw new Error('executeTransfer() must be implemented by subclass');
  }

  async checkMultisig() {
    return false;
  }

  async executeProtection() {
    try {
      if (this.transferInProgress) {
        return;
      }

      const balances = await this.getBalances();

      const now = Date.now();
      const shouldLogBalance = (now - this.lastLogTime) >= this.logIntervalMs;

      if (shouldLogBalance) {
        let balanceLog = `💰 Native: ${this.formatNativeBalance(balances.native)} | USDT: ${this.formatUSDTBalance(balances.usdt)}`;
        if (balances.extraTokens) {
          Object.entries(balances.extraTokens).forEach(([tokenName, balance]) => {
            if (balance > 0n) {
              balanceLog += ` | ${tokenName}: ${balance.toString()}`;
            }
          });
        }
        this.log(balanceLog);
        this.lastLogTime = now;
      }

      let shouldTransfer = false;
      let reason = '';

      const hasExtraTokens = balances.extraTokens && Object.values(balances.extraTokens).some(b => b > 0n);

      if (this.lastNativeBalance === null) {
        if (balances.usdt > 0n || this.shouldTransferNativeBalance(balances.native) || hasExtraTokens) {
          shouldTransfer = true;
          reason = 'Initial balance detected';
        }
      } else {
        const nativeIncrease = balances.native - this.lastNativeBalance;
        const usdtIncrease = balances.usdt - this.lastUSDTBalance;

        if (nativeIncrease > 0n) {
          shouldTransfer = true;
          reason = `Native increase +${this.formatNativeBalance(nativeIncrease)}`;
        } else if (usdtIncrease > 0n) {
          shouldTransfer = true;
          reason = `USDT increase +${this.formatUSDTBalance(usdtIncrease)}`;
        } else if (balances.extraTokens) {
          for (const [tokenName, balance] of Object.entries(balances.extraTokens)) {
            const lastBalance = this.lastExtraTokenBalances[tokenName] || 0n;
            if (balance > lastBalance) {
              shouldTransfer = true;
              reason = `${tokenName} increase +${(balance - lastBalance).toString()}`;
              break;
            }
          }
        }

        if (!shouldTransfer && (balances.usdt > 0n || this.shouldTransferNativeBalance(balances.native) || hasExtraTokens)) {
          shouldTransfer = true;
          reason = 'Assets still present - retrying transfer';
        }
      }

      if (shouldTransfer && (balances.usdt > 0n || this.shouldTransferNativeBalance(balances.native) || hasExtraTokens)) {
        const backoffDelay = this.getBackoffDelay();
        const now = Date.now();

        if (this.lastTransferAttemptTime && backoffDelay > 0) {
          const timeSinceLastAttempt = now - this.lastTransferAttemptTime;
          if (timeSinceLastAttempt < backoffDelay) {
            const waitTime = Math.ceil((backoffDelay - timeSinceLastAttempt) / 1000);
            this.log(`⏸️ Backoff active - waiting ${waitTime}s before retry (failures: ${this.consecutiveFailures})`);
            return;
          }
        }

        if (this.consecutiveFailures === 2 && !this.multisigDetected) {
          this.log(`🔍 Checking for multisig configuration...`);
          this.multisigDetected = await this.checkMultisig();

          if (this.multisigDetected) {
            this.log(`\n🚨🚨🚨 MULTISIG WALLET DETECTED! 🚨🚨🚨`);
            this.log(`❌ This wallet uses MULTISIG!`);
            this.log(`❌ Transactions CANNOT be done with 1 private key!`);
            this.log(`💡 Please transfer assets manually or disable multisig\n`);
            this.stopMonitoring();
            return;
          }
        }

        this.log(`\n🚨 TRIGGER: ${reason}`);
        if (this.consecutiveFailures > 0) {
          this.log(`⚠️ Retry attempt #${this.consecutiveFailures + 1}`);
        }
        this.log(`⚡ INITIATING TRANSFER...`);

        this.transferInProgress = true;
        this.lastTransferAttemptTime = now;

        const result = await this.executeTransfer(balances.native, balances.usdt, balances.extraTokens);

        this.transferInProgress = false;

        if (result.insufficientFunds) {
          this.log(`\n🚨🚨🚨 INSUFFICIENT FUNDS DETECTED! 🚨🚨🚨`);
          this.log(`❌ Wallet has tokens but NO native currency for gas fees!`);
          this.log(`💡 Please deposit native currency (ETH/TRX/SOL) to wallet: ${this.wallet?.address || 'N/A'}`);
          this.log(`⏸️ Pausing monitoring to avoid spam...\n`);
          this.stopMonitoring();
          return;
        }

        if (result.success) {
          this.log(`⏳ Waiting for blockchain confirmation...`);
          await new Promise(resolve => setTimeout(resolve, 5000));

          const newBalances = await this.getBalances();

          const hasNewExtraTokens = newBalances.extraTokens && Object.values(newBalances.extraTokens).some(b => b > 0n);

          if (newBalances.usdt === 0n && !this.shouldTransferNativeBalance(newBalances.native) && !hasNewExtraTokens) {
            this.log(`✅ Assets successfully transferred!\n`);
            this.consecutiveFailures = 0;
            this.lastNativeBalance = newBalances.native;
            this.lastUSDTBalance = newBalances.usdt;
            this.lastExtraTokenBalances = newBalances.extraTokens || {};
            this.broadcastedTxHashes.clear();
          } else {
            this.log(`⚠️ Assets still present after transfer`);
            this.consecutiveFailures++;

            if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
              this.log(`\n⚠️ WARNING: ${this.consecutiveFailures} transfer failures!`);
              this.log(`💭 Possible causes:`);
              this.log(`   • Wallet using Multisig`);
              this.log(`   • Insufficient gas`);
              this.log(`   • Network congestion`);
              this.log(`   • Contract execution error`);

              if (result.txHashes && result.txHashes.length > 0) {
                this.log(`\n📋 Broadcasted transaction hashes:`);
                result.txHashes.forEach(tx => {
                  this.log(`   ${tx.type}: ${this.getExplorerUrl(tx.txid)}`);
                });
              }
            }

            this.lastNativeBalance = newBalances.native;
            this.lastUSDTBalance = newBalances.usdt;
            this.lastExtraTokenBalances = newBalances.extraTokens || {};
          }
        } else {
          this.consecutiveFailures++;
        }

      } else if (!shouldTransfer && this.lastNativeBalance === null) {
        this.lastNativeBalance = balances.native;
        this.lastUSDTBalance = balances.usdt;
        this.lastExtraTokenBalances = balances.extraTokens || {};
      }

    } catch (error) {
      this.error(`Execute error: ${error.message}`);
      this.transferInProgress = false;
    }
  }

  formatNativeBalance(balance) {
    return balance.toString();
  }

  formatUSDTBalance(balance) {
    return (Number(balance) / 1000000).toFixed(2);
  }

  shouldTransferNativeBalance(balance) {
    return balance > this.getMinimumNativeBalance();
  }

  getMinimumNativeBalance() {
    return 0n;
  }

  getExplorerUrl(txHash) {
    return txHash;
  }

  async startMonitoring() {
    this.log(`🛡️ ANTI-DRAINER ${this.chainName.toUpperCase()} - PROTECTION STARTED! 🛡️\n`);
    this.log('📋 STRATEGY:');
    this.log(`   1. Monitor balances every ${this.monitoringInterval / 1000}s`);
    this.log('   2. IMMEDIATE transfer on balance increase');
    this.log('   3. AUTO-RETRY until assets are safe');
    this.log('   4. NEVER GIVE UP on exposed funds!\n');

    await this.executeProtection();
    this.log('✅ Protection loop started\n');

    this.monitoringIntervalHandle = setInterval(async () => {
      await this.executeProtection();
    }, this.monitoringInterval);
  }

  stopMonitoring() {
    if (this.monitoringIntervalHandle) {
      clearInterval(this.monitoringIntervalHandle);
      this.monitoringIntervalHandle = null;
      this.log('⏹️ Monitoring stopped');
    }
  }
}

module.exports = AbstractChainMonitor;