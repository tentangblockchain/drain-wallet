# Anti-Drainer TRON Wallet Protection System

## Overview
Sistem perlindungan wallet TRON yang dirancang untuk mendeteksi dan melawan serangan drainer. Sistem ini memonitor wallet TRON secara real-time dan secara otomatis mentransfer aset (TRX dan USDT) ketika aktivitas mencurigakan terdeteksi.

## Project Architecture
- **Language**: Node.js (v20)
- **Main File**: `index.js`
- **Blockchain**: TRON Network
- **Dependencies**:
  - `tronweb` (v5.x) - Library untuk interaksi dengan TRON blockchain
  - `dotenv` - Management environment variables

## Key Features
1. **Multi-RPC Monitoring** - Menggunakan multiple RPC endpoints untuk reliability
2. **Real-time Transaction Monitoring** - Monitor transaksi masuk dengan whitelist protection
3. **Trigger Detection** - Deteksi transfer TRX kecil yang mencurigakan (indikasi drainer)
4. **Emergency Mode** - Mode darurat dengan parallel multi-RPC transfers
5. **Asset Protection** - Proteksi otomatis untuk TRX dan USDT (TRC20)
6. **Balance Tracking** - Monitoring perubahan saldo secara real-time

## Cara Kerja
1. **Normal Mode**: 
   - Monitor saldo TRX dan USDT secara berkala
   - Jika ada USDT, transfer ke wallet tujuan
   - Jika USDT habis dan ada TRX, transfer TRX ke wallet tujuan
   
2. **Emergency Mode** (Triggered when):
   - Terdeteksi transfer TRX kecil masuk (< threshold, default 0.1 TRX)
   - Transaksi dari alamat drainer yang sudah dikenal
   - Transfer dari alamat yang tidak di-whitelist
   
3. **Emergency Action**:
   - Langsung transfer USDT + TRX secara **bersamaan** ke semua RPC
   - Menggunakan fee limit yang lebih tinggi untuk memastikan transaksi sukses
   - Parallel execution untuk beat drainer dalam kecepatan

## Required Environment Variables
File `.env` harus berisi:

### WAJIB:
- `PRIVATE_KEY` - Private key wallet TRON yang ingin dilindungi
- `DESTINATION_WALLET` - Alamat wallet tujuan untuk transfer aset

### OPSIONAL (Ada default values):
- `RPC_ENDPOINTS` - TRON RPC endpoints (comma separated)
- `USDT_CONTRACT_ADDRESS` - USDT contract address (default: TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t)
- `OFFICIAL_SENDER` - Alamat pengirim resmi yang di-whitelist
- `DRAINER_ADDRESS_1`, `DRAINER_ADDRESS_2` - Alamat drainer yang dikenal
- `TRIGGER_THRESHOLD_TRX` - Threshold TRX untuk deteksi trigger (default: 0.1)
- `EXACT_TRIGGER_AMOUNT_TRX` - Exact amount trigger (default: 0.05)
- `NORMAL_FEE_LIMIT` - Fee limit untuk transfer normal dalam SUN (default: 10000000)
- `EMERGENCY_FEE_LIMIT` - Fee limit untuk emergency transfer dalam SUN (default: 50000000)
- `MONITORING_INTERVAL_MS` - Interval monitoring dalam milliseconds (default: 1000)

## Setup Instructions
1. Copy `.env.example` ke `.env`
2. Isi `PRIVATE_KEY` dan `DESTINATION_WALLET` di file `.env`
3. (Opsional) Sesuaikan parameter lain sesuai kebutuhan
4. Run dengan: `node index.js`

## Security Features
- **Whitelist Protection** - Alamat official sender tidak akan trigger emergency mode
- **Known Drainer Detection** - Deteksi alamat drainer yang sudah dikenal
- **Multi-RPC Failover** - Jika satu RPC gagal, sistem akan gunakan RPC lain
- **Parallel Emergency Transfers** - Transfer ke semua RPC sekaligus untuk maksimal speed

## Recent Changes
- **2025-11-15**: Major refactoring from Ethereum to TRON
  - Replaced ethers.js with TronWeb
  - Changed from ETH/ERC20 to TRX/TRC20 (USDT)
  - Improved balance checking for TRON blockchain
  - Enhanced trigger detection for TRON transactions
  - Maintained all anti-drainer protection features
  - Added support for TRON-specific fee management (SUN units)
  
## User Preferences
- Use `.env` file for configuration (not Replit Secrets)
- Indonesian language for console output
- Focus on USDT and TRX asset protection
