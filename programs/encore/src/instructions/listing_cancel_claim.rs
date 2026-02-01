use anchor_lang::prelude::*;

use crate::constants::LISTING_SEED;
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
}

/// Cancel a claim on a marketplace listing.
///
/// Allows a buyer who has claimed a listing to voluntarily release it
/// back to the marketplace. This is useful when the buyer changes their
/// mind, cannot pay, or made a mistake.
///
/// # Privacy Model
/// - No conflict: This only affects the Listing state
/// - Identity: The Buyer signs, proving they are listing.buyer
///
/// # Operations
/// 1. Validate listing is Claimed
/// 2. Validate buyer is the listing buyer
/// 3. Reset listing to Active state
pub fn cancel_claim(ctx: Context<CancelClaim>) -> Result<()> {
    let buyer = &ctx.accounts.buyer;
    let listing = &mut ctx.accounts.listing;

    // Validate listing status is Claimed
    require!(
        listing.status == ListingStatus::Claimed,
        EncoreError::ListingNotClaimed
    );

    // Validate the signer is the buyer who claimed
    require!(listing.buyer == Some(*buyer.key), EncoreError::NotBuyer);

    // Reset listing to Active state
    listing.status = ListingStatus::Active;
    listing.buyer = None;
    listing.buyer_commitment = None;
    listing.claimed_at = None;

    msg!("✅ Claim cancelled by buyer: {:?}", buyer.key());

    Ok(())
}
