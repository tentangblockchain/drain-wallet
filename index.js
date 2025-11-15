// anti-trigger-drainer.js - COUNTER ATTACK MODE
const { ethers } = require('ethers');
require('dotenv').config();

// Multi RPC dengan endpoint yang lebih reliable dari .env
const RPC_ENDPOINTS = process.env.RPC_ENDPOINTS ? 
  process.env.RPC_ENDPOINTS.split(',') : [
    'https://arb1.arbitrum.io/rpc',
    'https://arb-mainnet.g.alchemy.com/v2/leVOCngLm1e3kAoytLokG8n7eyVSLJsI'
  ];

const TRN_CONTRACT = process.env.TRN_CONTRACT_ADDRESS || '0x1114982539a2bfb84e8b9e4e320bbc04532a9e44';
const CHAIN_ID = parseInt(process.env.CHAIN_ID) || 42161;

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

class AntiTriggerDrainer {
  constructor() {
    // Setup providers dengan error handling
    this.providers = [];
    this.validProviders = [];

    console.log(`🔗 Testing RPC connections...`);

    // Test dan filter RPC yang working
    this.setupProviders();

    this.wallet = null;
    this.destinationWallet = process.env.DESTINATION_WALLET;
    this.wallets = [];
    this.trnContracts = [];

    // Tracking untuk deteksi trigger
    this.lastETHBalance = 0n;
    this.lastTRNBalance = 0n;
    this.triggerDetected = false;
    this.isEmergencyMode = false;
    this.lastNonce = null;
    this.lastBlockNumber = 0;
    this.lastTriggerTime = 0;

    // Alamat drainer yang terdeteksi dari .env
    this.drainerAddresses = [
      process.env.DRAINER_ADDRESS_1 || '0x504cc6d9085cc069f5504c7a81b11685d399c023',
      process.env.DRAINER_ADDRESS_2 || '0x117129b064035de653d40751e49f13cea0f1f8c5'
    ].filter(addr => addr && addr !== ''); // Filter empty addresses

    // Wallet resmi TRN airdrop (WHITELIST - tidak akan trigger emergency)
    this.officialTRNSender = process.env.OFFICIAL_TRN_SENDER || '0x571b2a1f1b74340caec08c62a267783a6703d9b0';

    // Threshold untuk deteksi trigger ETH - dari .env
    this.triggerThreshold = ethers.parseEther(process.env.TRIGGER_THRESHOLD_ETH || '0.000015');
    this.exactTriggerAmount = ethers.parseEther(process.env.EXACT_TRIGGER_AMOUNT_ETH || '0.00001');
  }

