use anchor_lang::prelude::*;

use crate::constants::LISTING_SEED;
use crate::errors::EncoreError;
use crate::state::{Listing, ListingStatus};

#[derive(Accounts)]
pub struct ReleaseClaim<'info> {
    /// Seller who is releasing the claim
    #[account(mut)]
    pub seller: Signer<'info>,

    /// Listing being released
    #[account(
        mut,
        seeds = [LISTING_SEED, listing.seller.as_ref(), &listing.ticket_commitment],
        bump = listing.bump,
    )]
    pub listing: Account<'info, Listing>,
}

/// Release a claimed listing if the buyer didn't pay within the timeout.
///
/// # Operations
/// 1. Validate listing is Claimed
/// 2. Validate timeout has been reached (24 hours)
/// 3. Set status back to Active
/// 4. Clear buyer data
pub fn release_claim(ctx: Context<ReleaseClaim>) -> Result<()> {
    let seller = &ctx.accounts.seller;
    let listing = &mut ctx.accounts.listing;

    // Validate listing status
    require!(
        listing.status == ListingStatus::Claimed,
        EncoreError::ListingNotClaimed
    );

    // Validate seller is the listing seller
    require!(listing.seller == *seller.key, EncoreError::NotSeller);

    // Validate timeout has been reached
    let current_time = Clock::get()?.unix_timestamp;
    let claimed_at = listing.claimed_at.ok_or(EncoreError::ListingNotClaimed)?;
    require!(
        current_time > claimed_at + crate::constants::CLAIM_TIMEOUT_SECONDS,
        EncoreError::ClaimTimeoutNotReached
    );

    // Reset listing to Active
    listing.status = ListingStatus::Active;
    listing.buyer = None;
    listing.buyer_commitment = None;
    listing.claimed_at = None;

    msg!("✅ Claim released by seller: {:?}", seller.key());

    Ok(())
}
