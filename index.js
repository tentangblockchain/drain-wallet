// anti-drainer-tron.js - ULTIMATE SPEED & RELIABILITY
const TronWeb = require('tronweb');
require('dotenv').config();

// Multi RPC endpoints untuk TRON  
const RPC_ENDPOINTS = process.env.RPC_ENDPOINTS ? 
  process.env.RPC_ENDPOINTS.split(',') : [
    'https://api.trongrid.io',
    'https://api.tronstack.io'
  ];

// USDT Contract Address (TRC20)
const USDT_CONTRACT = process.env.USDT_CONTRACT_ADDRESS || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

class AntiDrainerTron {
  constructor() {
    this.tronWebs = [];
    this.mainTronWeb = null;
    this.destinationWallet = process.env.DESTINATION_WALLET;
    
    // Tracking - ONLY update after successful transfer!
    this.lastTRXBalance = null;
    this.lastUSDTBalance = null;
    this.transferInProgress = false;
    
    // Configuration
    this.drainerAddresses = [
      process.env.DRAINER_ADDRESS_1 || '',
      process.env.DRAINER_ADDRESS_2 || ''
    ].filter(addr => addr && addr !== '');
    
    this.officialSender = process.env.OFFICIAL_SENDER || '';
    this.normalFeeLimit = parseInt(process.env.NORMAL_FEE_LIMIT) || 15000000;
    this.emergencyFeeLimit = parseInt(process.env.EMERGENCY_FEE_LIMIT) || 50000000;
    
    console.log('🔗 Testing TRON RPC connections...');
  }
  
