# Issue #017: Cancel Claim Instruction

## Overview

Allow a Buyer who has claimed a listing to voluntarily release it back to the marketplace. Currently, once a ticket is claimed, it is locked in the `Claimed` state for 24 hours, or until the Seller completes the sale. If a Buyer changes their mind, realizes they cannot pay, or made a mistake, they cannot "unclaim" the ticket. This results in the ticket being stuck in limbo, bad UX for the Buyer, and lost sales opportunities for the Seller.

## Problem

1. **Inventory Lock**: A claimed listing is effectively off the market.
2. **No Buyer Exit**: If Bob claims a ticket but decides not to buy it, he cannot free the resource.
3. **Seller Frustration**: Alice has to wait 24 hours (`CLAIM_TIMEOUT_SECONDS`) to `release_claim` manually.

## Solution

Implement a `cancel_claim` (or `unclaim_listing`) instruction that allows the **current buyer** to reset the listing status from `Claimed` to `Active`.

### Privacy Model Implications

* **No Conflict**: This instruction only affects the marketplace `Listing` state. It does not interact with the underlying Ticket or Light Protocol trees directly.
* **Identity**: The Buyer signs the transaction, proving they are the `listing.buyer`.

## Technical Specification

### Instruction: `cancel_claim`

#### Accounts

* `buyer`: `Signer` (Must match `listing.buyer`)
* `listing`: `Account<Listing>` (Mut)

#### Logic

1. **Validate Status**: `listing.status` must be `Claimed`.
2. **Validate Authority**: `listing.buyer` must equal `buyer.key()`.
3. **Action**:
    * Set `listing.status` to `Active`.
    * Set `listing.buyer` to `None`.
    * Set `listing.buyer_commitment` to `None`.
    * Set `listing.claimed_at` to `None`.
4. **Emit Event**: `ClaimCancelled`.

### Rust Implementation Draft

```rust
#[derive(Accounts)]
pub struct CancelClaim<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,

    #[account(
        mut,
        seeds = [LISTING_SEED, listing.seller.as_ref(), &listing.ticket_commitment],
        bump = listing.bump,
        has_one = buyer @ EncoreError::NotBuyer
    )]
    pub listing: Account<'info, Listing>,
}

pub fn cancel_claim(ctx: Context<CancelClaim>) -> Result<()> {
    let listing = &mut ctx.accounts.listing;

    // 1. Validate status
    require!(
        listing.status == ListingStatus::Claimed,
        EncoreError::ListingNotClaimed
    );

    // 2. Reset Listing
    listing.status = ListingStatus::Active;
    listing.buyer = None;
    listing.buyer_commitment = None;
    listing.claimed_at = None;

    msg!("Claim cancelled by buyer: {:?}", ctx.accounts.buyer.key());
    Ok(())
}
```

## UX Flow Updates

### Buyer View

* **Current**: "Waiting for release..." (Passive)
* **New**: "Waiting for release" OR **[Cancel Claim]** button.

### Seller View

* **Current**: "Claimed by 0x..." (Locked for 24h)
* **New**: If Buyer cancels, view automatically updates back to "Listed" (Active).

## Checklist

- [ ] Create `cancel_claim` instruction in `programs/encore/src/instructions/listing_cancel_claim.rs`.

* [ ] Add `CancelClaim` struct and `cancel_claim` function.
* [ ] Register module in `programs/encore/src/instructions/mod.rs`.
* [ ] Expose instruction in `programs/encore/src/lib.rs`.
* [ ] Add `NotBuyer` error to `programs/encore/src/errors.rs` (if not exists).
* [ ] Update Codama SDK (auto-generated).
* [ ] Add integration test ensuring Buyer can cancel and Listing reverts to Active.
