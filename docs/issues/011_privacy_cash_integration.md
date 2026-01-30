# Issue #011: Privacy Cash Integration

## Overview

Integrate Privacy Cash SDK for private payments in the ticket marketplace. This adds payment privacy on top of ticket ownership privacy (Issue #009) and marketplace listings (Issue #010).

## Dependencies

- Issue #009: Commitment + Nullifier Privacy Model ✅ COMPLETE
- Issue #010: Private Ticket Marketplace (must complete first)

## Privacy Stack

| Layer | Component | What's Hidden |
|-------|-----------|---------------|
| Ticket Ownership | Commitment model (Light Protocol) | Who owns which ticket |
| Ticket Transfer | Nullifier pattern | Link between transfers |
| **Payment** | **Privacy Cash** | **Who paid whom** |

## Why Privacy Cash?

Without Privacy Cash:

```
On-chain visible: Buyer (0xAAA) → 1 SOL → Seller (0xBBB)
```

With Privacy Cash:

```
On-chain visible: Privacy Cash Pool → 1 SOL → Seller (0xBBB)
Buyer identity: HIDDEN
```

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ENCORE SERVICE                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────┐      ┌──────────────────┐                    │
│  │   Encore SDK     │      │  Privacy Cash    │                    │
│  │   (marketplace)  │      │  SDK             │                    │
│  └────────┬─────────┘      └────────┬─────────┘                    │
│           │                         │                               │
│           │ createListing()         │ deposit()                     │
│           │ claimListing()          │ withdraw()                    │
│           │ completeSale()          │ getPrivateBalance()           │
│           │                         │                               │
└───────────┼─────────────────────────┼───────────────────────────────┘
            │                         │
            ▼                         ▼
┌───────────────────────┐   ┌───────────────────────┐
│   Solana (Devnet)     │   │   Privacy Cash        │
│   - Encore Program    │   │   - Relayer           │
│   - Light Protocol    │   │   - ZK Proofs         │
└───────────────────────┘   └───────────────────────┘
```

## Privacy Cash SDK

### Installation

```bash
npm install privacycash --save
```

Requires Node.js 24+.

### Key Operations

#### 1. Derive Encryption Key (One-time setup)

```typescript
import { EncryptionService } from "privacycash/utils";

// User signs message to derive encryption key
const encodedMessage = new TextEncoder().encode(`Privacy Money account sign in`);
const signature = await wallet.signMessage(encodedMessage);

// Derive encryption key
const encryptionService = new EncryptionService();
encryptionService.deriveEncryptionKeyFromSignature(signature);
```

#### 2. Deposit to Privacy Pool

```typescript
import { PrivacyCash } from 'privacycash';

const client = new PrivacyCash({
  RPC_url: process.env.SOLANA_RPC_URL,
  owner: wallet
});

// Deposit SOL to privacy pool
const result = await client.deposit({
  lamports: 1_000_000_000 // 1 SOL
});
console.log('Deposit tx:', result.tx);
```

#### 3. Private Withdrawal (Payment)

```typescript
// Withdraw to seller (PRIVATE!)
const payment = await client.withdraw({
  lamports: listing.price_lamports,
  recipientAddress: listing.seller.toBase58()
});

console.log('Payment tx:', payment.tx);
console.log('Amount received:', payment.amount_in_lamports);
console.log('Fee paid:', payment.fee_in_lamports);
```

## Service Integration

### PaymentService Class

```typescript
// services/PaymentService.ts

import { PrivacyCash } from 'privacycash';
import { EncryptionService } from 'privacycash/utils';

export class PaymentService {
  private client: PrivacyCash;
  private encryptionService: EncryptionService;
  private initialized: boolean = false;

  constructor(rpcUrl: string) {
    this.encryptionService = new EncryptionService();
  }

  /**
   * Initialize with wallet signature
   */
  async initialize(wallet: any): Promise<void> {
    // Sign message to derive encryption key
    const message = new TextEncoder().encode('Privacy Money account sign in');
    const signature = await wallet.signMessage(message);
    
    this.encryptionService.deriveEncryptionKeyFromSignature(signature);
    
    this.client = new PrivacyCash({
      RPC_url: this.rpcUrl,
      owner: wallet
    });
    
    this.initialized = true;
  }

  /**
   * Get private balance
   */
  async getPrivateBalance(): Promise<{ lamports: number }> {
    this.ensureInitialized();
    return await this.client.getPrivateBalance();
  }

  /**
   * Deposit to privacy pool
   */
  async deposit(lamports: number): Promise<{ tx: string }> {
    this.ensureInitialized();
    return await this.client.deposit({ lamports });
  }

  /**
   * Private payment to seller
   */
  async payPrivately(
    recipientAddress: string,
    lamports: number
  ): Promise<{
    tx: string;
    amount_in_lamports: number;
    fee_in_lamports: number;
  }> {
    this.ensureInitialized();
    
    // Check balance, deposit if needed
    const balance = await this.getPrivateBalance();
    if (balance.lamports < lamports) {
      const needed = lamports - balance.lamports;
      await this.deposit(needed);
    }
    
    // Withdraw to recipient (private!)
    return await this.client.withdraw({
      lamports,
      recipientAddress
    });
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PaymentService not initialized. Call initialize() first.');
    }
  }
}
```

### MarketplaceService Integration

```typescript
// services/MarketplaceService.ts

