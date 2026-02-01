# Issue #010: Private Ticket Marketplace - Listing System

## Overview

Implement a marketplace for private ticket trading. Sellers can list tickets for sale, buyers can claim and purchase listings. Payment confirmation triggers ticket transfer via the commitment + nullifier model from Issue #009.

## Dependencies

- Issue #009: Commitment + Nullifier Privacy Model ✅ COMPLETE

## Design Goals

| Goal | Implementation |
|------|----------------|
| Seller can list ticket | `create_listing` instruction |
| Buyer can claim listing | `claim_listing` instruction (locks listing) |
| Atomic ticket transfer | `complete_sale` (nullifier + new ticket) |
| Seller can cancel | `cancel_listing` (before claimed) |
| Timeout protection | `release_claim` (if buyer doesn't pay) |

## Privacy Analysis

| Data | Visibility |
|------|------------|
| Listing exists | Public |
| Price | Public |
| Seller address | Public (receives payment) |
| Ticket commitment | Public (proves which ticket) |
| Buyer address | Public (claims listing) |
| Buyer's new commitment | Stored, but hides identity |
| Payment | Public (SOL transfer) → Private with Privacy Cash (Issue #011) |

**Note:** Buyer identity still hidden via commitment model. Payment privacy added in Issue #011.

## State: Listing

```rust
#[account]
pub struct Listing {
    pub seller: Pubkey,                  // Receives payment
    pub ticket_commitment: [u8; 32],     // The ticket being sold
    pub encrypted_secret: [u8; 32],      // secret XOR hash(listing_pda)
    pub price_lamports: u64,             // Sale price
    pub event_config: Pubkey,            // Which event
    pub ticket_id: u32,                  // Which ticket
    
    // Claim data
    pub buyer: Option<Pubkey>,           // Who claimed
    pub buyer_commitment: Option<[u8; 32]>, // Buyer's new commitment
    pub claimed_at: Option<i64>,         // Timestamp for timeout
    
    pub status: ListingStatus,
    pub created_at: i64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum ListingStatus {
    Active,      // For sale
    Claimed,     // Buyer locked, awaiting payment
    Completed,   // Sold
    Cancelled,   // Seller cancelled
}
```

## Instructions

### 1. `create_listing`

**Signer:** Seller  
**Action:** List a ticket for sale

```rust
pub fn create_listing(
    ctx: Context<CreateListing>,
    ticket_commitment: [u8; 32],  // The ticket's current commitment
    encrypted_secret: [u8; 32],   // secret XOR hash(listing_pda)
    price_lamports: u64,
    event_config: Pubkey,
    ticket_id: u32,
) -> Result<()>
```

**Validation:**

- Price > 0
- Seller owns the ticket (client verifies before listing)

**PDA:** `["listing", seller, ticket_commitment]`

---

### 2. `claim_listing`

**Signer:** Buyer  
**Action:** Lock listing for purchase

```rust
pub fn claim_listing(
    ctx: Context<ClaimListing>,
    buyer_commitment: [u8; 32],  // Buyer's new commitment
) -> Result<()>
```

**Validation:**

- Listing status == Active
- Set buyer, buyer_commitment, claimed_at
- Status → Claimed

---

### 3. `complete_sale`

**Signer:** Seller  
**Action:** Confirm payment received, transfer ticket

```rust
pub fn complete_sale(
    ctx: Context<CompleteSale>,
    proof: ValidityProof,
    ticket_account_meta: CompressedAccountMeta,
    seller_secret: [u8; 32],  // To create nullifier + prove ownership
) -> Result<()>
```

**Actions:**

1. Verify listing is Claimed
2. Decrypt secret from listing (or use provided)
3. Verify seller owns ticket: `hash(seller || secret) == ticket_commitment`
4. CREATE nullifier (marks ticket spent)
5. CREATE new ticket with `buyer_commitment`
6. Status → Completed

**Note:** Uses same CPI pattern as `transfer_ticket` from Issue #009.

---

### 4. `cancel_listing`

**Signer:** Seller  
**Action:** Cancel unsold listing

```rust
pub fn cancel_listing(
    ctx: Context<CancelListing>,
) -> Result<()>
```

**Validation:**

- Status == Active (not claimed)
- Status → Cancelled

---

### 5. `release_claim`

**Signer:** Seller  
**Action:** Release claim if buyer didn't pay (timeout)

```rust
pub fn release_claim(
    ctx: Context<ReleaseClaim>,
) -> Result<()>
```

**Validation:**

- Status == Claimed
- Current time > claimed_at + CLAIM_TIMEOUT (24 hours)
- Status → Active (can be claimed again)

## Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  SELLER                                                             │
├─────────────────────────────────────────────────────────────────────┤
│  1. create_listing(ticket_commitment, price, encrypted_secret)      │
│     └─> Status: Active                                              │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BUYER                                                              │
├─────────────────────────────────────────────────────────────────────┤
│  2. claim_listing(buyer_commitment)                                 │
│     └─> Status: Claimed, buyer locked                               │
│                                                                     │
│  3. Send payment to seller (SOL transfer or Privacy Cash)           │
│     └─> Off-chain or separate transaction                           │
└──────────────────────────────────┬──────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SELLER                                                             │
├─────────────────────────────────────────────────────────────────────┤
│  4. complete_sale(seller_secret)                                    │
│     └─> Nullifier created                                           │
│     └─> New ticket created with buyer_commitment                    │
│     └─> Status: Completed                                           │
└─────────────────────────────────────────────────────────────────────┘
```

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `state/listing.rs` | CREATE | Listing struct |
| `state/mod.rs` | MODIFY | Export Listing |
| `instructions/listing_create.rs` | CREATE | create_listing |
| `instructions/listing_claim.rs` | CREATE | claim_listing |
| `instructions/listing_complete.rs` | CREATE | complete_sale |
| `instructions/listing_cancel.rs` | CREATE | cancel + release |
| `instructions/mod.rs` | MODIFY | Export instructions |
| `lib.rs` | MODIFY | Add instruction handlers |
| `errors.rs` | MODIFY | Add listing errors |
| `constants.rs` | MODIFY | Add LISTING_SEED, CLAIM_TIMEOUT |

## Implementation Steps

### Step 1: State + Constants

- [ ] Create `state/listing.rs` with Listing struct
- [ ] Add LISTING_SEED, CLAIM_TIMEOUT constants
- [ ] Add listing-related errors
- **Test:** Compile only

### Step 2: create_listing

- [ ] Implement instruction
- [ ] Add to lib.rs
- **Test:** Create listing on devnet

### Step 3: claim_listing

- [ ] Implement instruction
- [ ] Validate status transitions
- **Test:** Claim listing on devnet

### Step 4: complete_sale

- [ ] Implement with Light Protocol CPI
- [ ] Create nullifier + new ticket
- [ ] Reuse transfer pattern from #009
- **Test:** Full flow (list → claim → complete)

### Step 5: cancel + release

- [ ] Implement cancel_listing
- [ ] Implement release_claim with timeout
- **Test:** Cancel before claim, release after timeout

### Step 6: Integration Tests

- [ ] Full marketplace flow test
- [ ] Edge cases (cancel, timeout, double-claim)

## Error Codes

```rust
#[error_code]
pub enum ListingError {
    #[msg("Listing not active")]
    ListingNotActive,
    
    #[msg("Listing already claimed")]
    ListingAlreadyClaimed,
    
    #[msg("Listing not claimed")]
    ListingNotClaimed,
    
    #[msg("Not the listing seller")]
    NotSeller,
    
    #[msg("Not the listing buyer")]
    NotBuyer,
    
    #[msg("Claim timeout not reached")]
    ClaimTimeoutNotReached,
    
    #[msg("Invalid price")]
    InvalidPrice,
}
```

## Constants

```rust
pub const LISTING_SEED: &[u8] = b"listing";
pub const CLAIM_TIMEOUT_SECONDS: i64 = 86400; // 24 hours
```

## Success Criteria

- [ ] create_listing works on devnet
- [ ] claim_listing locks listing
- [ ] complete_sale transfers ticket via nullifier pattern
- [ ] cancel_listing works before claim
- [ ] release_claim works after timeout
- [ ] Integration test passes full flow

## Future Enhancements (Post-Hackathon)

- [ ] Privacy Cash payment integration (Issue #011)
- [ ] Resale price cap enforcement
- [ ] Listing search/indexing
- [ ] Batch listing operations

## References

- Issue #009: Commitment + Nullifier Privacy Model
- Issue #011: Privacy Cash Integration (payment privacy)
