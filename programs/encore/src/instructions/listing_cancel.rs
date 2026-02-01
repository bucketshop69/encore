use anchor_lang::prelude::*;

use crate::constants::LISTING_SEED;
use crate::errors::EncoreError;
use crate::state::{Listing, ListingStatus};

#[derive(Accounts)]
pub struct CancelListing<'info> {
    /// Seller who is cancelling the listing
    #[account(mut)]
    pub seller: Signer<'info>,

    /// Listing being cancelled - will be closed and rent returned to seller
    #[account(
        mut,
        seeds = [LISTING_SEED, listing.seller.as_ref(), &listing.ticket_commitment],
        bump = listing.bump,
        close = seller,  // Close account and return rent to seller
    )]
    pub listing: Account<'info, Listing>,
}

/// Cancel a marketplace listing before it's claimed.
/// The listing account is closed and rent is returned to the seller.
///
/// # Operations
/// 1. Validate listing is Active
/// 2. Close account (handled by Anchor's `close` constraint)
pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
    let seller = &ctx.accounts.seller;
    let listing = &ctx.accounts.listing;

    // Validate listing status - can only cancel Active listings
    require!(
        listing.status == ListingStatus::Active,
        EncoreError::ListingNotActive
    );

    // Validate seller is the listing seller
    require!(listing.seller == seller.key(), EncoreError::NotSeller);

    // Account will be closed automatically by Anchor's `close = seller` constraint

    msg!(
        "✅ Listing cancelled and closed by seller: {:?}",
        seller.key()
    );

    Ok(())
}
