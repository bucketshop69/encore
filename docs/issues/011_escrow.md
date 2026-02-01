# Issue #011: SOL Escrow for Marketplace

## Overview

Add a simple SOL escrow to the marketplace flow. Buyer deposits payment on claim, seller withdraws after releasing ticket.

## Current Flow (No Payment)

```
1. Alice lists ticket for 1 SOL        → Listing created (Active)
2. Bob claims listing                  → Listing locked (Claimed)
3. Alice releases ticket               → Bob gets ticket (Completed)
4. ❌ No actual payment happens!
```

## New Flow (With Escrow)

```
1. Alice lists ticket for 1 SOL        → Listing created (Active)
2. Bob claims + deposits 1 SOL         → SOL held in escrow PDA (Claimed)
3. Alice releases ticket               → Bob gets ticket, Alice gets SOL (Completed)
```

## Escrow PDA Design

### Address Derivation

```
seeds = ["escrow", listing.key()]
```

One escrow per listing. Simple and deterministic.

### Account Structure

The escrow is just a **system account** (no data), owned by the program. SOL balance = escrowed amount.

No custom struct needed - we use the PDA's lamport balance directly.

## Instruction Changes

### 1. `claim_listing` - Add Deposit

**Current:** Bob signs, listing status → Claimed

**New:** Bob signs + transfers `listing.price_lamports` to escrow PDA

**Changes needed:**

- Add `escrow` account to ClaimListing accounts struct
- Add `system_program` for SOL transfer
- Add SOL transfer instruction after status update
- Validate: `amount_deposited >= listing.price_lamports`

**Accounts to add:**

| Account | Type | Description |
|---------|------|-------------|
| `escrow` | `SystemAccount` (init) | PDA to hold SOL |
| `system_program` | `Program` | For transfer |

### 2. `complete_sale` - Add Withdrawal

**Current:** Alice signs, creates nullifier + new ticket

**New:** Same + transfer escrow SOL to Alice

**Changes needed:**

- Add `escrow` account to CompleteSale accounts struct
- Add SOL transfer from escrow → seller after ticket transfer
- Close escrow account (return rent to seller)

**Accounts to add:**

| Account | Type | Description |
|---------|------|-------------|
| `escrow` | `SystemAccount` (mut) | PDA holding SOL |

### 3. `cancel_claim` - Buyer Cancels (Refund to Buyer)

**Current:** Bob signs, listing status → Active

**New:** Same + refund escrow SOL to Bob

**Changes needed:**

- Add `escrow` account to CancelClaim accounts struct
- Add `buyer` account to receive refund (use `listing.buyer`)
- Add SOL transfer from escrow → buyer
- Close escrow account (return rent to buyer)

**Accounts to add:**

| Account | Type | Description |
|---------|------|-------------|
| `escrow` | `SystemAccount` (mut) | PDA holding SOL |

### 4. `seller_cancel_claim` - Seller Cancels (Refund to Buyer)

**New instruction** - allows seller to release a claimed listing.

**Use cases:**

