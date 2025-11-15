// anti-drainer-tron.js - MAXIMUM SPEED PROTECTION
const TronWeb = require('tronweb');
require('dotenv').config();

// Multi RPC endpoints untuk TRON
const RPC_ENDPOINTS = process.env.RPC_ENDPOINTS ? 
  process.env.RPC_ENDPOINTS.split(',') : [
    'https://api.trongrid.io',
    'https://api.tronstack.io'
  ];

// USDT Contract Address (TRC20) - Default USDT di mainnet
const USDT_CONTRACT = process.env.USDT_CONTRACT_ADDRESS || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

class AntiDrainerTron {
  constructor() {
    this.tronWebs = [];
    this.validRpcIndexes = [];
    this.mainTronWeb = null;
    
    this.destinationWallet = process.env.DESTINATION_WALLET;
    
    // Tracking untuk deteksi ANY TRX increase
    this.lastTRXBalance = null;
    this.lastUSDTBalance = null;
    this.lastBlockNumber = 0;
    
    // Alamat drainer yang terdeteksi
    this.drainerAddresses = [
      process.env.DRAINER_ADDRESS_1 || '',
      process.env.DRAINER_ADDRESS_2 || ''
    ].filter(addr => addr && addr !== '');
    
    // Alamat official sender (whitelist)
    this.officialSender = process.env.OFFICIAL_SENDER || '';
    
    // Threshold untuk deteksi trigger (dalam SUN, 1 TRX = 1,000,000 SUN)
    this.triggerThreshold = BigInt(parseFloat(process.env.TRIGGER_THRESHOLD_TRX || '0.1') * 1000000);
    
    // Fee limits (dalam SUN) - REDUCED untuk energy=0
    this.normalFeeLimit = parseInt(process.env.NORMAL_FEE_LIMIT) || 15000000; // 15 TRX
    this.emergencyFeeLimit = parseInt(process.env.EMERGENCY_FEE_LIMIT) || 50000000; // 50 TRX
    
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
        
        // Test connection
        await Promise.race([
          tronWeb.trx.getCurrentBlock(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);
        
        this.tronWebs.push(tronWeb);
        this.validRpcIndexes.push(i);
        console.log(`✅ RPC ${i} connected: ${RPC_ENDPOINTS[i]}`);
        
      } catch (error) {
        console.log(`❌ RPC ${i} failed: ${RPC_ENDPOINTS[i]}`);
      }
    }
    
    if (this.tronWebs.length === 0) {
      throw new Error('❌ Semua TRON RPC endpoint gagal! Check koneksi internet.');
    }
    
    console.log(`🚀 ${this.tronWebs.length} TRON RPC endpoints ready!\n`);
    
    this.mainTronWeb = this.tronWebs[0];
    const address = this.mainTronWeb.address.fromPrivateKey(privateKey);
    
    console.log(`🔑 Wallet: ${address}`);
    console.log(`📍 Tujuan: ${this.destinationWallet}`);
    console.log(`⚠️ Auto-transfer: IMMEDIATE saat TRX masuk!\n`);
  }
  
  // Konversi SUN ke TRX untuk display
  sunToTrx(sun) {
    return Number(sun) / 1000000;
  }
  
  // Get USDT balance dengan multiple methods untuk reliability
  async getUSDTBalance(tronWeb) {
    try {
      const address = tronWeb.defaultAddress.base58;
      
      // Method 1: TriggerConstantContract (paling reliable)
      try {
        const parameter = [{type: 'address', value: address}];
        const options = {};
        
        const transaction = await tronWeb.transactionBuilder.triggerConstantContract(
          USDT_CONTRACT,
          'balanceOf(address)',
          options,
          parameter,
          address
        );
        
        if (transaction && transaction.constant_result && transaction.constant_result[0]) {
          const balanceHex = transaction.constant_result[0];
          return BigInt('0x' + balanceHex);
        }
      } catch (e) {
        // Try next method
      }
      
      // Method 2: Direct contract call
      try {
        const contract = await tronWeb.contract().at(USDT_CONTRACT);
        const balance = await contract.balanceOf(address).call();
        return BigInt(balance.toString());
      } catch (e) {
        // Try next method
      }
      
      // Method 3: TronGrid API
      try {
        const response = await fetch(`https://api.trongrid.io/v1/contracts/${USDT_CONTRACT}/balance?address=${address}`);
        if (response.ok) {
          const data = await response.json();
          if (data && data.balance !== undefined) {
            return BigInt(data.balance);
          }
        }
      } catch (e) {
        // All methods failed
      }
      
      return 0n;
      
    } catch (error) {
      console.log(`⚠️ Error getting USDT balance: ${error.message}`);
      return 0n;
    }
  }
  
