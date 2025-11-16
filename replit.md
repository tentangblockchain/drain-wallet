# Multi-Chain Anti-Drainer Wallet Protection System

## Overview
Sistem perlindungan wallet multi-chain yang dirancang untuk mendeteksi dan melawan serangan drainer. Sistem ini memonitor multiple blockchain networks secara real-time dan secara otomatis mentransfer aset (native coins + USDT) ketika aktivitas mencurigakan terdeteksi.

## Supported Blockchains
1. **TRON** - TRX + USDT (TRC20)
2. **Ethereum Mainnet** - ETH + USDT (ERC20)
3. **Base Network** - ETH + USDT (ERC20)
4. **Arbitrum** - ETH + USDT (ERC20)
5. **Sepolia Testnet** - ETH + USDT (ERC20)
6. **Solana** - SOL + USDT (SPL Token)

## Project Architecture

### Language & Runtime
- **Language**: Node.js (v20+)
- **Main Entry**: `index.js`

### Dependencies
- `tronweb` (v5.x) - TRON blockchain interaction
- `ethers` (v6.x) - EVM chains interaction (Ethereum, Base, Arbitrum, Sepolia)
- `@solana/web3.js` - Solana blockchain interaction
- `@solana/spl-token` - Solana SPL token interaction
- `dotenv` - Environment variables management

### Code Structure
```
/
├── index.js                      # Main entry point
├── MultiChainOrchestrator.js     # Multi-chain orchestrator
├── monitors/
│   ├── AbstractChainMonitor.js   # Base class untuk semua monitors
│   ├── TronChainMonitor.js       # TRON implementation
│   ├── EVMChainMonitor.js        # EVM chains implementation
│   └── SolanaChainMonitor.js     # Solana implementation
├── .env                          # Your configuration (not in Git)
├── .env.example                  # Configuration template
└── index-tron-only.js.backup     # Original TRON-only version
```

## Key Features

### 1. Multi-Chain Parallel Monitoring
- Monitor multiple chains simultaneously
- Independent monitoring loops per chain
- Kegagalan satu chain tidak mempengaruhi chain lain

### 2. Real-Time Balance Detection
- Deteksi perubahan balance setiap detik
- Track native coin (TRX/ETH/SOL) dan USDT
- Trigger otomatis saat ada incoming transfer

### 3. Fire-and-Forget Emergency Transfer
- Parallel broadcast ke semua RPC endpoints
- Tidak menunggu konfirmasi untuk maksimal kecepatan
- Auto-retry dengan exponential backoff

### 4. Multi-RPC Failover
- Setiap chain bisa punya multiple RPC endpoints
- Automatic failover jika satu RPC gagal
- Increased reliability dan uptime

### 5. Asset Protection
- Native coin protection (TRX, ETH, SOL)
- USDT protection (TRC20, ERC20, SPL Token)
- Transfer SEMUA assets saat deteksi incoming transfer

### 6. Smart Retry Mechanism
- Exponential backoff: 5s, 10s, 20s, 40s, 60s
- Multisig detection after 3 failures
- Clear error reporting dengan transaction links

## How It Works

### Normal Mode
1. Monitor balance setiap detik untuk semua enabled chains
2. Track previous balance state
3. Jika ada balance increase → trigger emergency transfer

### Emergency Mode (Triggered When)
- Deteksi native coin increase (TRX/ETH/SOL masuk)
- Deteksi USDT increase
- Assets masih ada setelah previous transfer attempt

### Emergency Action
1. Immediately transfer USDT + Native coin **secara bersamaan**
2. Broadcast ke **semua RPC endpoints** dalam parallel
3. Fire-and-forget mode untuk beat drainer
4. Verify transfer success setelah 5 detik
5. Auto-retry jika gagal

## Configuration

### Required Environment Variables

#### Global Settings
```bash
DESTINATION_WALLET=0xYour...          # For EVM chains
DESTINATION_WALLET_SOLANA=Your...     # For Solana
MONITORING_INTERVAL_MS=1000           # Default: 1 second
```

