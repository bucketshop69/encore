use anchor_lang::prelude::*;

use crate::constants::{ESCROW_SEED, LISTING_SEED};
use crate::errors::EncoreError;
use crate::state::{Listing, ListingStatus};

#[derive(Accounts)]
pub struct CancelClaim<'info> {
    /// Buyer who is cancelling their claim
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Listing being unclaimed
    #[account(
        mut,
        seeds = [LISTING_SEED, listing.seller.as_ref(), &listing.ticket_commitment],
        bump = listing.bump,
    )]
    pub listing: Account<'info, Listing>,

    /// Escrow PDA holding buyer's payment (will be refunded)
    /// CHECK: This is a PDA that holds SOL, validated by seeds
    #[account(
        mut,
        seeds = [ESCROW_SEED, listing.key().as_ref()],
        bump,
    )]
    pub escrow: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Cancel a claim on a marketplace listing (buyer cancels).
///
/// Allows a buyer who has claimed a listing to voluntarily release it
/// back to the marketplace. This is useful when the buyer changes their
/// mind, cannot pay, or made a mistake.
///
/// # Privacy Model
/// - No conflict: This only affects the Listing state
/// - Identity: The Buyer signs, proving they are listing.buyer
///
/// # Escrow
/// - Refunds all SOL from escrow back to buyer
///
/// # Operations
/// 1. Validate listing is Claimed
/// 2. Validate buyer is the listing buyer
/// 3. Refund escrow SOL to buyer
/// 4. Reset listing to Active state
pub fn cancel_claim(ctx: Context<CancelClaim>) -> Result<()> {
    let buyer = &ctx.accounts.buyer;
    let listing_key = ctx.accounts.listing.key();
    let escrow_bump = ctx.bumps.escrow;
    let listing = &mut ctx.accounts.listing;

    // Validate listing status is Claimed
    require!(
        listing.status == ListingStatus::Claimed,
        EncoreError::ListingNotClaimed
    );

    // Validate the signer is the buyer who claimed
    require!(listing.buyer == Some(*buyer.key), EncoreError::NotBuyer);

    // Refund escrow SOL to buyer using PDA signing
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
        msg!("💰 Refunded {} lamports to buyer", escrow_balance);
    }

    // Reset listing to Active state
    listing.status = ListingStatus::Active;
    listing.buyer = None;
    listing.buyer_commitment = None;
    listing.claimed_at = None;

    msg!("✅ Claim cancelled by buyer: {:?}", buyer.key());

    Ok(())
}
