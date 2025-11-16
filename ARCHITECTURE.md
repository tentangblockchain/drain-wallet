# Multi-Chain Anti-Drainer Architecture

## Overview
Arsitektur modular untuk monitoring dan protecting multiple blockchain networks secara bersamaan.

## Design Principles
1. **Modular**: Setiap chain memiliki monitor class sendiri
2. **Extensible**: Mudah menambahkan chain baru
3. **Non-Blocking**: Semua chain monitoring berjalan parallel
4. **Independent**: Kegagalan satu chain tidak mempengaruhi chain lain
5. **Backward Compatible**: TRON monitoring tetap berjalan seperti sebelumnya

## Architecture Layers

### 1. Abstract Base Class
**AbstractChainMonitor** - Interface dasar untuk semua chain monitors
- `setupConnection()` - Setup RPC connections
- `getBalances()` - Get native coin + USDT balance
- `detectIncomingTransfer()` - Detect balance increase
- `executeTransfer()` - Execute transfer to safe wallet
- `startMonitoring()` - Start monitoring loop

### 2. Chain-Specific Monitors

#### TronChainMonitor
- Extends AbstractChainMonitor
- Refactored dari kode existing
- Monitoring: TRX + USDT (TRC20)
- RPC: TronGrid, TronStack

#### EVMChainMonitor
- Extends AbstractChainMonitor
- Monitoring: ETH + USDT (ERC20)
- Supported Networks:
  - Ethereum Mainnet (chainId: 1)
  - Base Network (chainId: 8453)
  - Arbitrum (chainId: 42161)
  - Sepolia Testnet (chainId: 11155111)
- RPC: Infura, Alchemy, Public RPCs

#### SolanaChainMonitor
- Extends AbstractChainMonitor
- Monitoring: SOL + USDT (SPL Token)
- RPC: Solana Mainnet/Devnet RPCs

### 3. Orchestrator Layer
**MultiChainOrchestrator** - Manages all chain monitors
- Initialize semua enabled chain monitors
- Start all monitors in parallel
- Aggregate status/logs dari semua chains
- Handle global configuration

## File Structure
```
/
├── index.js                    # Main entry point
├── monitors/
│   ├── AbstractChainMonitor.js # Base class
│   ├── TronChainMonitor.js     # TRON implementation
│   ├── EVMChainMonitor.js      # EVM chains implementation
│   └── SolanaChainMonitor.js   # Solana implementation
├── MultiChainOrchestrator.js   # Orchestrator
├── .env                        # Environment config
└── .env.example                # Example config

```

## Configuration Strategy
Environment variables organized by chain:
```
# Global
DESTINATION_WALLET=0x...
MONITORING_INTERVAL_MS=1000

# TRON
TRON_ENABLED=true
TRON_PRIVATE_KEY=...
TRON_RPC_ENDPOINTS=...

# Ethereum
ETH_ENABLED=true
ETH_PRIVATE_KEY=...
ETH_RPC_ENDPOINTS=...

# Base
BASE_ENABLED=true
BASE_PRIVATE_KEY=...
BASE_RPC_ENDPOINTS=...

# Arbitrum
ARB_ENABLED=true
ARB_PRIVATE_KEY=...
ARB_RPC_ENDPOINTS=...

# Sepolia
SEPOLIA_ENABLED=true
SEPOLIA_PRIVATE_KEY=...
SEPOLIA_RPC_ENDPOINTS=...

# Solana
SOL_ENABLED=true
SOL_PRIVATE_KEY=...
SOL_RPC_ENDPOINTS=...
```

## Monitoring Logic (Sama untuk semua chains)
1. **Initial Check**: Detect existing balances
2. **Balance Tracking**: Track previous balance state
3. **Increase Detection**: Detect native coin OR USDT increase
4. **Auto Transfer**: Transfer ALL assets (native + USDT) when triggered
5. **Retry Logic**: Exponential backoff on failures
6. **Multisig Detection**: Stop if multisig detected

## Transaction Priority
1. Deteksi incoming transfer (native coin increase)
2. Langsung transfer USDT + Native coin secara parallel
3. Fire-and-forget mode untuk maksimal kecepatan
4. Retry jika transfer gagal

## Dependencies
- **TRON**: `tronweb`
- **EVM Chains**: `ethers` (v6.x)
- **Solana**: `@solana/web3.js`, `@solana/spl-token`
- **Common**: `dotenv`
