
# Multi-Chain Anti-Drainer Wallet Protection System

## ⚠️ PERINGATAN KEAMANAN KRITIS

**JANGAN PERNAH GUNAKAN WALLET/PRIVATE KEY DARI `.env.example`!**

- ⛔ Semua wallet dan private key di `.env.example` adalah **WALLET DRAIN** yang sengaja disertakan untuk tujuan edukasi
- 🚨 Wallet tersebut sudah dikompromikan dan asetnya akan langsung diambil oleh attacker
- ✅ **WAJIB** ganti semua private key dan wallet address dengan milik Anda sendiri
- 🔐 **JANGAN PERNAH** share private key Anda ke siapapun atau commit ke Git
- 💡 File `.env` sudah ada di `.gitignore` untuk mencegah private key ter-commit

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
├── .env.example                  # Configuration template (JANGAN DIGUNAKAN!)
└── replit.md                     # Documentation
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
# GANTI dengan wallet address Anda sendiri!
DESTINATION_WALLET=0xYourWalletAddress          # For EVM chains
DESTINATION_WALLET_TRON=TYourWalletAddress      # For TRON
DESTINATION_WALLET_SOLANA=YourWalletAddress     # For Solana

# Monitoring interval (milliseconds) - Default: 1 second
MONITORING_INTERVAL_MS=1000
```

#### Per-Chain Settings
Each chain needs:
- `{CHAIN}_ENABLED=true` - Enable the chain
- `{CHAIN}_PRIVATE_KEY=...` - **PRIVATE KEY ANDA SENDIRI** (bukan dari .env.example!)
- `{CHAIN}_RPC_ENDPOINTS=...` - Comma-separated RPC URLs

Example for TRON:
```bash
TRON_ENABLED=true
TRON_PRIVATE_KEY=your_actual_private_key_here  # GANTI INI!
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

2. **⚠️ CRITICAL: Ganti SEMUA private keys dan wallet addresses**
   - Buka file `.env`
   - Ganti `DESTINATION_WALLET` dengan wallet Anda
   - Ganti `DESTINATION_WALLET_TRON` dengan wallet TRON Anda
   - Ganti `DESTINATION_WALLET_SOLANA` dengan wallet Solana Anda
   - Ganti SEMUA `{CHAIN}_PRIVATE_KEY` dengan private key Anda sendiri
   - **JANGAN gunakan wallet/key dari `.env.example`** - itu wallet drain untuk edukasi!

3. **Configure chains**
   - Set `{CHAIN}_ENABLED=true` untuk chains yang ingin dimonitor
   - Tambahkan RPC endpoints (recommended: multiple per chain)

4. **Install dependencies**
   ```bash
   npm install
   ```

5. **Run the monitor**
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

### Private Key Security
- File `.env` tidak akan ter-commit ke Git (ada di `.gitignore`)
- Gunakan Replit Secrets untuk production deployment (opsional)
- **NEVER** share private keys atau commit ke public repository

## Known Issues & Solutions

### Issue: Transfer terus gagal (seperti di logs)
**Symptoms:**
- `⚠️ WARNING: X transfer failures!`
- Assets tetap ada setelah transfer
- Broadcast success tapi transaksi tidak confirmed

**Possible Causes:**
1. **Wallet Multisig** - Wallet memerlukan multiple signatures
2. **Insufficient Gas** - Tidak cukup native coin untuk gas fee
3. **Wallet Drain** - Menggunakan wallet dari `.env.example` yang sudah dikompromikan
4. **Contract Error** - USDT contract memerlukan approval terlebih dahulu

**Solutions:**
- Pastikan wallet BUKAN multisig
- Pastikan ada cukup TRX/ETH/SOL untuk gas fees
- **GANTI private key dengan milik Anda** jika masih pakai dari `.env.example`
- Check transaction hash di block explorer untuk detail error

## Transaction Explorers

- **TRON**: https://tronscan.org/#/transaction/{txHash}
- **Ethereum**: https://etherscan.io/tx/{txHash}
- **Base**: https://basescan.org/tx/{txHash}
- **Arbitrum**: https://arbiscan.io/tx/{txHash}
- **Sepolia**: https://sepolia.etherscan.io/tx/{txHash}
- **Solana**: https://solscan.io/tx/{txHash}

## Recent Changes

### 2025-01-16: Documentation Update
- **CRITICAL**: Added security warning about `.env.example` wallets
- Documented known issues with transfer failures
- Added troubleshooting section
- Emphasized the importance of using your own wallets

### 2025-01-15: Multi-Chain Support
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

## User Preferences
- Use `.env` file for configuration (not Replit Secrets by default)
- Indonesian language untuk console output
- Focus on asset protection dengan maximum speed
- Multi-chain parallel monitoring
- Modular dan extensible architecture

## Educational Purpose

File `.env.example` berisi wallet dan private key yang **SENGAJA SUDAH DIKOMPROMIKAN** untuk menunjukkan:
- Bagaimana drainer bekerja
- Pentingnya mengamankan private key
- Konsekuensi dari menggunakan wallet yang sudah ter-expose
- **JANGAN PERNAH** transfer aset ke wallet tersebut!

## Troubleshooting

### Chain Not Starting
- Check `{CHAIN}_ENABLED=true` di `.env`
- Verify private key format (harus private key Anda sendiri!)
- Ensure RPC endpoints are accessible
- Check destination wallet address format

### Transfer Failures
- ⚠️ **PERTAMA**: Pastikan TIDAK menggunakan wallet dari `.env.example`
- Check wallet balance untuk gas fees
- Verify RPC endpoints are working
- Check for multisig wallet configuration
- Review transaction hashes di block explorer
- Ensure USDT contract memiliki approval (untuk ERC20/TRC20)

### Multiple Chains
- Each chain can be enabled/disabled independently
- Use different private keys per chain if needed
- Configure multiple RPCs per chain untuk reliability

## Support & Contributing

Untuk issues atau questions:
1. Check `.env.example` untuk configuration reference (tapi JANGAN pakai wallet-nya!)
2. Review `replit.md` untuk technical details
3. Check console logs untuk specific error messages
4. Verify semua private keys sudah diganti dengan milik Anda

## Legal Disclaimer

Sistem ini dibuat untuk **tujuan edukasi dan perlindungan aset pribadi**. User bertanggung jawab penuh atas penggunaan sistem ini. Developer tidak bertanggung jawab atas kehilangan aset atau penyalahgunaan sistem.

**INGAT**: Wallet di `.env.example` adalah wallet drain untuk edukasi. Jangan transfer aset ke wallet tersebut!
