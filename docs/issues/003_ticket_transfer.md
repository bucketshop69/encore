# Issue #003: Private Ticket Transfer

## ⚠️ SUPERSEDED BY ISSUE #009

**This issue has been replaced by [Issue #009: Commitment + Nullifier Privacy Model](./009_commitment_nullifier_model.md)**

The original design used mutation-based transfers. The current implementation uses CREATE-only operations (nullifier + new ticket) which works on devnet. See #009 for the working implementation.

---

## Overview (Archived)

Implement privacy-preserving ticket transfer allowing owners to transfer tickets to new owners without revealing identities on-chain.

## Privacy Requirements

From README:
> "Ticket ownership and resale prices are hidden from public viewers"
> "Users submit ZK Proofs to transition state"

Transfer must:

- ✅ Hide seller identity (as much as possible in Option B)
- ✅ Hide buyer identity (commitment only)
- ✅ Prevent double-spending (nullifier)
- ✅ Enforce resale cap

## Transfer Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                        PRIVATE TRANSFER                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SELLER (Alice)                    BUYER (Bob)                   │
│  ─────────────────                 ──────────────                │
│  Knows:                            Knows:                        │
│  - Her pubkey                      - His pubkey                  │
│  - Her secret                      - His NEW secret              │
│  - Current commitment              - His NEW commitment          │
│                                                                  │
│              ┌──────────────────────────────┐                    │
│              │     transfer_ticket()        │                    │
│              │                              │                    │
│  Alice ────► │  1. Verify Alice's proof     │                    │
│              │  2. Create nullifier         │ ◄──── Bob provides │
│              │  3. Update commitment        │       new_commitment│
│              │                              │                    │
│              └──────────────────────────────┘                    │
│                                                                  │
│  BEFORE:                           AFTER:                        │
│  owner_commitment: 0xAAA (Alice)   owner_commitment: 0xBBB (Bob) │
│                                    + Nullifier: 0xNNN created    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Privacy Model (Option B - Commitment Based)

| Data | Visibility |
|------|------------|
| Seller's pubkey | Revealed in transaction (to prove ownership) |
| Seller's secret | Revealed in transaction (to prove ownership) |
| Buyer's identity | ❌ HIDDEN (only commitment stored) |
| Resale price | Can be hidden or public (design choice) |
| Transfer happened | Visible (commitment changed) |

**Note:** In full ZK (Option A), seller would also be hidden via ZK proof. Option B is simpler for hackathon.

## Technical Approach

### 1. Ownership Proof

Seller proves they own the ticket by revealing:

```rust
// Seller provides:
seller_pubkey: Pubkey,
seller_secret: [u8; 32],

// Program verifies:
let expected = hash(seller_pubkey || seller_secret);
require!(expected == ticket.owner_commitment);
```

### 2. Nullifier Creation

Prevent double-spending:

```rust
nullifier = hash(ticket_id || seller_secret)
```

Create as compressed PDA - if it exists, transfer fails.

### 3. Commitment Update

Replace old commitment with buyer's:

```rust
ticket.owner_commitment = new_owner_commitment;  // Buyer's hash
```

## Instruction: `transfer_ticket`

```rust
pub fn transfer_ticket(
    ctx: Context<TransferTicket>,
    proof: ValidityProof,
    account_meta: CompressedAccountMeta,
    // Seller proves ownership:
    seller_pubkey: Pubkey,
    seller_secret: [u8; 32],
    // Buyer's new commitment:
    new_owner_commitment: [u8; 32],
    // Optional resale price:
    resale_price: Option<u64>,
) -> Result<()>
```

## Accounts Required

```rust
#[derive(Accounts)]
pub struct TransferTicket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    
    pub event_config: Account<'info, EventConfig>,
    
    // Light Protocol accounts via remaining_accounts
}
```

Note: No `seller` signer needed - ownership proved via commitment preimage!

## Validation Logic

1. **Ownership check:**

   ```rust
   let computed = hash(seller_pubkey || seller_secret);
   require!(computed == ticket.owner_commitment, NotOwner);
   ```

2. **Resale cap check (if price provided):**

   ```rust
   if let Some(price) = resale_price {
       let max_price = ticket.original_price * event.resale_cap_bps / 10000;
       require!(price <= max_price, ExceedsResaleCap);
   }
   ```

3. **Nullifier check:**
   Create compressed nullifier PDA - fails if already exists.

## Nullifier Structure

```rust
// Nullifier is just an empty account with specific address
let nullifier_seed = hash(ticket_id || seller_secret);

// Address = derive_address(["nullifier", nullifier_seed])
// If this address already exists → transfer fails
```

## Events

```rust
#[event]
pub struct TicketTransferred {
    pub event_config: Pubkey,
    pub ticket_id: u32,
    pub old_commitment: [u8; 32],  // Seller's (now invalid)
    pub new_commitment: [u8; 32],  // Buyer's (now valid)
    pub nullifier: [u8; 32],       // Created to prevent reuse
}
```

**Note:** No pubkeys in event - maintains buyer privacy!

## Files to Create/Modify

| File | Change |
|------|--------|
| `instructions/ticket_transfer.rs` | New transfer instruction |
| `instructions/mod.rs` | Export transfer |
| `lib.rs` | Add transfer_ticket entrypoint |
| `events.rs` | Add TicketTransferred event |
| `errors.rs` | Add transfer errors |
| `tests/integration.rs` | Add transfer tests |

## Testing Considerations

1. **Happy path:** Transfer with valid ownership proof
2. **Privacy check:** Verify only commitments stored, not pubkeys
3. **Double-spend prevention:** Second transfer with same secret fails
4. **Resale cap:** Transfer fails if price > cap
5. **Wrong secret:** Transfer fails if seller_secret doesn't match commitment

## Dependencies

- Issue #001 (EventConfig) ✅ Complete
- Issue #002 (Private Minting) ✅ Complete
- `nullifier_creation` crate (or custom implementation)

## References

- [Light Protocol: Update Compressed Accounts](https://www.zkcompression.com/compressed-pdas/guides/how-to-update-compressed-accounts)
- [Light Protocol: Nullifiers](https://github.com/Lightprotocol/program-examples/tree/main/zk/zk-nullifier)