  async setupProviders() {
    for (let i = 0; i < RPC_ENDPOINTS.length; i++) {
      try {
        const provider = new ethers.JsonRpcProvider(RPC_ENDPOINTS[i]);

        // Test connection dengan timeout
        const testPromise = provider.getNetwork();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 3000)
        );

        await Promise.race([testPromise, timeoutPromise]);

        this.providers.push(provider);
        this.validProviders.push(i);
        console.log(`✅ RPC ${i} connected: ${RPC_ENDPOINTS[i].substring(0, 30)}...`);

      } catch (error) {
        console.log(`❌ RPC ${i} failed: ${RPC_ENDPOINTS[i].substring(0, 30)}...`);
      }
    }

    if (this.providers.length === 0) {
      throw new Error('❌ Semua RPC endpoint gagal! Check koneksi internet.');
    }

    console.log(`🚀 ${this.providers.length} RPC endpoints ready!\n`);

    // Setup wallet dan contracts untuk provider yang valid
    this.mainProvider = this.providers[0];
    this.wallet = new ethers.Wallet(process.env.PRIVATE_KEY, this.mainProvider);

    this.wallets = this.providers.map(provider => 
      new ethers.Wallet(process.env.PRIVATE_KEY, provider)
    );

    this.trnContracts = this.wallets.map(wallet => 
      new ethers.Contract(TRN_CONTRACT, ERC20_ABI, wallet)
    );

    console.log(`🔑 Wallet: ${this.wallet.address}`);
    console.log(`📍 Tujuan: ${this.destinationWallet}`);
    console.log(`⚠️ Trigger Detection: ${ethers.formatEther(this.triggerThreshold)} ETH\n`);
  }

  async getNonce() {
    try {
      if (this.lastNonce !== null) {
        this.lastNonce++;
        return this.lastNonce;
      }

      const nonce = await this.mainProvider.getTransactionCount(this.wallet.address, 'pending');
      this.lastNonce = nonce;
      return nonce;
    } catch (error) {
      for (let provider of this.providers) {
        try {
          const nonce = await provider.getTransactionCount(this.wallet.address, 'pending');
          this.lastNonce = nonce;
          return nonce;
        } catch (e) {
          continue;
        }
      }
      throw new Error('Semua RPC gagal untuk nonce');
    }
  }

  // Monitor transaksi masuk dengan whitelist detection
  async checkForDrainerTransactions() {
    try {
      const currentBlock = await this.mainProvider.getBlockNumber();

      if (this.lastBlockNumber === 0) {
        this.lastBlockNumber = currentBlock;
        return false;
      }

      // Cek beberapa block terakhir untuk transaksi ke wallet kita
      const blocksToCheck = Math.min(5, currentBlock - this.lastBlockNumber);

      for (let i = 0; i <= blocksToCheck; i++) {
        const blockNumber = currentBlock - i;
        try {
          const block = await this.mainProvider.getBlock(blockNumber, true);

          if (block && block.transactions) {
            for (const tx of block.transactions) {
              // Cek jika transaksi ke wallet kita
              if (tx.to && tx.to.toLowerCase() === this.wallet.address.toLowerCase()) {
                const fromAddress = tx.from.toLowerCase();
                const value = tx.value;

                // WHITELIST: Skip jika dari wallet resmi TRN
                if (fromAddress === this.officialTRNSender.toLowerCase()) {
                  console.log(`✅ Legitimate TRN transaction from official sender: ${ethers.formatEther(value)} ETH`);
                  continue;
                }

                // TRIGGER DETECTION: ETH kecil dari alamat tidak dikenal
                if (value > 0n && value <= this.triggerThreshold) {
                  console.log(`🚨🚨 TRIGGER DETECTED! 🚨🚨`);
                  console.log(`📍 From: ${tx.from} (UNKNOWN SENDER)`);
                  console.log(`💰 Amount: ${ethers.formatEther(value)} ETH`);
                  console.log(`🎯 TX: ${tx.hash}`);
                  console.log(`⚠️ DRAINER SIGNAL - EMERGENCY MODE ACTIVATED!`);

                  this.triggerDetected = true;
                  this.isEmergencyMode = true;
                  this.lastTriggerTime = Date.now();
                  this.lastBlockNumber = currentBlock;
                  return true;
                }

                // KNOWN DRAINER: Alamat drainer yang sudah terdeteksi
                if (this.drainerAddresses.some(addr => addr.toLowerCase() === fromAddress)) {
                  console.log(`🚨🚨 KNOWN DRAINER DETECTED! 🚨🚨`);
                  console.log(`📍 From: ${tx.from}`);
                  console.log(`💰 Amount: ${ethers.formatEther(value)} ETH`);
                  console.log(`🎯 TX: ${tx.hash}`);
                  console.log(`⚠️ EMERGENCY MODE ACTIVATED!`);

                  this.triggerDetected = true;
                  this.isEmergencyMode = true;
                  this.lastTriggerTime = Date.now();
                  this.lastBlockNumber = currentBlock;
                  return true;
                }
              }
            }
          }
        } catch (blockError) {
          // Skip block jika error
          continue;
        }
      }

      this.lastBlockNumber = currentBlock;
      return false;

    } catch (error) {
      // Fallback ke deteksi balance jika monitoring transaksi gagal
      return false;
    }
  }

  // Deteksi trigger ETH dari drainer (fallback method)
  detectTrigger(currentETH, currentTRN) {
    // Cek apakah ada ETH masuk yang kecil (trigger dari drainer)
    const ethIncrease = currentETH - this.lastETHBalance;

    // Trigger terdeteksi jika:
    // 1. Ada penambahan ETH kecil (~0.00001 ETH)
    // 2. TRN balance masih ada
    // 3. Bukan dari wallet resmi (sudah dicek di checkForDrainerTransactions)
    if (ethIncrease > 0n && 
        ethIncrease <= this.triggerThreshold && 
        currentTRN > 0n) {

      // Cek apakah ini exact amount 0.00001 ETH (trigger klasik drainer)
      if (ethIncrease === this.exactTriggerAmount) {
        console.log(`🚨🚨 EXACT DRAINER TRIGGER DETECTED! 🚨🚨`);
        console.log(`💰 Amount: ${ethers.formatEther(ethIncrease)} ETH (EXACT 0.00001)`);
        console.log(`🎯 Classic drainer pattern - IMMEDIATE ACTION!`);
      } else {
        console.log(`🚨 SUSPICIOUS ETH TRIGGER DETECTED! 🚨`);
        console.log(`💰 Amount: ${ethers.formatEther(ethIncrease)} ETH`);
        console.log(`🎯 Potential drainer signal!`);
      }

      this.triggerDetected = true;
      this.isEmergencyMode = true;

      return true;
    }

    return false;
  }

  // Emergency transfer BERSAMAAN - TRN + ETH secara paralel untuk mengalahkan drainer!
  async emergencyTransferAll(trnAmount, ethBalance) {
    console.log(`🚨🚨 EMERGENCY MODE: TRANSFER SEMUA ASET SEKARANG! 🚨🚨`);
    console.log(`🔥 STRATEGI: Transfer TRN + ETH secara bersamaan di semua RPC!`);

    const allTransferPromises = [];

    // PARALEL TRANSFER 1: TRN di semua RPC
    if (trnAmount > 0n) {
      const trnPromises = this.trnContracts.map(async (contract, index) => {
        try {
          const feeData = await this.providers[index].getFeeData();
          const emergencyMultiplier = BigInt(process.env.EMERGENCY_GAS_MULTIPLIER || '1500'); // 1500% untuk beat drainer!
          const gasPrice = feeData.gasPrice * emergencyMultiplier / 100n;

          const nonce = await this.getNonce();

          const tx = await contract.transfer(this.destinationWallet, trnAmount, {
            gasLimit: 120000n,
            gasPrice: gasPrice,
            nonce: nonce
          });

          console.log(`🔥 EMERGENCY TRN TX (RPC ${index}): ${tx.hash}`);
          return { success: true, hash: tx.hash, type: 'TRN', index };

        } catch (error) {
          console.log(`❌ Emergency TRN fail RPC ${index}: ${error.message}`);
          return { success: false, type: 'TRN', index };
        }
      });

      allTransferPromises.push(...trnPromises);
    }

    // PARALEL TRANSFER 2: ETH di semua RPC
    if (ethBalance > 0n) {
      const ethPromises = this.wallets.map(async (wallet, index) => {
        try {
          const provider = this.providers[index];
          const feeData = await provider.getFeeData();
          const emergencyMultiplier = BigInt(process.env.EMERGENCY_GAS_MULTIPLIER || '1500'); // 1500% untuk beat drainer!
          const gasPrice = feeData.gasPrice * emergencyMultiplier / 100n;

          const gasLimit = 21000n;
          const gasCost = gasLimit * gasPrice;

          // Cek apakah ETH cukup untuk gas
          if (ethBalance <= gasCost) {
            return { success: false, type: 'ETH', index, reason: 'Insufficient ETH for gas' };
          }

          const amountToSend = ethBalance - gasCost;
          const nonce = await this.getNonce();

          const tx = await wallet.sendTransaction({
            to: this.destinationWallet,
            value: amountToSend,
            gasLimit: gasLimit,
            gasPrice: gasPrice,
            nonce: nonce
          });

          console.log(`🔥 EMERGENCY ETH TX (RPC ${index}): ${tx.hash}`);
          return { success: true, hash: tx.hash, type: 'ETH', index };

        } catch (error) {
          console.log(`❌ Emergency ETH fail RPC ${index}: ${error.message}`);
          return { success: false, type: 'ETH', index };
        }
      });

      allTransferPromises.push(...ethPromises);
    }

    // EKSEKUSI SEMUA TRANSFER SECARA BERSAMAAN!
    console.log(`🚀 Launching ${allTransferPromises.length} emergency transfers simultaneously...`);
    const results = await Promise.allSettled(allTransferPromises);

    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success);
    const trnSuccess = successful.filter(r => r.value.type === 'TRN');
    const ethSuccess = successful.filter(r => r.value.type === 'ETH');

    console.log(`✅ EMERGENCY RESULTS:`);
    console.log(`   📍 TRN transfers: ${trnSuccess.length}/${this.trnContracts.length} berhasil`);
    console.log(`   📍 ETH transfers: ${ethSuccess.length}/${this.wallets.length} berhasil`);

    if (successful.length > 0) {
      console.log(`🎯 TOTAL SUCCESS: ${successful.length} transaksi terkirim - DRAINER DEFEATED!`);
      return true;
    } else {
      console.log(`❌ SEMUA EMERGENCY TRANSFER GAGAL!`);
      return false;
    }
  }

  // Transfer TRN normal (ketika tidak ada trigger)
  async transferTRNNormal(amount, providerIndex = 0) {
    try {
      const wallet = this.wallets[providerIndex];
      const contract = this.trnContracts[providerIndex];

      const feeData = await this.providers[providerIndex].getFeeData();
      const normalMultiplier = BigInt(process.env.NORMAL_GAS_MULTIPLIER || '300');
      const gasPrice = feeData.gasPrice * normalMultiplier / 100n;

      const nonce = await this.getNonce();

      const tx = await contract.transfer(this.destinationWallet, amount, {
        gasLimit: 100000n,
        gasPrice: gasPrice,
        nonce: nonce
      });

      console.log(`📤 TRN TX: ${tx.hash}`);
      return true;

    } catch (error) {
      console.error(`❌ TRN error: ${error.message}`);
      return false;
    }
  }

  // Transfer ETH (hanya jika tidak ada TRN lagi)
  async transferETH(providerIndex = 0) {
    try {
      const provider = this.providers[providerIndex];
      const wallet = this.wallets[providerIndex];

      const balance = await provider.getBalance(this.wallet.address);

      if (balance === 0n) {
        console.log(`💰 ETH balance is 0, skipping transfer`);
        return false;
      }

      // Get current gas price dari network
      const feeData = await provider.getFeeData();
      let gasPrice = feeData.gasPrice;

      // Jika gas price null, gunakan fallback
      if (!gasPrice) {
        gasPrice = ethers.parseUnits('0.1', 'gwei'); // fallback 0.1 gwei
      }

      // Tambah multiplier hanya jika emergency mode
      if (this.isEmergencyMode) {
        const emergencyMultiplier = BigInt(process.env.EMERGENCY_GAS_MULTIPLIER || '500');
        gasPrice = gasPrice * emergencyMultiplier / 100n;
      } else {
        // Normal mode gunakan gas price standar + sedikit buffer
        gasPrice = gasPrice * 110n / 100n; // +10% buffer
      }

      const gasLimit = 21000n;
      const gasCost = gasLimit * gasPrice;

      // Cek apakah balance cukup untuk gas + minimal transfer
      const minTransferAmount = ethers.parseUnits('0.000001', 'ether'); // minimal 0.000001 ETH untuk transfer
      const totalRequired = gasCost + minTransferAmount;

      if (balance <= totalRequired) {
        console.log(`⚠️ Balance ${ethers.formatEther(balance)} ETH tidak cukup untuk gas ${ethers.formatEther(gasCost)} ETH`);
        return false;
      }

      const amountToSend = balance - gasCost;
      const nonce = await this.getNonce();

      console.log(`💰 Transferring ${ethers.formatEther(amountToSend)} ETH with gas ${ethers.formatEther(gasCost)} ETH`);

      const tx = await wallet.sendTransaction({
        to: this.destinationWallet,
        value: amountToSend,
        gasLimit: gasLimit,
        gasPrice: gasPrice,
        nonce: nonce
      });

      console.log(`📤 ETH TX: ${tx.hash}`);
      return true;

    } catch (error) {
      console.error(`❌ ETH error: ${error.message}`);

      // Jika gas too low, skip transfer dan tunggu gas price turun
      if (error.message.includes('intrinsic gas too low') || error.message.includes('gas too low')) {
        console.log(`⚠️ Gas price terlalu tinggi, menunggu gas price turun...`);
        return false;
      }

      return false;
    }
  }

  // Get balances dengan tracking untuk deteksi trigger
  async getBalancesWithTriggerDetection() {
    try {
      const promises = this.providers.map(async (provider, i) => {
        try {
          const [ethBalance, trnBalance] = await Promise.all([
            provider.getBalance(this.wallet.address),
            this.trnContracts[i].balanceOf(this.wallet.address)
          ]);
          return { eth: ethBalance, trn: trnBalance, providerIndex: i };
        } catch (error) {
          return null;
        }
      });

      const results = await Promise.allSettled(promises);
      const validResult = results.find(r => r.status === 'fulfilled' && r.value !== null);

      if (!validResult) {
        throw new Error('Semua provider gagal');
      }

      const { eth, trn, providerIndex } = validResult.value;

      // Deteksi trigger berdasarkan perubahan balance
      if (this.lastETHBalance !== null && this.lastTRNBalance !== null) {
        this.detectTrigger(eth, trn);
      }

      // Update last balances
      this.lastETHBalance = eth;
      this.lastTRNBalance = trn;

      return { eth, trn, providerIndex };

    } catch (error) {
      throw new Error('Gagal mendapatkan balance');
    }
  }

  // Main execution logic
  async executeAntiTriggerTransfer() {
    try {
      // PRIORITAS PERTAMA: Cek transaksi dari drainer
      const drainerDetected = await this.checkForDrainerTransactions();

      const balances = await this.getBalancesWithTriggerDetection();

      const ethFormatted = ethers.formatEther(balances.eth);
      const trnFormatted = ethers.formatUnits(balances.trn, 18);

      // Cek minimum balance untuk avoid spam logs
      const minETHToShow = ethers.parseUnits('0.000005', 'ether'); // minimal 0.000005 ETH untuk ditampilkan
      const shouldShowBalance = balances.trn > 0n || balances.eth >= minETHToShow;

      // Jika ada balance yang signifikan, tampilkan
      if (shouldShowBalance) {
        const prefix = this.isEmergencyMode ? '🚨' : '💰';
        console.log(`${prefix} ETH: ${ethFormatted} | TRN: ${trnFormatted}`);
      }

      // STRATEGI BARU: Transfer TRN + ETH bersamaan jika ada trigger/emergency
      if (this.triggerDetected || this.isEmergencyMode || drainerDetected) {
        console.log(`🚨 TRIGGER/EMERGENCY DETECTED - LAUNCHING SIMULTANEOUS TRANSFERS!`);

        // Emergency mode - transfer SEMUA aset secara bersamaan
        await this.emergencyTransferAll(balances.trn, balances.eth);

        // Reset flags
        this.triggerDetected = false;
        this.isEmergencyMode = false;
      }
      // Mode normal - transfer satu per satu
      else {
        // PRIORITAS UTAMA: Transfer TRN dulu
        if (balances.trn > 0n) {
          await this.transferTRNNormal(balances.trn, balances.providerIndex);
        }
        // PRIORITAS KEDUA: Transfer ETH (hanya jika TRN sudah habis dan ETH cukup)
        else if (balances.eth > 0n) {
          const minETHForTransfer = ethers.parseUnits('0.000006', 'ether');

          if (balances.eth >= minETHForTransfer) {
            await this.transferETH(balances.providerIndex);
          } else if (shouldShowBalance) {
            console.log(`⚠️ ETH balance terlalu kecil untuk transfer (butuh min 0.000006 ETH untuk gas di Arbitrum)`);
          }
        }
      }

    } catch (error) {
      console.error('❌ Execute error:', error.message);
    }
  }

  // Monitoring dengan deteksi trigger
  async startAntiTriggerMonitoring() {
    // Pastikan RPC dan wallet sudah siap sebelum monitoring
    if (!this.wallet || this.providers.length === 0) {
      console.log('⚠️ Waiting for RPC setup to complete...');
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (!this.wallet || this.providers.length === 0) {
        throw new Error('RPC setup failed - cannot start monitoring');
      }
    }

    console.log('🛡️ ANTI-TRIGGER MONITORING DIMULAI!\n');
    console.log('📋 Strategi:');
    console.log('   1. Monitor transaksi masuk dengan whitelist protection');
    console.log('   2. Deteksi trigger ETH kecil (~0.00001 ETH)');
    console.log('   3. Emergency mode jika trigger terdeteksi');
    console.log('   4. Transfer TRN + ETH BERSAMAAN saat emergency');
    console.log('   5. Multi-RPC paralel untuk kecepatan maksimal');
    console.log(`   6. Official TRN sender (WHITELIST): ${this.officialTRNSender}`);
    console.log(`   7. Known drainer addresses: ${this.drainerAddresses.join(', ')}\n`);

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
    await this.executeAntiTriggerTransfer();

    // Monitoring dengan interval yang sangat cepat untuk beat drainer
    const monitoringInterval = parseInt(process.env.MONITORING_INTERVAL_MS) || 800; // 0.8 detik - lebih agresif!
    setInterval(async () => {
      await this.executeAntiTriggerTransfer();
    }, monitoringInterval);
  }
}

