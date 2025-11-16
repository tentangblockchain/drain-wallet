const { ethers } = require('ethers');
const AbstractChainMonitor = require('./AbstractChainMonitor');

const EVM_CHAINS = {
  ETHEREUM: {
    name: 'Ethereum',
    chainId: 1,
    usdtContract: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    explorer: 'https://etherscan.io/tx/',
    extraTokens: []
  },
  BASE: {
    name: 'Base',
    chainId: 8453,
    usdtContract: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
    explorer: 'https://basescan.org/tx/',
    extraTokens: []
  },
  ARBITRUM: {
    name: 'Arbitrum',
    chainId: 42161,
    usdtContract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    explorer: 'https://arbiscan.io/tx/',
    extraTokens: [
      {
        name: 'BV3A',
        address: '0x6048Df2D0dB43477eE77ff2e6D86e4339d3d5A66',
        decimals: 18
      }
    ]
  },
  SEPOLIA: {
    name: 'Sepolia',
    chainId: 11155111,
    usdtContract: '0x7169D38820dfd117C3FA1f22a697dBA58d90BA06',
    explorer: 'https://sepolia.etherscan.io/tx/',
    extraTokens: []
  }
};

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)'
];

class EVMChainMonitor extends AbstractChainMonitor {
  constructor(network, config) {
    const chainInfo = EVM_CHAINS[network.toUpperCase()];
    if (!chainInfo) {
      throw new Error(`Unsupported EVM network: ${network}`);
    }

    super(chainInfo.name, config);

    this.network = network.toUpperCase();
    this.chainInfo = chainInfo;
    this.providers = [];
    this.mainProvider = null;
    this.wallet = null;
    this.usdtContract = null;

    this.rpcEndpoints = config.rpcEndpoints || [];

    if (this.rpcEndpoints.length === 0) {
      throw new Error(`No RPC endpoints provided for ${chainInfo.name}`);
    }
  }

  async setupConnection() {
    this.log('🔗 Testing EVM RPC connections...');

    const privateKey = this.config.privateKey;

    const testPromises = this.rpcEndpoints.map(async (endpoint, i) => {
      try {
        const provider = new ethers.JsonRpcProvider(endpoint, {
          chainId: this.chainInfo.chainId,
          name: this.chainInfo.name
        }, {
          staticNetwork: true,
          batchMaxCount: 1
        });

        await Promise.race([
          provider.getBlockNumber(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);

        return { success: true, provider, index: i, endpoint };
      } catch (error) {
        return { success: false, index: i, endpoint, error: error.message };
      }
    });

    const results = await Promise.allSettled(testPromises);

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        const { success, provider, index, endpoint, error } = result.value;
        if (success) {
          this.providers.push(provider);
          this.log(`✅ RPC ${index} connected: ${endpoint}`);
        } else {
          this.log(`❌ RPC ${index} failed: ${endpoint} - ${error}`);
        }
      }
    });

    if (this.providers.length === 0) {
      throw new Error(`❌ All ${this.chainInfo.name} RPC endpoints failed!`);
    }

    this.log(`🚀 ${this.providers.length} ${this.chainInfo.name} RPC endpoints ready!\n`);

    this.mainProvider = this.providers[0];
    this.wallet = new ethers.Wallet(privateKey, this.mainProvider);
    this.usdtContract = new ethers.Contract(
      this.chainInfo.usdtContract,
      ERC20_ABI,
      this.wallet
    );

    this.extraTokenContracts = this.chainInfo.extraTokens.map(token => ({
      name: token.name,
      decimals: token.decimals,
      contract: new ethers.Contract(token.address, ERC20_ABI, this.wallet)
    }));