import { PaymentService } from './PaymentService';
import { EncoreClient } from './EncoreClient';

export class MarketplaceService {
  private payment: PaymentService;
  private encore: EncoreClient;

  constructor(rpcUrl: string, encoreProgram: any) {
    this.payment = new PaymentService(rpcUrl);
    this.encore = new EncoreClient(encoreProgram);
  }

  async initialize(wallet: any): Promise<void> {
    await this.payment.initialize(wallet);
  }

  /**
   * Buy a listed ticket with private payment
   */
  async buyTicket(
    listing: Listing,
    buyerCommitment: Uint8Array
  ): Promise<{ claimTx: string; paymentTx: string }> {
    
    // Step 1: Claim listing
    const claimTx = await this.encore.claimListing({
      listing: listing.address,
      buyerCommitment
    });

    // Step 2: Private payment via Privacy Cash
    const paymentResult = await this.payment.payPrivately(
      listing.seller.toBase58(),
      listing.price_lamports
    );

    return {
      claimTx,
      paymentTx: paymentResult.tx
    };
  }

  /**
   * Get payment fee estimate
   */
  getPaymentFeeEstimate(lamports: number): {
    baseFee: number;
    protocolFee: number;
    totalFee: number;
  } {
    const baseFee = 6_000_000; // 0.006 SOL
    const protocolFee = Math.floor(lamports * 0.0035); // 0.35%
    return {
      baseFee,
      protocolFee,
      totalFee: baseFee + protocolFee
    };
  }
}
```

## Payment Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 1: BUYER SETUP (One-time)                                     │
├─────────────────────────────────────────────────────────────────────┤
│  • Sign "Privacy Money account sign in" message                     │
│  • Derive encryption key from signature                             │
│  • Deposit SOL to Privacy Cash pool                                 │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 2: CLAIM LISTING                                              │
├─────────────────────────────────────────────────────────────────────┤
│  • Buyer calls claim_listing(buyer_commitment)                      │
│  • Listing locked to buyer                                          │
│  • Status: Claimed                                                  │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 3: PRIVATE PAYMENT                                            │
├─────────────────────────────────────────────────────────────────────┤
│  Buyer:                                                             │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  const payment = await privacyCash.withdraw({                │  │
│  │    lamports: listing.price_lamports,                         │  │
│  │    recipientAddress: listing.seller.toBase58()               │  │
│  │  });                                                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  On-chain observer sees: Privacy Cash Pool → Seller                 │
│  Cannot link: Buyer wallet → Payment                                │
└─────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 4: COMPLETE SALE                                              │
├─────────────────────────────────────────────────────────────────────┤
│  • Seller verifies payment received (checks wallet)                 │
│  • Seller calls complete_sale(seller_secret)                        │
│  • Nullifier created, new ticket for buyer                          │
│  • Status: Completed                                                │
└─────────────────────────────────────────────────────────────────────┘
```

