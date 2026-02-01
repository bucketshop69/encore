use anchor_lang::prelude::*;

use crate::constants::{ESCROW_SEED, LISTING_SEED};
use crate::errors::EncoreError;
use crate::state::{Listing, ListingStatus};

#[derive(Accounts)]
pub struct SellerCancelClaim<'info> {
    /// Seller who is cancelling the claim
    #[account(mut)]
    pub seller: Signer<'info>,

    /// Listing being unclaimed
    #[account(
        mut,
        seeds = [LISTING_SEED, listing.seller.as_ref(), &listing.ticket_commitment],
        bump = listing.bump,
        constraint = listing.seller == *seller.key @ EncoreError::NotSeller,
    )]
    pub listing: Account<'info, Listing>,

    /// Escrow PDA holding buyer's payment (will be refunded to buyer)
    /// CHECK: This is a PDA that holds SOL, validated by seeds
    #[account(
        mut,
        seeds = [ESCROW_SEED, listing.key().as_ref()],
        bump,
    )]
    pub escrow: SystemAccount<'info>,

    /// Buyer who will receive the refund
    /// CHECK: Must match listing.buyer, receives refund
    #[account(
        mut,
        constraint = Some(buyer.key()) == listing.buyer @ EncoreError::NotBuyer,
    )]
    pub buyer: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Cancel a claimed listing (seller cancels).
///
/// Allows the seller to release a claimed listing, refunding the buyer's
/// escrowed SOL. Use cases:
/// - Seller lost their secret (cannot complete sale)
/// - Seller changed their mind
/// - Seller wants to relist at a different price
///
/// # Privacy Model
/// - No conflict: This only affects the Listing state
/// - Identity: The Seller signs, proving they are listing.seller
///
/// # Escrow
/// - Refunds all SOL from escrow back to BUYER (not seller!)
///
/// # Operations
/// 1. Validate listing is Claimed
/// 2. Validate seller is the listing seller
/// 3. Refund escrow SOL to buyer
/// 4. Reset listing to Active state
pub fn seller_cancel_claim(ctx: Context<SellerCancelClaim>) -> Result<()> {
    let seller = &ctx.accounts.seller;
    let listing_key = ctx.accounts.listing.key();
    let escrow_bump = ctx.bumps.escrow;
    let listing = &mut ctx.accounts.listing;

    // Validate listing status is Claimed
    require!(
        listing.status == ListingStatus::Claimed,
        EncoreError::ListingNotClaimed
    );

    // Refund escrow SOL to buyer (NOT seller!) using PDA signing
    let escrow_balance = ctx.accounts.escrow.lamports();
    if escrow_balance > 0 {
        let escrow_seeds: &[&[u8]] = &[ESCROW_SEED, listing_key.as_ref(), &[escrow_bump]];

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.buyer.to_account_info(),
                },
                &[escrow_seeds],
            ),
            escrow_balance,
        )?;
        msg!(
            "💰 Refunded {} lamports to buyer: {:?}",
            escrow_balance,
            ctx.accounts.buyer.key()
        );
    }

    // Reset listing to Active state
    listing.status = ListingStatus::Active;
    listing.buyer = None;
    listing.buyer_commitment = None;
    listing.claimed_at = None;

    msg!(
        "✅ Claim cancelled by seller: {:?}, listing back to Active",
        seller.key()
    );

    Ok(())
}