#### Per-Chain Settings
Each chain needs:
- `{CHAIN}_ENABLED=true` - Enable the chain
- `{CHAIN}_PRIVATE_KEY=...` - Private key for that chain
- `{CHAIN}_RPC_ENDPOINTS=...` - Comma-separated RPC URLs

Example for TRON:
```bash
TRON_ENABLED=true
TRON_PRIVATE_KEY=your_private_key
TRON_RPC_ENDPOINTS=https://api.trongrid.io,https://api.tronstack.io
```

### Default USDT Contract Addresses
- **TRON**: `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`
- **Ethereum**: `0xdAC17F958D2ee523a2206206994597C13D831ec7`
- **Base**: `0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2`
- **Arbitrum**: `0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9`
- **Sepolia**: `0x7169D38820dfd117C3FA1f22a697dBA58d90BA06`
- **Solana**: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`

## Setup Instructions

1. **Copy environment template**
   ```bash
   cp .env.example .env
   ```

2. **Configure chains**
   - Set `{CHAIN}_ENABLED=true` untuk chains yang ingin dimonitor
   - Isi private keys untuk setiap enabled chain
   - Tambahkan RPC endpoints (recommended: multiple per chain)
   - Set destination wallets

3. **Install dependencies**
   ```bash
   npm install
   ```

4. **Run the monitor**
   ```bash
   npm start
   ```

## Security Features

### Multi-RPC Protection
- Multiple RPC endpoints per chain untuk redundancy
- Automatic failover jika RPC gagal
- Parallel broadcasting untuk maksimal speed

### Multisig Detection
- Detects multisig wallets after 3 failed attempts
- Stops automatic transfers untuk multisig wallets
- Clear instructions untuk manual transfer

### Independent Chain Monitoring
- Each chain runs independently
- Failure di satu chain tidak affect chain lain
- Separate private keys per chain (optional)

## Transaction Explorers

- **TRON**: https://tronscan.org/#/transaction/{txHash}
- **Ethereum**: https://etherscan.io/tx/{txHash}
- **Base**: https://basescan.org/tx/{txHash}
- **Arbitrum**: https://arbiscan.io/tx/{txHash}
- **Sepolia**: https://sepolia.etherscan.io/tx/{txHash}
- **Solana**: https://solscan.io/tx/{txHash}

## Recent Changes

### 2025-11-16: Multi-Chain Support
- **MAJOR UPDATE**: Added support untuk 5 additional chains
- Ethereum Mainnet, Base, Arbitrum, Sepolia, Solana
- Modular architecture dengan AbstractChainMonitor base class
- MultiChainOrchestrator untuk parallel monitoring
- Backward compatible - TRON monitoring tetap berjalan seperti sebelumnya
- Refactored TRON code ke TronChainMonitor class
- Added EVMChainMonitor untuk semua EVM chains
- Added SolanaChainMonitor untuk Solana network
- Updated configuration system untuk multi-chain
- Maintained all anti-drainer protection features
- Fire-and-forget emergency transfers untuk semua chains

### 2025-11-15: TRON-Only Version
- Initial version focusing on TRON network
- TRX + USDT (TRC20) protection
- Multi-RPC failover
- Fire-and-forget emergency transfers

## User Preferences
- Use `.env` file for configuration (not Replit Secrets)
- Indonesian language untuk console output
- Focus on asset protection dengan maximum speed
- Multi-chain parallel monitoring
- Modular dan extensible architecture

## Troubleshooting

### Chain Not Starting
- Check `{CHAIN}_ENABLED=true` di `.env`
- Verify private key format
- Ensure RPC endpoints are accessible
- Check destination wallet address format

### Transfer Failures
- Check wallet balance untuk gas fees
- Verify RPC endpoints are working
- Check for multisig wallet configuration
- Review transaction hashes di block explorer

### Multiple Chains
- Each chain can be enabled/disabled independently
- Use different private keys per chain if needed
- Configure multiple RPCs per chain untuk reliability

## Support
Untuk issues atau questions, check:
1. `.env.example` untuk configuration reference
2. `ARCHITECTURE.md` untuk technical details
3. Console logs untuk specific error messages
