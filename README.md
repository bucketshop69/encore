# Encore 🎟️

**Private, scalable ticketing on Solana.** Encore uses Light Protocol compressed accounts to scale and commitment/nullifier model for privacy without sacrificing verifiability.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ENCORE FLOW                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   MINT                LIST                 CLAIM                RELEASE     │
│   ────                ────                 ─────                ───────     │
│                                                                             │
│   Alice generates     Alice encrypts      Bob deposits         Alice        │
│   SECRET (private)    secret & lists      SOL to ESCROW        reveals      │
│        ↓              for 0.15 SOL        & commits his        secret &     │
│   COMMITMENT = hash(pubkey + secret)      own secret           releases     │
│        ↓                   ↓                   ↓                    ↓       │
│   On-chain: commitment    Listing PDA      Escrow PDA          NULLIFIER    │
│   (ownership hidden!)     (price visible)  (trustless!)        (old ticket  │
│                                                                 can't be    │
│                                                                 reused)     │
│                                                                     ↓       │
│                                                                 New ticket  │
│                                                                 for Bob     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Compressed Accounts** | Light Protocol stores tickets in Merkle trees → 99.8% cheaper than regular accounts |
| **Commitment** | `hash(owner_pubkey + secret)` — proves ownership without revealing identity |
| **Nullifier** | Published when ticket is spent — prevents double-spending |
| **Escrow** | Buyer's SOL locked until seller releases ticket — trustless payments |

---

## Try It

### Prerequisites

- Solana CLI configured for devnet
- Anchor 0.30+
- Node.js 18+

### Run the Demo

```bash
# Clone and install
git clone https://github.com/piske-alex/encore.git
cd encore
npm install

# Build the program
anchor build

# Run the marketplace demo (on devnet)
anchor test --skip-local-validator --skip-deploy
```

### What You'll See

The test demonstrates a complete round-trip: **Alice → Bob → Alice**

```
════════════════════════════════════════════════════════════════════════════════
  ENCORE - Private Ticketing on Solana
════════════════════════════════════════════════════════════════════════════════

┌──────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Alice mints a private ticket                                        │
└──────────────────────────────────────────────────────────────────────────────┘

  📖 What's happening:
     Alice generates a SECRET (only she knows)
     COMMITMENT = hash(Alice's pubkey + secret)
     → Nobody can see Alice owns this ticket!

  Alice's Secret: 7a3f8b2c...
  Alice's Commitment: 9d4e1f6a...
  
  Transaction:
    Explorer: https://explorer.solana.com/tx/...?cluster=devnet

  ✅ RESULT:
     Ticket ID: #42
     Owner: Alice (hidden)
     Status: MINTED
```

All addresses and transaction signatures are printed with **Solana Explorer links** so you can verify everything on-chain.

---

## Architecture

```
programs/encore/
├── instructions/
│   ├── ticket_mint.rs        # Mint private ticket (compressed)
│   ├── listing_create.rs     # Create marketplace listing
│   ├── listing_claim.rs      # Buyer claims + deposits to escrow
│   ├── listing_complete.rs   # Seller releases + nullifier created
│   └── ...
├── state/
│   ├── private_ticket.rs     # Compressed ticket account
│   ├── listing.rs            # Marketplace listing PDA
│   └── event_config.rs       # Event configuration
└── lib.rs

app/                          # React frontend
tests/                        # Anchor tests with explorer links
```

---

## Tech Stack

- **Solana** — Base layer
- **Anchor** — Program framework
- **Light Protocol** — ZK Compression for scalable accounts
- **Commitment/Nullifier** — Privacy model (no ZK proofs yet, but ready)
- **SOL Escrow** — Trustless marketplace payments

---

## Status

✅ Event creation  
✅ Private ticket minting (compressed)  
✅ Marketplace listings  
✅ Claim with escrow deposit  
✅ Release with escrow withdrawal  
✅ Nullifier-based double-spend prevention  
✅ Buyer/Seller cancel flows  
✅ React UI  

---

## License

MIT