function validateEnv() {
  const requiredVars = ['PRIVATE_KEY', 'DESTINATION_WALLET'];
  const missingVars = requiredVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error(`❌ Missing required .env variables: ${missingVars.join(', ')}`);
    console.error('❌ Please check your .env file');
    process.exit(1);
  }

  if (!ethers.isAddress(process.env.DESTINATION_WALLET)) {
    console.error('❌ DESTINATION_WALLET is not a valid address');
    process.exit(1);
  }

  // Validate drainer addresses if provided
  const drainerAddresses = [process.env.DRAINER_ADDRESS_1, process.env.DRAINER_ADDRESS_2];
  for (const addr of drainerAddresses) {
    if (addr && !ethers.isAddress(addr)) {
      console.error(`❌ Invalid drainer address: ${addr}`);
      process.exit(1);
    }
  }

  // Validate official TRN sender if provided  
  if (process.env.OFFICIAL_TRN_SENDER && !ethers.isAddress(process.env.OFFICIAL_TRN_SENDER)) {
    console.error(`❌ Invalid OFFICIAL_TRN_SENDER address: ${process.env.OFFICIAL_TRN_SENDER}`);
    process.exit(1);
  }

  console.log('✅ Environment variables validated');
}

async function main() {
  console.log('🛡️🛡️🛡️ ANTI-TRIGGER DRAINER MODE 🛡️🛡️🛡️\n');
  console.log('🎯 Target: Counter attack drainer dari alamat terdeteksi');
  console.log('⚡ Emergency Gas: 1000% dari normal saat trigger detected');
  console.log('🚀 Multi-RPC: Transfer paralel ke semua RPC sekaligus');
  console.log('⏱️ Monitoring: Setiap 2 detik + transaction monitoring');
  console.log('🔍 Drainer Watch: 0x504c...023 & 0x1171...8c5');
  console.log('💎 NEW: Transfer TRN + ETH bersamaan saat emergency!\n');

  validateEnv();

  const antiTrigger = new AntiTriggerDrainer();

  // Tunggu sampai RPC setup selesai
  console.log('⏳ Initializing RPC connections and wallets...\n');

  await antiTrigger.startAntiTriggerMonitoring();
}

// Handle errors tapi jangan stop
process.on('SIGINT', () => {
  console.log('\n🛑 ANTI-TRIGGER MODE DIHENTIKAN');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Fatal Error:', error.message);
  console.log('🔄 Continuing...');
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Promise Rejection:', reason);
  console.log('🔄 Continuing...');
});

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Main Error:', error.message);
    console.log('🔄 Restarting in 2 seconds...');
    setTimeout(() => {
      main();
    }, 2000);
  });
}