## Fees

| Fee Type | Amount | Paid By |
|----------|--------|---------|
| Privacy Cash base | 0.006 SOL | Buyer |
| Privacy Cash protocol | 0.35% of amount | Buyer |
| Solana tx fee | ~0.002 SOL | Buyer |

### Fee Example

```typescript
// Buying ticket for 1 SOL
const price = 1_000_000_000; // 1 SOL

// Fees:
// Base: 0.006 SOL = 6,000,000 lamports
// Protocol: 1 SOL × 0.35% = 0.0035 SOL = 3,500,000 lamports
// Total fee: ~0.0095 SOL

// Seller receives: ~0.99 SOL
// Buyer pays: 1 SOL + 0.0095 SOL = ~1.01 SOL
```

## Implementation Steps

### Step 1: Install Dependencies

- [ ] Add `privacycash` to package.json
- [ ] Configure postinstall for Next.js (if needed)
- **Test:** Import works

### Step 2: PaymentService

- [ ] Create `services/PaymentService.ts`
- [ ] Implement initialize, deposit, withdraw
- **Test:** Deposit and withdraw on devnet

### Step 3: MarketplaceService Integration

- [ ] Create `services/MarketplaceService.ts`
- [ ] Integrate with EncoreClient
- [ ] Add buyTicket flow
- **Test:** Full buy flow with private payment

### Step 4: Balance Management

- [ ] Auto-deposit if insufficient balance
- [ ] Show private balance in UI
- [ ] Fee estimation helper
- **Test:** Low balance auto-deposit

### Step 5: Error Handling

- [ ] Handle Privacy Cash errors
- [ ] Timeout/retry logic
- [ ] User-friendly error messages
- **Test:** Error scenarios

## Error Handling

```typescript
try {
  const result = await paymentService.payPrivately(seller, amount);
} catch (error) {
  if (error.message.includes('Insufficient balance')) {
    // Auto-deposit or prompt user
  } else if (error.message.includes("Don't deposit more than")) {
    // Split into smaller deposits
  } else if (error.message.includes('no balance')) {
    // Need to deposit first
  } else {
    // Generic error handling
  }
}
```

## Privacy Best Practices

From Privacy Cash documentation:

| Practice | Recommendation |
|----------|----------------|
| Deposit amounts | Use round amounts (1 SOL, 0.5 SOL) |
| Timing | Wait between deposit and withdrawal |
| Withdrawal | Don't withdraw exact deposit amount |
| Multiple purchases | Split into separate withdrawals |

## Success Criteria

- [ ] PaymentService initializes correctly
- [ ] Deposit to Privacy Cash works
- [ ] Private withdrawal to seller works
- [ ] Full marketplace flow with private payment
- [ ] Fee estimation accurate
- [ ] Error handling robust

## Testing Checklist

- [ ] Initialize with wallet signature
- [ ] Deposit SOL to privacy pool
- [ ] Check private balance
- [ ] Withdraw to seller address
- [ ] Verify seller received payment
- [ ] Test insufficient balance handling
- [ ] Test error scenarios

## Future Enhancements

- [ ] SPL token support (USDC, etc.)
- [ ] Batch payments
- [ ] Payment notifications
- [ ] Transaction history (local)

## References

- [Privacy Cash Documentation](https://docs.privacycash.io)
- [Privacy Cash SDK](https://www.npmjs.com/package/privacycash)
- Issue #009: Commitment + Nullifier Privacy Model
- Issue #010: Private Ticket Marketplace
