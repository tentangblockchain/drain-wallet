// anti-drainer-tron.js - TRON WALLET PROTECTION
const TronWeb = require('tronweb');
require('dotenv').config();

// Multi RPC endpoints untuk TRON
const RPC_ENDPOINTS = process.env.RPC_ENDPOINTS ? 
  process.env.RPC_ENDPOINTS.split(',') : [
    'https://api.trongrid.io',
    'https://api.tronstack.io',
    'https://api.shasta.trongrid.io'
  ];

// USDT Contract Address (TRC20) - Default USDT di mainnet
const USDT_CONTRACT = process.env.USDT_CONTRACT_ADDRESS || 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';

// TRC20 ABI untuk USDT
const TRC20_ABI = [
  {
    "constant": true,
    "inputs": [{"name": "who", "type": "address"}],
    "name": "balanceOf",
    "outputs": [{"name": "", "type": "uint256"}],
    "type": "function"
  },
  {
    "constant": false,
    "inputs": [
      {"name": "to", "type": "address"},
      {"name": "value", "type": "uint256"}
    ],
    "name": "transfer",
    "outputs": [{"name": "", "type": "bool"}],
    "type": "function"
  },
  {
    "constant": true,
    "inputs": [],
    "name": "decimals",
    "outputs": [{"name": "", "type": "uint8"}],
    "type": "function"
  }
];

class AntiDrainerTron {
  constructor() {
    this.tronWebs = [];
    this.validRpcIndexes = [];
    this.mainTronWeb = null;
    
    this.destinationWallet = process.env.DESTINATION_WALLET;
    this.usdtContracts = [];
    
    // Tracking untuk deteksi trigger
    this.lastTRXBalance = 0n;
    this.lastUSDTBalance = 0n;
    this.triggerDetected = false;
    this.isEmergencyMode = false;
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
    this.exactTriggerAmount = BigInt(parseFloat(process.env.EXACT_TRIGGER_AMOUNT_TRX || '0.05') * 1000000);
    
    // Fee limits (dalam SUN)
    this.normalFeeLimit = parseInt(process.env.NORMAL_FEE_LIMIT) || 10000000; // 10 TRX
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
        
        // Setup USDT contract
        try {
          const usdtContract = await tronWeb.contract(TRC20_ABI, USDT_CONTRACT);
          this.usdtContracts.push(usdtContract);
        } catch (err) {
          console.log(`⚠️ Warning: USDT contract setup failed for RPC ${i}`);
          this.usdtContracts.push(null);
        }
        
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
    console.log(`⚠️ Trigger Detection: ${this.triggerThreshold / 1000000n} TRX\n`);
  }
  
  // Konversi SUN ke TRX untuk display
  sunToTrx(sun) {
    return Number(sun) / 1000000;
  }
  
  // Monitor transaksi masuk dengan whitelist detection
  async checkForDrainerTransactions() {
    try {
      const currentBlock = await this.mainTronWeb.trx.getCurrentBlock();
      const currentBlockNumber = currentBlock.block_header.raw_data.number;
      
      if (this.lastBlockNumber === 0) {
        this.lastBlockNumber = currentBlockNumber;
        return false;
      }
      
      const myAddress = this.mainTronWeb.defaultAddress.base58;
      
      // Cek transaksi ke wallet kita di block terakhir
      try {
        const transactions = await this.mainTronWeb.trx.getTransactionsRelated(myAddress, 'to', 10);
        
        if (transactions && transactions.length > 0) {
          for (const tx of transactions) {
            if (!tx.raw_data || !tx.raw_data.contract) continue;
            
            const contract = tx.raw_data.contract[0];
            if (contract.type === 'TransferContract') {
              const value = BigInt(contract.parameter.value.amount || 0);
              const fromAddress = this.mainTronWeb.address.fromHex(contract.parameter.value.owner_address);
              
              // WHITELIST: Skip jika dari official sender
              if (this.officialSender && fromAddress === this.officialSender) {
                console.log(`✅ Legitimate transaction from official sender: ${this.sunToTrx(value)} TRX`);
                continue;
              }
              
              // TRIGGER DETECTION: TRX kecil dari alamat tidak dikenal
              if (value > 0n && value <= this.triggerThreshold) {
                console.log(`🚨🚨 TRIGGER DETECTED! 🚨🚨`);
                console.log(`📍 From: ${fromAddress} (UNKNOWN SENDER)`);
                console.log(`💰 Amount: ${this.sunToTrx(value)} TRX`);
                console.log(`🎯 TX: ${tx.txID}`);
                console.log(`⚠️ DRAINER SIGNAL - EMERGENCY MODE ACTIVATED!`);
                
                this.triggerDetected = true;
                this.isEmergencyMode = true;
                this.lastBlockNumber = currentBlockNumber;
                return true;
              }
              
              // KNOWN DRAINER: Alamat drainer yang sudah terdeteksi
              if (this.drainerAddresses.some(addr => addr === fromAddress)) {
                console.log(`🚨🚨 KNOWN DRAINER DETECTED! 🚨🚨`);
                console.log(`📍 From: ${fromAddress}`);
                console.log(`💰 Amount: ${this.sunToTrx(value)} TRX`);
                console.log(`🎯 TX: ${tx.txID}`);
                console.log(`⚠️ EMERGENCY MODE ACTIVATED!`);
                
                this.triggerDetected = true;
                this.isEmergencyMode = true;
                this.lastBlockNumber = currentBlockNumber;
                return true;
              }
            }
          }
        }
      } catch (txError) {
        // Skip jika error getting transactions
      }
      
      this.lastBlockNumber = currentBlockNumber;
      return false;
      
    } catch (error) {
      return false;
    }
  }
  
