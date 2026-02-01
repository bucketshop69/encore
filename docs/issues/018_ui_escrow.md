# Issue #018: UI Escrow Flow Integration

## Status: ✅ COMPLETE

## Overview

Update the web UI to support the SOL escrow system implemented in v0.6.0. Buyers deposit SOL when claiming, sellers receive SOL when releasing, and both parties can cancel with proper refunds.

## Related

- Depends on: #011 (SOL Escrow) ✅ COMPLETE

---

## Changes Required

### 1. Marketplace Page (`/pages/Marketplace.tsx`)

- [ ] Update claim button to show deposit amount: "Claim & Deposit X SOL"
- [ ] Add confirmation modal before claiming (warns about SOL leaving wallet)
- [ ] Refresh wallet balance after claim transaction

### 2. My Tickets Page (`/pages/MyTickets.tsx`)

**Pending Sales Section (Seller View):**

- [ ] Show payment amount seller will receive on "Release Ticket" button
- [ ] **Add "Cancel & Refund Buyer" button** → calls `sellerCancelClaim()`
- [ ] Show buyer's deposited amount in listing info

**Pending Purchases Section (Buyer View):**

- [ ] Display amount currently in escrow
- [ ] Update "Cancel Claim" button to show refund amount

### 3. Transaction Feedback

- [ ] Toast notifications for escrow actions:
  - "Deposited X SOL to escrow"
  - "Received X SOL from escrow"  
  - "Refunded X SOL to your wallet"

### 4. Wallet Balance

- [ ] Auto-refresh balance after any escrow transaction
- [ ] (Optional) Show "In Escrow: X SOL" summary if user has active claims

---

## Priority Order

1. **High**: Claim button with deposit amount
2. **High**: Release button with payment amount
3. **High**: Seller cancel button (NEW)
4. **Medium**: Confirmation modals
5. **Medium**: Balance refresh
6. **Medium**: Toast notifications

## Technical Notes

- `encore.ts` already has `getEscrowPda()` and `sellerCancelClaim()` methods
- Listing price is available from `listing.price` (in lamports)
- Convert to SOL for display: `price / LAMPORTS_PER_SOL`

---

## Files to Modify

- `app/src/pages/Marketplace.tsx`
- `app/src/pages/MyTickets.tsx`
- `app/src/components/` (possibly new ConfirmationModal)

## Acceptance Criteria

- [ ] Claim shows "Claim & Deposit X SOL" with price
- [ ] Release shows "Release & Receive X SOL" with price
- [ ] Seller can cancel claimed listing (refunds buyer)
- [ ] Buyer sees escrow amount in pending purchases
- [ ] Toast notifications confirm escrow actions
