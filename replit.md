# Anti-Trigger Drainer Protection System

## Overview
This is a Node.js cryptocurrency protection system designed to monitor and protect wallets from drainer attacks. It monitors Ethereum wallets on the Arbitrum network and automatically transfers assets when suspicious activity is detected.

## Project Architecture
- **Language**: Node.js (v20)
- **Main File**: `index.js`
- **Network**: Arbitrum (Chain ID: 42161)
- **Dependencies**:
  - `ethers` (v6.x) - Ethereum library for blockchain interactions
  - `dotenv` - Environment variable management

## Key Features
1. Multi-RPC endpoint monitoring for reliability
2. Real-time transaction monitoring with whitelist protection
3. Trigger detection for suspicious small ETH transfers
4. Emergency mode with parallel multi-RPC transfers
5. Automatic TRN and ETH asset protection

## Required Secrets
This application requires the following environment variables (configured via Replit Secrets):

- `PRIVATE_KEY` - Private key of the wallet to protect (REQUIRED)
- `DESTINATION_WALLET` - Address where assets should be transferred (REQUIRED)
- `RPC_ENDPOINTS` - Comma-separated list of RPC endpoints (optional, has defaults)
- `TRN_CONTRACT_ADDRESS` - TRN token contract address (optional, has default)
- `CHAIN_ID` - Blockchain chain ID (optional, default: 42161 for Arbitrum)
- `OFFICIAL_TRN_SENDER` - Whitelisted official TRN sender address (optional)
- `DRAINER_ADDRESS_1` - Known drainer address 1 (optional)
- `DRAINER_ADDRESS_2` - Known drainer address 2 (optional)
- `TRIGGER_THRESHOLD_ETH` - ETH threshold for trigger detection (optional, default: 0.000015)
- `EXACT_TRIGGER_AMOUNT_ETH` - Exact ETH trigger amount (optional, default: 0.00001)
- `EMERGENCY_GAS_MULTIPLIER` - Gas multiplier for emergency transfers (optional, default: 1500)
- `NORMAL_GAS_MULTIPLIER` - Gas multiplier for normal transfers (optional, default: 300)
- `MONITORING_INTERVAL_MS` - Monitoring interval in milliseconds (optional, default: 800)

## Recent Changes
- **2025-11-15**: Initial setup in Replit environment
  - Configured Node.js 20 environment
  - Set up package.json with required dependencies
  - Created .gitignore for Node.js project
  - Configured workflow for continuous monitoring