  // Deteksi trigger berdasarkan perubahan balance (fallback method)
  detectTrigger(currentTRX, currentUSDT) {
    const trxIncrease = currentTRX - this.lastTRXBalance;
    
    // Trigger terdeteksi jika ada penambahan TRX kecil dan masih ada USDT
    if (trxIncrease > 0n && 
        trxIncrease <= this.triggerThreshold && 
        currentUSDT > 0n) {
      
      if (trxIncrease === this.exactTriggerAmount) {
        console.log(`🚨🚨 EXACT DRAINER TRIGGER DETECTED! 🚨🚨`);
        console.log(`💰 Amount: ${this.sunToTrx(trxIncrease)} TRX (EXACT ${this.sunToTrx(this.exactTriggerAmount)})`);
        console.log(`🎯 Classic drainer pattern - IMMEDIATE ACTION!`);
      } else {
        console.log(`🚨 SUSPICIOUS TRX TRIGGER DETECTED! 🚨`);
        console.log(`💰 Amount: ${this.sunToTrx(trxIncrease)} TRX`);
        console.log(`🎯 Potential drainer signal!`);
      }
      
      this.triggerDetected = true;
      this.isEmergencyMode = true;
      return true;
    }
    
    return false;
  }
  
  // Emergency transfer BERSAMAAN - USDT + TRX secara paralel
  async emergencyTransferAll(usdtAmount, trxBalance) {
    console.log(`🚨🚨 EMERGENCY MODE: TRANSFER SEMUA ASET SEKARANG! 🚨🚨`);
    console.log(`🔥 STRATEGI: Transfer USDT + TRX secara bersamaan di semua RPC!`);
    
    const allTransferPromises = [];
    
    // PARALEL TRANSFER 1: USDT di semua RPC
    if (usdtAmount > 0n) {
      for (let i = 0; i < this.tronWebs.length; i++) {
        if (!this.usdtContracts[i]) continue;
        
        allTransferPromises.push(
          (async (index) => {
            try {
              const tronWeb = this.tronWebs[index];
              const contract = this.usdtContracts[index];
              
              const tx = await contract.transfer(
                this.destinationWallet,
                usdtAmount.toString()
              ).send({
                feeLimit: this.emergencyFeeLimit,
                shouldPollResponse: false
              });
              
              console.log(`🔥 EMERGENCY USDT TX (RPC ${index}): ${tx}`);
              return { success: true, hash: tx, type: 'USDT', index };
              
            } catch (error) {
              console.log(`❌ Emergency USDT fail RPC ${index}: ${error.message}`);
              return { success: false, type: 'USDT', index };
            }
          })(i)
        );
      }
    }
    
    // PARALEL TRANSFER 2: TRX di semua RPC
    if (trxBalance > 0n) {
      for (let i = 0; i < this.tronWebs.length; i++) {
        allTransferPromises.push(
          (async (index) => {
            try {
              const tronWeb = this.tronWebs[index];
              
              // Reserve untuk fee (minimal 5 TRX)
              const feeReserve = BigInt(5000000); // 5 TRX
              
              if (trxBalance <= feeReserve) {
                return { success: false, type: 'TRX', index, reason: 'Insufficient TRX for fee' };
              }
              
              const amountToSend = trxBalance - feeReserve;
              
              const tx = await tronWeb.trx.sendTransaction(
                this.destinationWallet,
                Number(amountToSend)
              );
              
              console.log(`🔥 EMERGENCY TRX TX (RPC ${index}): ${tx.txid || tx.transaction?.txID}`);
              return { success: true, hash: tx.txid || tx.transaction?.txID, type: 'TRX', index };
              
            } catch (error) {
              console.log(`❌ Emergency TRX fail RPC ${index}: ${error.message}`);
              return { success: false, type: 'TRX', index };
            }
          })(i)
        );
      }
    }
    
    // EKSEKUSI SEMUA TRANSFER SECARA BERSAMAAN!
    console.log(`🚀 Launching ${allTransferPromises.length} emergency transfers simultaneously...`);
    const results = await Promise.allSettled(allTransferPromises);
    
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const usdtSuccess = successful.filter(r => r.value.type === 'USDT');
    const trxSuccess = successful.filter(r => r.value.type === 'TRX');
    
    console.log(`✅ EMERGENCY RESULTS:`);
    console.log(`   📍 USDT transfers: ${usdtSuccess.length}/${this.usdtContracts.filter(c => c).length} berhasil`);
    console.log(`   📍 TRX transfers: ${trxSuccess.length}/${this.tronWebs.length} berhasil`);
    
    if (successful.length > 0) {
      console.log(`🎯 TOTAL SUCCESS: ${successful.length} transaksi terkirim - DRAINER DEFEATED!`);
      return true;
    } else {
      console.log(`❌ SEMUA EMERGENCY TRANSFER GAGAL!`);
      return false;
    }
  }
  