    this.log(`🔑 Wallet: ${this.wallet.address}`);
    this.log(`📍 Destination: ${this.destinationWallet}`);
    if (this.extraTokenContracts.length > 0) {
      this.log(`🪙 Extra tokens: ${this.extraTokenContracts.map(t => t.name).join(', ')}`);
    }
    this.log('');
  }

  async getBalances() {
    for (let i = 0; i < this.providers.length; i++) {
      try {
        const provider = this.providers[i];
        const walletWithProvider = this.wallet.connect(provider);
        const usdtWithProvider = this.usdtContract.connect(walletWithProvider);

        const balancePromises = [
          provider.getBalance(this.wallet.address),
          usdtWithProvider.balanceOf(this.wallet.address)
        ];

        const extraTokenBalancePromises = this.extraTokenContracts.map(tokenInfo => 
          tokenInfo.contract.connect(walletWithProvider).balanceOf(this.wallet.address)
        );

        const allBalances = await Promise.all([...balancePromises, ...extraTokenBalancePromises]);

        const result = { 
          native: BigInt(allBalances[0].toString()), 
          usdt: BigInt(allBalances[1].toString()), 
          rpcIndex: i,
          extraTokens: {}
        };

        this.extraTokenContracts.forEach((tokenInfo, idx) => {
          result.extraTokens[tokenInfo.name] = BigInt(allBalances[2 + idx].toString());
        });

        return result;

      } catch (error) {
        continue;
      }
    }

    throw new Error(`All ${this.chainInfo.name} RPCs failed`);
  }

  async executeTransfer(ethBalance, usdtAmount, extraTokenBalances = {}) {
    this.log(`\n🚀🚀 PARALLEL TRANSFER ACTIVATED! 🚀🚀`);
    this.log(`🔥 FIRE-AND-FORGET mode - NO waiting for confirmation!`);

    let balanceLog = `💰 USDT: ${this.formatUSDTBalance(usdtAmount)} | ETH: ${this.formatNativeBalance(ethBalance)}`;
    Object.entries(extraTokenBalances).forEach(([tokenName, balance]) => {
      const tokenInfo = this.extraTokenContracts.find(t => t.name === tokenName);
      if (tokenInfo && balance > 0n) {
        const formattedBalance = ethers.formatUnits(balance, tokenInfo.decimals);
        balanceLog += ` | ${tokenName}: ${formattedBalance}`;
      }
    });
    this.log(balanceLog);

    const allPromises = [];
    let usdtAttempted = false;
    let ethAttempted = false;
    const extraTokensAttempted = {};
    const txHashes = [];

    if (usdtAmount > 0n) {
      usdtAttempted = true;
      for (let i = 0; i < this.providers.length; i++) {
        allPromises.push(
          (async (index) => {
            try {
              const provider = this.providers[index];
              const walletWithProvider = this.wallet.connect(provider);
              const usdtWithProvider = this.usdtContract.connect(walletWithProvider);

              const gasLimit = await usdtWithProvider.transfer.estimateGas(
                this.destinationWallet,
                usdtAmount
              ).catch(() => 100000n);

              const tx = await usdtWithProvider.transfer(
                this.destinationWallet,
                usdtAmount,
                { gasLimit }
              );

              txHashes.push({ type: 'USDT', txid: tx.hash });
              this.log(`✅ USDT TX (RPC ${index}): ${tx.hash}`);

              return { success: true, type: 'USDT', index };

            } catch (error) {
              const isInsufficientFunds = error.message.includes('insufficient funds');
              this.log(`❌ USDT RPC ${index}: ${error.message}`);
              return { success: false, type: 'USDT', index, insufficientFunds: isInsufficientFunds };
            }
          })(i)
        );
      }
    }

    for (const tokenInfo of this.extraTokenContracts) {
      const tokenBalance = extraTokenBalances[tokenInfo.name] || 0n;
      if (tokenBalance > 0n) {
        extraTokensAttempted[tokenInfo.name] = true;
        for (let i = 0; i < this.providers.length; i++) {
          allPromises.push(
            (async (index, tInfo, tBalance) => {
              try {
                const provider = this.providers[index];
                const walletWithProvider = this.wallet.connect(provider);
                const tokenWithProvider = tInfo.contract.connect(walletWithProvider);

                const gasLimit = await tokenWithProvider.transfer.estimateGas(
                  this.destinationWallet,
                  tBalance
                ).catch(() => 100000n);

                const tx = await tokenWithProvider.transfer(
                  this.destinationWallet,
                  tBalance,
                  { gasLimit }
                );

                txHashes.push({ type: tInfo.name, txid: tx.hash });
                this.log(`✅ ${tInfo.name} TX (RPC ${index}): ${tx.hash}`);

                return { success: true, type: tInfo.name, index };

              } catch (error) {
                const isInsufficientFunds = error.message.includes('insufficient funds');
                this.log(`❌ ${tInfo.name} RPC ${index}: ${error.message}`);
                return { success: false, type: tInfo.name, index, insufficientFunds: isInsufficientFunds };
              }
            })(i, tokenInfo, tokenBalance)
          );
        }
      }
    }

    const estimatedGasForTransfer = 21000n;
    const feeData = await this.mainProvider.getFeeData().catch(() => ({
      gasPrice: ethers.parseUnits('50', 'gwei')
    }));

    const gasPrice = feeData.gasPrice || ethers.parseUnits('50', 'gwei');
    const estimatedFee = BigInt(estimatedGasForTransfer) * BigInt(gasPrice.toString());
    const feeReserve = estimatedFee * 2n;

    if (ethBalance > feeReserve) {
      ethAttempted = true;
      const amountToSend = ethBalance - feeReserve;

      for (let i = 0; i < this.providers.length; i++) {
        allPromises.push(
          (async (index) => {
            try {
              const provider = this.providers[index];
              const walletWithProvider = this.wallet.connect(provider);

              const tx = await walletWithProvider.sendTransaction({
                to: this.destinationWallet,
                value: amountToSend,
                gasLimit: estimatedGasForTransfer
              });

              txHashes.push({ type: 'ETH', txid: tx.hash });
              this.log(`✅ ETH TX (RPC ${index}): ${tx.hash}`);

              return { success: true, type: 'ETH', index };

            } catch (error) {
              const isInsufficientFunds = error.message.includes('insufficient funds');
              this.log(`❌ ETH RPC ${index}: ${error.message}`);
              return { success: false, type: 'ETH', index, insufficientFunds: isInsufficientFunds };
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
    const ethSuccess = successful.filter(r => r.value.type === 'ETH');
    const overallInsufficientFunds = results.some(r => r.status === 'fulfilled' && r.value.insufficientFunds);

    this.log(`\n📊 BROADCAST RESULTS:`);
    if (usdtAttempted) this.log(`   💵 USDT: ${usdtSuccess.length}/${this.providers.length} broadcasted`);
    if (ethAttempted) this.log(`   💰 ETH: ${ethSuccess.length}/${this.providers.length} broadcasted`);

    Object.entries(extraTokensAttempted).forEach(([tokenName, attempted]) => {
      if (attempted) {
        const tokenSuccess = successful.filter(r => r.value.type === tokenName);
        this.log(`   🪙 ${tokenName}: ${tokenSuccess.length}/${this.providers.length} broadcasted`);
      }
    });

    const hasUsdtSuccess = !usdtAttempted || usdtSuccess.length > 0;
    const hasEthSuccess = !ethAttempted || ethSuccess.length > 0;
    const hasExtraTokensSuccess = Object.keys(extraTokensAttempted).every(tokenName => {
      const tokenSuccess = successful.filter(r => r.value.type === tokenName);
      return tokenSuccess.length > 0;
    });

    if (hasUsdtSuccess && hasEthSuccess && hasExtraTokensSuccess) {
      this.log(`🎯 ASSETS BROADCASTED - Transfers in mempool!\n`);

      txHashes.forEach(tx => this.broadcastedTxHashes.add(tx.txid));

      return { success: true, txHashes };
    } else {
      this.log(`⚠️ Some broadcasts failed - will retry!\n`);
      return { success: false, txHashes: [], insufficientFunds: overallInsufficientFunds };
    }
  }

  formatNativeBalance(balance) {
    return `${ethers.formatEther(balance)} ETH`;
  }

  getMinimumNativeBalance() {
    return ethers.parseEther('0.001');
  }

  getExplorerUrl(txHash) {
    return `${this.chainInfo.explorer}${txHash}`;
  }
}

module.exports = EVMChainMonitor;
module.exports.EVM_CHAINS = EVM_CHAINS;