  // MAXIMUM SPEED PARALLEL TRANSFER - USDT + TRX bersamaan di semua RPC
  async parallelTransferAll(usdtAmount, trxBalance) {
    console.log(`\n🚀🚀 PARALLEL TRANSFER ACTIVATED! 🚀🚀`);
    console.log(`🔥 Transferring USDT + TRX SIMULTANEOUSLY di semua RPC!`);
    console.log(`💰 USDT: ${Number(usdtAmount) / 1000000} | TRX: ${this.sunToTrx(trxBalance)}`);
    
    const allTransferPromises = [];
    
    // PARALEL TRANSFER 1: USDT di semua RPC (jika ada)
    if (usdtAmount > 0n) {
      for (let i = 0; i < this.tronWebs.length; i++) {
        allTransferPromises.push(
          (async (index) => {
            try {
              const tronWeb = this.tronWebs[index];
              const address = tronWeb.defaultAddress.base58;
              
              // Build transfer
              const functionSelector = 'transfer(address,uint256)';
              const parameter = [
                {type: 'address', value: this.destinationWallet},
                {type: 'uint256', value: usdtAmount.toString()}
              ];
              
              const transaction = await tronWeb.transactionBuilder.triggerSmartContract(
                USDT_CONTRACT,
                functionSelector,
                {
                  feeLimit: this.emergencyFeeLimit,
                  callValue: 0
                },
                parameter,
                address
              );
              
              if (!transaction || !transaction.transaction) {
                throw new Error('Transaction build failed');
              }
              
              const signedTx = await tronWeb.trx.sign(transaction.transaction);
              const broadcast = await tronWeb.trx.sendRawTransaction(signedTx);
              
              console.log(`🔥 USDT TX (RPC ${index}): ${broadcast.txid || 'broadcast'}`);
              return { success: true, hash: broadcast.txid, type: 'USDT', index };
              
            } catch (error) {
              console.log(`❌ USDT fail RPC ${index}: ${error.message}`);
              return { success: false, type: 'USDT', index };
            }
          })(i)
        );
      }
    }
    
    // PARALEL TRANSFER 2: TRX di semua RPC (jika cukup)
    const feeReserve = 1000000n; // 1 TRX untuk safety
    if (trxBalance > feeReserve) {
      for (let i = 0; i < this.tronWebs.length; i++) {
        allTransferPromises.push(
          (async (index) => {
            try {
              const tronWeb = this.tronWebs[index];
              const amountToSend = trxBalance - feeReserve;
              
              const tx = await tronWeb.trx.sendTransaction(
                this.destinationWallet,
                Number(amountToSend),
                {feeLimit: this.emergencyFeeLimit}
              );
              
              console.log(`🔥 TRX TX (RPC ${index}): ${tx.txid || tx.transaction?.txID}`);
              return { success: true, hash: tx.txid || tx.transaction?.txID, type: 'TRX', index };
              
            } catch (error) {
              console.log(`❌ TRX fail RPC ${index}: ${error.message}`);
              return { success: false, type: 'TRX', index };
            }
          })(i)
        );
      }
    }
    
    if (allTransferPromises.length === 0) {
      console.log(`⚠️ No transfers to execute`);
      return false;
    }
    
    // EKSEKUSI SEMUA TRANSFER SECARA BERSAMAAN!
    console.log(`🚀 Launching ${allTransferPromises.length} transfers simultaneously...`);
    const results = await Promise.allSettled(allTransferPromises);
    
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const usdtSuccess = successful.filter(r => r.value.type === 'USDT');
    const trxSuccess = successful.filter(r => r.value.type === 'TRX');
    
    console.log(`\n✅ TRANSFER RESULTS:`);
    console.log(`   📍 USDT: ${usdtSuccess.length}/${this.tronWebs.length} berhasil`);
    console.log(`   📍 TRX: ${trxSuccess.length}/${this.tronWebs.length} berhasil`);
    
    if (successful.length > 0) {
      console.log(`🎯 TOTAL: ${successful.length} transaksi terkirim - ASSETS SECURED!\n`);
      return true;
    } else {
      console.log(`❌ Semua transfer gagal!\n`);
      return false;
    }
  }
  
  // Get balances dengan detection
  async getBalances() {
    try {
      // Try dari setiap RPC
      for (let i = 0; i < this.tronWebs.length; i++) {
        try {
          const tronWeb = this.tronWebs[i];
          const address = tronWeb.defaultAddress.base58;
          
          // Get TRX balance
          const trxBalance = BigInt(await tronWeb.trx.getBalance(address));
          
          // Get USDT balance dengan multiple methods
          const usdtBalance = await this.getUSDTBalance(tronWeb);
          
          return { trx: trxBalance, usdt: usdtBalance, rpcIndex: i };
          
        } catch (error) {
          // Try next RPC
          continue;
        }
      }
      
      throw new Error('Semua RPC gagal');
      
    } catch (error) {
      throw new Error('Gagal mendapatkan balance');
    }
  }
  