  // Transfer USDT normal (ketika tidak ada trigger)
  async transferUSDTNormal(amount, rpcIndex = 0) {
    try {
      if (!this.usdtContracts[rpcIndex]) {
        console.log(`⚠️ USDT contract not available for RPC ${rpcIndex}`);
        return false;
      }
      
      const contract = this.usdtContracts[rpcIndex];
      
      const tx = await contract.transfer(
        this.destinationWallet,
        amount.toString()
      ).send({
        feeLimit: this.normalFeeLimit,
        shouldPollResponse: false
      });
      
      console.log(`📤 USDT TX: ${tx}`);
      return true;
      
    } catch (error) {
      console.error(`❌ USDT error: ${error.message}`);
      return false;
    }
  }
  
  // Transfer TRX (setelah USDT habis)
  async transferTRX(rpcIndex = 0) {
    try {
      const tronWeb = this.tronWebs[rpcIndex];
      const balance = await tronWeb.trx.getBalance(tronWeb.defaultAddress.base58);
      
      if (balance === 0) {
        console.log(`💰 TRX balance is 0, skipping transfer`);
        return false;
      }
      
      // Reserve untuk fee (minimal 2 TRX untuk safety)
      const feeReserve = 2000000; // 2 TRX
      const minTransferAmount = 1000000; // minimal 1 TRX untuk transfer
      
      if (balance <= feeReserve + minTransferAmount) {
        console.log(`⚠️ Balance ${this.sunToTrx(balance)} TRX tidak cukup untuk transfer (butuh min ${this.sunToTrx(feeReserve + minTransferAmount)} TRX)`);
        return false;
      }
      
      const amountToSend = balance - feeReserve;
      
      console.log(`💰 Transferring ${this.sunToTrx(amountToSend)} TRX (reserve ${this.sunToTrx(feeReserve)} TRX untuk fee)`);
      
      const tx = await tronWeb.trx.sendTransaction(this.destinationWallet, amountToSend);
      
      console.log(`📤 TRX TX: ${tx.txid || tx.transaction?.txID}`);
      return true;
      
    } catch (error) {
      console.error(`❌ TRX error: ${error.message}`);
      return false;
    }
  }
  
  // Get balances dengan tracking untuk deteksi trigger
  async getBalancesWithTriggerDetection() {
    try {
      const promises = this.tronWebs.map(async (tronWeb, i) => {
        try {
          const address = tronWeb.defaultAddress.base58;
          
          // Get TRX balance
          const trxBalance = BigInt(await tronWeb.trx.getBalance(address));
          
          // Get USDT balance
          let usdtBalance = 0n;
          if (this.usdtContracts[i]) {
            try {
              const balance = await this.usdtContracts[i].balanceOf(address).call();
              usdtBalance = BigInt(balance.toString());
            } catch (err) {
              // USDT balance gagal, gunakan 0
            }
          }
          
          return { trx: trxBalance, usdt: usdtBalance, rpcIndex: i };
        } catch (error) {
          return null;
        }
      });
      
      const results = await Promise.allSettled(promises);
      const validResult = results.find(r => r.status === 'fulfilled' && r.value !== null);
      
      if (!validResult) {
        throw new Error('Semua provider gagal');
      }
      
      const { trx, usdt, rpcIndex } = validResult.value;
      
      // Deteksi trigger berdasarkan perubahan balance
      if (this.lastTRXBalance !== null && this.lastUSDTBalance !== null) {
        this.detectTrigger(trx, usdt);
      }
      
      // Update last balances
      this.lastTRXBalance = trx;
      this.lastUSDTBalance = usdt;
      
      return { trx, usdt, rpcIndex };
      
    } catch (error) {
      throw new Error('Gagal mendapatkan balance');
    }
  }
  