- Seller lost their secret (can't complete sale)
- Seller changed their mind
- Seller wants to relist at different price

**Behavior:**

- Seller signs
- Refund escrow SOL → buyer (NOT seller!)
- Reset listing to Active (or Cancelled if seller wants to delist)

**Accounts needed:**

| Account | Type | Description |
|---------|------|-------------|
| `seller` | `Signer` | Must match listing.seller |
| `listing` | `Account<Listing>` (mut) | The listing |
| `escrow` | `SystemAccount` (mut) | PDA holding SOL |
| `buyer` | `SystemAccount` (mut) | Receives refund (from listing.buyer) |

**Key rule:** SOL always goes back to whoever deposited it (the buyer).

### 5. `cancel_listing` - Handle Claimed State

**Current:** Only allows cancel when Active

**New options:**

Option A (Simple): Keep current behavior - seller must use `seller_cancel_claim` first

Option B (Combined): Allow cancel when Claimed, auto-refund buyer

**Recommendation:** Option A - separate instructions are clearer

## SOL Transfer Pattern

### Deposit (Buyer → Escrow)

Use `system_instruction::transfer`:

```
Transfer {
    from: buyer (signer)
    to: escrow (PDA)
    lamports: listing.price_lamports
}
```

### Withdrawal (Escrow → Seller)

Use PDA signer seeds:

```
Transfer with PDA signature {
    from: escrow (PDA)
    to: seller
    lamports: escrow.lamports - rent_exempt_minimum
}
```

Then close escrow by transferring remaining rent.

## Implementation Steps

### Step 1: Update Constants

Add escrow seed:

```
pub const ESCROW_SEED: &[u8] = b"escrow";
```

### Step 2: Update `claim_listing`

1. Add escrow PDA account (init_if_needed)
2. Add system_program
3. After setting status to Claimed, transfer SOL:
   - `buyer` → `escrow`
   - Amount: `listing.price_lamports`

### Step 3: Update `complete_sale`

1. Add escrow PDA account (mut)
2. After creating buyer's ticket, transfer SOL:
   - `escrow` → `seller`
   - Amount: full escrow balance
   - Close escrow account

### Step 4: Update `cancel_claim`

1. Add escrow PDA account (mut)
2. Before resetting status, transfer SOL:
   - `escrow` → `buyer`
   - Amount: full escrow balance
   - Close escrow account

### Step 5: Create `seller_cancel_claim`

New instruction file: `listing_seller_cancel_claim.rs`

1. Verify signer is `listing.seller`
2. Verify listing status is `Claimed`
3. Get buyer address from `listing.buyer`
4. Transfer SOL: `escrow` → `buyer` (refund)
5. Close escrow account
6. Reset listing to Active (or set to Cancelled if desired)

### Step 6: Update Client (TypeScript)

- `claimListing()` - derive escrow PDA, include in accounts
- `completeSale()` - derive escrow PDA, include in accounts  
- `cancelClaim()` - derive escrow PDA, include in accounts
- `sellerCancelClaim()` - new method, derive escrow PDA, include buyer for refund

### Step 7: Update UI

- Show "Deposit X SOL" when claiming
- Show "Withdraw X SOL" when releasing (for seller)
- Show refund amount when buyer cancels claim
- Add "Cancel Claim" button for seller on claimed listings (refunds buyer)

## Test Scenarios

| Scenario | Expected Outcome |
|----------|-----------------|
| Bob claims with sufficient SOL | Escrow receives SOL, listing Claimed |
| Bob claims with insufficient SOL | Transaction fails |
| Alice releases (complete_sale) | Alice receives SOL, Bob gets ticket |
| Bob cancels claim | Bob gets refund, listing Active |
| Alice cancels claim (seller_cancel) | Bob gets refund, listing Active |
| Multiple claims on same listing | Only first succeeds (status check) |

## Cancellation Matrix

| Who Cancels | Listing State | SOL Goes To | Listing Becomes |
|-------------|---------------|-------------|-----------------|
| Buyer | Claimed | Buyer (refund) | Active |
| Seller | Claimed | Buyer (refund) | Active or Cancelled |
| Seller | Active | N/A (no escrow) | Cancelled |

## Security Considerations

1. **Escrow PDA must be program-owned** - prevents unauthorized withdrawal
2. **Amount validation** - verify deposit matches listing price
3. **Status checks** - only withdraw when Claimed, only refund when cancelling
4. **Rent handling** - ensure escrow is rent-exempt during hold period

## Migration Notes

- Existing listings have no escrow - they continue to work without payment
- New claims after deployment will require deposit
- No breaking changes to existing data structures

## Success Criteria

- [ ] Buyer deposits SOL on claim
- [ ] Seller receives SOL on complete_sale
- [ ] Buyer gets refund on cancel_claim (buyer cancels)
- [ ] Buyer gets refund on seller_cancel_claim (seller cancels)
- [ ] Escrow accounts properly closed after use
- [ ] All tests pass with payment flow

## Dependencies

- Issue #017: cancel_claim instruction ✅ COMPLETE
- No external dependencies (native SOL only)

## Future Enhancements

- SPL token support (USDC, etc.)
- Partial refunds (if implementing timeout-based cancellation)
- Fee collection for marketplace operator