  // Main execution logic - SIMPLIFIED & OPTIMIZED
  async executeProtection() {
    try {
      const balances = await this.getBalances();
      
      const trxFormatted = this.sunToTrx(balances.trx);
      const usdtFormatted = Number(balances.usdt) / 1000000; // USDT has 6 decimals
      
      // Tampilkan balance
      console.log(`💰 TRX: ${trxFormatted.toFixed(6)} | USDT: ${usdtFormatted.toFixed(2)}`);
      
      // STRATEGI BARU: Deteksi INCREASE TRX = IMMEDIATE PARALLEL TRANSFER!
      let shouldTransfer = false;
      
      // First run - set baseline
      if (this.lastTRXBalance === null) {
        this.lastTRXBalance = balances.trx;
        this.lastUSDTBalance = balances.usdt;
        
        // Jika ada balance di awal, transfer juga
        if (balances.usdt > 0n || balances.trx > 1000000n) {
          shouldTransfer = true;
          console.log(`🔔 Initial balance detected - transferring...`);
        }
      } else {
        // Check for TRX increase (drainer trigger!)
        const trxIncrease = balances.trx - this.lastTRXBalance;
        const usdtIncrease = balances.usdt - this.lastUSDTBalance;
        
        if (trxIncrease > 0n) {
          console.log(`\n🚨 TRX INCREASE DETECTED! +${this.sunToTrx(trxIncrease)} TRX`);
          console.log(`⚡ TRIGGERING IMMEDIATE PARALLEL TRANSFER!`);
          shouldTransfer = true;
        } else if (usdtIncrease > 0n) {
          console.log(`\n💵 USDT INCREASE DETECTED! +${Number(usdtIncrease) / 1000000} USDT`);
          console.log(`⚡ TRIGGERING IMMEDIATE PARALLEL TRANSFER!`);
          shouldTransfer = true;
        }
        
        // Update tracking
        this.lastTRXBalance = balances.trx;
        this.lastUSDTBalance = balances.usdt;
      }
      
      // TRANSFER JIKA ADA ASSET ATAU INCREASE DETECTED
      if (shouldTransfer && (balances.usdt > 0n || balances.trx > 1000000n)) {
        await this.parallelTransferAll(balances.usdt, balances.trx);
      }
      
    } catch (error) {
      console.error('❌ Execute error:', error.message);
    }
  }
  
  // Monitoring loop
  async startProtection() {
    console.log('🛡️ ANTI-DRAINER TRON PROTECTION STARTED!\n');
    console.log('📋 STRATEGI MAKSIMAL:');
    console.log('   1. Monitor TRX dan USDT balance setiap detik');
    console.log('   2. IMMEDIATE PARALLEL TRANSFER saat ada TRX/USDT masuk');
    console.log('   3. Transfer USDT + TRX BERSAMAAN ke semua RPC');
    console.log('   4. Zero-delay - langsung kirim tanpa tunggu confirmation');
    console.log('   5. Multi-RPC paralel untuk kecepatan maksimal');
    if (this.officialSender) {
      console.log(`   6. Whitelist: ${this.officialSender}`);
    }
    if (this.drainerAddresses.length > 0) {
      console.log(`   7. Known drainers: ${this.drainerAddresses.join(', ')}`);
    }
    console.log('');
    
    // Get initial balances
    let retryCount = 0;
    while (retryCount < 3) {
      try {
        await this.executeProtection();
        console.log('✅ Initial check completed\n');
        break;
      } catch (error) {
        retryCount++;
        console.log(`⚠️ Initial check failed (attempt ${retryCount}/3), retrying...\n`);
        if (retryCount < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    // Monitoring dengan interval sangat cepat
    const monitoringInterval = parseInt(process.env.MONITORING_INTERVAL_MS) || 1000; // 1 detik default
    console.log(`⏱️ Monitoring setiap ${monitoringInterval}ms untuk deteksi maksimal\n`);
    
    setInterval(async () => {
      await this.executeProtection();
    }, monitoringInterval);
  }
}

function validateEnv() {
  const requiredVars = ['PRIVATE_KEY', 'DESTINATION_WALLET'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error(`❌ Missing required .env variables: ${missingVars.join(', ')}`);
    console.error('❌ Please check your .env file');
    console.error('💡 Copy .env.example to .env and fill in your values');
    process.exit(1);
  }
  
  console.log('✅ Environment variables validated');
}

async function main() {
  console.log('🛡️🛡️🛡️ ANTI-DRAINER TRON - MAXIMUM SPEED MODE 🛡️🛡️🛡️\n');
  console.log('🎯 Protection: TRON wallet dengan USDT + TRX');
  console.log('⚡ Speed: PARALLEL transfers di semua RPC');
  console.log('🚀 Trigger: IMMEDIATE saat ada TRX/USDT masuk\n');
  
  validateEnv();
  
  const antiDrainer = new AntiDrainerTron();
  
  try {
    await antiDrainer.setupTronWeb();
    await antiDrainer.startProtection();
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