  // Main execution logic
  async executeAntiDrainerTransfer() {
    try {
      // PRIORITAS PERTAMA: Cek transaksi dari drainer
      const drainerDetected = await this.checkForDrainerTransactions();
      
      const balances = await this.getBalancesWithTriggerDetection();
      
      const trxFormatted = this.sunToTrx(balances.trx);
      const usdtFormatted = Number(balances.usdt) / 1000000; // USDT has 6 decimals
      
      // Cek minimum balance untuk avoid spam logs
      const minTRXToShow = 100000n; // minimal 0.1 TRX
      const shouldShowBalance = balances.usdt > 0n || balances.trx >= minTRXToShow;
      
      // Jika ada balance yang signifikan, tampilkan
      if (shouldShowBalance) {
        const prefix = this.isEmergencyMode ? '🚨' : '💰';
        console.log(`${prefix} TRX: ${trxFormatted.toFixed(6)} | USDT: ${usdtFormatted.toFixed(2)}`);
      }
      
      // STRATEGI: Transfer USDT + TRX bersamaan jika ada trigger/emergency
      if (this.triggerDetected || this.isEmergencyMode || drainerDetected) {
        console.log(`🚨 TRIGGER/EMERGENCY DETECTED - LAUNCHING SIMULTANEOUS TRANSFERS!`);
        
        // Emergency mode - transfer SEMUA aset secara bersamaan
        await this.emergencyTransferAll(balances.usdt, balances.trx);
        
        // Reset flags
        this.triggerDetected = false;
        this.isEmergencyMode = false;
      }
      // Mode normal - transfer satu per satu
      else {
        // PRIORITAS UTAMA: Transfer USDT dulu
        if (balances.usdt > 0n) {
          await this.transferUSDTNormal(balances.usdt, balances.rpcIndex);
        }
        // PRIORITAS KEDUA: Transfer TRX (hanya jika USDT sudah habis)
        else if (balances.trx > 0n) {
          const minTRXForTransfer = 3000000n; // 3 TRX (1 untuk transfer + 2 untuk fee)
          
          if (balances.trx >= minTRXForTransfer) {
            await this.transferTRX(balances.rpcIndex);
          } else if (shouldShowBalance) {
            console.log(`⚠️ TRX balance terlalu kecil untuk transfer (butuh min 3 TRX)`);
          }
        }
      }
      
    } catch (error) {
      console.error('❌ Execute error:', error.message);
    }
  }
  
  // Monitoring dengan deteksi trigger
  async startAntiDrainerMonitoring() {
    console.log('🛡️ ANTI-DRAINER TRON MONITORING DIMULAI!\n');
    console.log('📋 Strategi:');
    console.log('   1. Monitor transaksi masuk dengan whitelist protection');
    console.log('   2. Deteksi trigger TRX kecil (default ~0.1 TRX)');
    console.log('   3. Emergency mode jika trigger terdeteksi');
    console.log('   4. Transfer USDT + TRX BERSAMAAN saat emergency');
    console.log('   5. Multi-RPC paralel untuk kecepatan maksimal');
    if (this.officialSender) {
      console.log(`   6. Official sender (WHITELIST): ${this.officialSender}`);
    }
    if (this.drainerAddresses.length > 0) {
      console.log(`   7. Known drainer addresses: ${this.drainerAddresses.join(', ')}`);
    }
    console.log('');
    
    // Get initial balances dengan retry
    let retryCount = 0;
    while (retryCount < 3) {
      try {
        await this.getBalancesWithTriggerDetection();
        console.log('✅ Initial balance check completed\n');
        break;
      } catch (error) {
        retryCount++;
        console.log(`⚠️ Initial balance check failed (attempt ${retryCount}/3), retrying...\n`);
        if (retryCount < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    // Transfer pertama jika ada balance
    await this.executeAntiDrainerTransfer();
    
    // Monitoring dengan interval
    const monitoringInterval = parseInt(process.env.MONITORING_INTERVAL_MS) || 1000; // 1 detik
    setInterval(async () => {
      await this.executeAntiDrainerTransfer();
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
  console.log('🛡️🛡️🛡️ ANTI-DRAINER TRON MODE 🛡️🛡️🛡️\n');
  console.log('🎯 Target: Protect TRON wallet dari drainer attacks');
  console.log('⚡ Emergency Mode: Multi-RPC parallel transfers saat trigger detected');
  console.log('🚀 Assets: TRX + USDT (TRC20)');
  console.log('⏱️ Monitoring: Real-time balance & transaction monitoring\n');
  
  validateEnv();
  
  const antiDrainer = new AntiDrainerTron();
  
  try {
    await antiDrainer.setupTronWeb();
    await antiDrainer.startAntiDrainerMonitoring();
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main();