  async setupTronWeb() {
    const privateKey = process.env.PRIVATE_KEY;
    
    for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
      try {
        const tronWeb = new TronWeb({
          fullHost: RPC_ENDPOINTS[i],
          privateKey: privateKey
        });
        
        await Promise.race([
          tronWeb.trx.getCurrentBlock(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);
        
        this.tronWebs.push(tronWeb);
        console.log(`✅ RPC ${i} connected: ${RPC_ENDPOINTS[i]}`);
        
      } catch (error) {
        console.log(`❌ RPC ${i} failed: ${RPC_ENDPOINTS[i]}`);
      }
    }
    
    if (this.tronWebs.length === 0) {
      throw new Error('❌ Semua TRON RPC endpoint gagal!');
    }
    
    console.log(`🚀 ${this.tronWebs.length} TRON RPC endpoints ready!\n`);
    
    this.mainTronWeb = this.tronWebs[0];
    const address = this.mainTronWeb.address.fromPrivateKey(privateKey);
    
    console.log(`🔑 Wallet: ${address}`);
    console.log(`📍 Tujuan: ${this.destinationWallet}\n`);
  }
  
  sunToTrx(sun) {
    return Number(sun) / 1000000;
  }
  
  // USDT balance dengan multiple fallback methods
  async getUSDTBalance(tronWeb) {
    try {
      const address = tronWeb.defaultAddress.base58;
      
      // Method 1: TriggerConstantContract
      try {
        const parameter = [{type: 'address', value: address}];
        const transaction = await tronWeb.transactionBuilder.triggerConstantContract(
          USDT_CONTRACT,
          'balanceOf(address)',
          {},
          parameter,
          address
        );
        
        if (transaction && transaction.constant_result && transaction.constant_result[0]) {
          return BigInt('0x' + transaction.constant_result[0]);
        }
      } catch (e) {}
      
      // Method 2: Contract call
      try {
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        const balance = await contract.balanceOf(address).call();
        return BigInt(balance.toString());
      } catch (e) {}
      
      return 0n;
      
    } catch (error) {
      return 0n;
    }
  }
  
  // FIRE-AND-FORGET PARALLEL TRANSFER dengan retry
  async parallelTransferAll(usdtAmount, trxBalance) {
    console.log(`\n🚀🚀 PARALLEL TRANSFER ACTIVATED! 🚀🚀`);
    console.log(`🔥 FIRE-AND-FORGET mode - NO waiting for confirmation!`);
    console.log(`💰 USDT: ${Number(usdtAmount) / 1000000} | TRX: ${this.sunToTrx(trxBalance)}`);
    
    const allPromises = [];
    let usdtAttempted = false;
    let trxAttempted = false;
    
    // USDT transfers di semua RPC
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
                USDT_CONTRACT,
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
              
              // TRUE FIRE-AND-FORGET: No polling!
              tronWeb.trx.sendRawTransaction(signed, { shouldPollResponse: false }).then(result => {
                if (result && result.result) {
                  console.log(`✅ USDT TX (RPC ${index}): ${result.txid || 'broadcasted'}`);
                }
              }).catch(() => {});
              
              return { success: true, type: 'USDT', index };
              
            } catch (error) {
              console.log(`❌ USDT RPC ${index}: ${error.message}`);
              return { success: false, type: 'USDT', index };
            }
          })(i)
        );
      }
    }
    
    // TRX transfers di semua RPC
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
              
              // TRUE FIRE-AND-FORGET: No polling!
              tronWeb.trx.sendRawTransaction(signed, { shouldPollResponse: false }).then(result => {
                if (result && result.result) {
                  console.log(`✅ TRX TX (RPC ${index}): ${result.txid || 'broadcasted'}`);
                }
              }).catch(() => {});
              
              return { success: true, type: 'TRX', index };
              
            } catch (error) {
              console.log(`❌ TRX RPC ${index}: ${error.message}`);
              return { success: false, type: 'TRX', index };
            }
          })(i)
        );
      }
    }
    
    if (allPromises.length === 0) {
      return false;
    }
    
    console.log(`🚀 Launching ${allPromises.length} fire-and-forget transfers...`);
    const results = await Promise.allSettled(allPromises);
    
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const usdtSuccess = successful.filter(r => r.value.type === 'USDT');
    const trxSuccess = successful.filter(r => r.value.type === 'TRX');
    
    console.log(`\n📊 BROADCAST RESULTS:`);
    if (usdtAttempted) console.log(`   💵 USDT: ${usdtSuccess.length}/${this.tronWebs.length} broadcasted`);
    if (trxAttempted) console.log(`   💰 TRX: ${trxSuccess.length}/${this.tronWebs.length} broadcasted`);
    
    // Success if AT LEAST ONE broadcast succeeded per asset type
    const hasUsdtSuccess = !usdtAttempted || usdtSuccess.length > 0;
    const hasTrxSuccess = !trxAttempted || trxSuccess.length > 0;
    
    if (hasUsdtSuccess && hasTrxSuccess) {
      console.log(`🎯 ASSETS BROADCASTED - Transfers in mempool!\n`);
      return true;
    } else {
      console.log(`⚠️ Some broadcasts failed - will retry!\n`);
      return false;
    }
  }
  
  async getBalances() {
    for (let i = 0; i < this.tronWebs.length; i++) {
      try {
        const tronWeb = this.tronWebs[i];
        const address = tronWeb.defaultAddress.base58;
        
        const trxBalance = BigInt(await tronWeb.trx.getBalance(address));
        const usdtBalance = await this.getUSDTBalance(tronWeb);
        
        return { trx: trxBalance, usdt: usdtBalance, rpcIndex: i };
        
      } catch (error) {
        continue;
      }
    }
    
    throw new Error('All RPCs failed');
  }
  
  // Main protection loop - NEVER GIVE UP ON ASSETS!
  async executeProtection() {
    try {
      if (this.transferInProgress) {
        return; // Skip if transfer already in progress
      }
      
      const balances = await this.getBalances();
      
      const trxFormatted = this.sunToTrx(balances.trx);
      const usdtFormatted = Number(balances.usdt) / 1000000;
      
      console.log(`💰 TRX: ${trxFormatted.toFixed(6)} | USDT: ${usdtFormatted.toFixed(2)}`);
      
      // Determine if we need to transfer
      let shouldTransfer = false;
      let reason = '';
      
      if (this.lastTRXBalance === null) {
        // First run - check if there's balance to transfer
        if (balances.usdt > 0n || balances.trx > 1000000n) {
          shouldTransfer = true;
          reason = 'Initial balance detected';
        }
      } else {
        // Check for increases (potential drainer!)
        const trxIncrease = balances.trx - this.lastTRXBalance;
        const usdtIncrease = balances.usdt - this.lastUSDTBalance;
        
        if (trxIncrease > 0n) {
          shouldTransfer = true;
          reason = `TRX increase +${this.sunToTrx(trxIncrease)} TRX`;
        } else if (usdtIncrease > 0n) {
          shouldTransfer = true;
          reason = `USDT increase +${Number(usdtIncrease) / 1000000} USDT`;
        } else if (balances.usdt > 0n || balances.trx > 1000000n) {
          // Assets still present - previous transfer might have failed!
          shouldTransfer = true;
          reason = 'Assets still present - retrying transfer';
        }
      }
      
      if (shouldTransfer && (balances.usdt > 0n || balances.trx > 1000000n)) {
        console.log(`\n🚨 TRIGGER: ${reason}`);
        console.log(`⚡ INITIATING PARALLEL TRANSFER...`);
        
        this.transferInProgress = true;
        
        const success = await this.parallelTransferAll(balances.usdt, balances.trx);
        
        this.transferInProgress = false;
        
        if (success) {
          // Update baseline ONLY after successful broadcast
          this.lastTRXBalance = 0n; // Assume will be drained
          this.lastUSDTBalance = 0n;
          
          console.log(`⏳ Waiting for blockchain confirmation...`);
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3s
          
          // Re-check balances to verify
          const newBalances = await this.getBalances();
          this.lastTRXBalance = newBalances.trx;
          this.lastUSDTBalance = newBalances.usdt;
          
          if (newBalances.usdt > 0n || newBalances.trx > 1000000n) {
            console.log(`⚠️ Assets still present - will continue trying!\n`);
          } else {
            console.log(`✅ Assets successfully transferred!\n`);
          }
        }
        // If failed, keep old baseline so we retry next cycle
        
      } else if (!shouldTransfer && this.lastTRXBalance === null) {
        // First run with no balance
        this.lastTRXBalance = balances.trx;
        this.lastUSDTBalance = balances.usdt;
      }
      
    } catch (error) {
      console.error(`❌ Execute error: ${error.message}`);
      this.transferInProgress = false;
    }
  }
  
  async startProtection() {
    console.log('🛡️ ANTI-DRAINER TRON - ULTIMATE PROTECTION! 🛡️\n');
    console.log('📋 STRATEGI:');
    console.log('   1. Monitor TRX + USDT setiap detik');
    console.log('   2. IMMEDIATE transfer saat ada increase');
    console.log('   3. PARALLEL broadcast ke semua RPC');
    console.log('   4. FIRE-AND-FORGET - no confirmation wait');
    console.log('   5. AUTO-RETRY sampai assets aman');
    console.log('   6. NEVER GIVE UP on exposed funds!\n');
    
    // Initial check
    await this.executeProtection();
    console.log('✅ Protection loop started\n');
    
    // Monitor loop
    const interval = parseInt(process.env.MONITORING_INTERVAL_MS) || 1000;
    setInterval(async () => {
      await this.executeProtection();
    }, interval);
  }
}

function validateEnv() {
  const required = ['PRIVATE_KEY', 'DESTINATION_WALLET'];
  const missing = required.filter(v => !process.env[v]);
  
  if (missing.length > 0) {
    console.error(`❌ Missing: ${missing.join(', ')}`);
    console.error('💡 Copy .env.example to .env');
    process.exit(1);
  }
  
  console.log('✅ Config validated');
}

async function main() {
  console.log('🛡️🛡️🛡️ ANTI-DRAINER TRON 🛡️🛡️🛡️\n');
  console.log('🎯 Maximum speed + reliability');
  console.log('⚡ Fire-and-forget broadcasting');
  console.log('🔄 Auto-retry on failure\n');
  
  validateEnv();
  
  const drainer = new AntiDrainerTron();
  
  try {
    await drainer.setupTronWeb();
    await drainer.startProtection();
  } catch (error) {
    console.error('❌ Fatal:', error.message);
    process.exit(1);
  }
}

main();
