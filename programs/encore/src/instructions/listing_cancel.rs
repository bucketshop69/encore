use anchor_lang::prelude::*;

use crate::constants::LISTING_SEED;
use crate::errors::EncoreError;
use crate::state::{Listing, ListingStatus};

#[derive(Accounts)]
pub struct CancelListing<'info> {
    /// Seller who is cancelling the listing
    #[account(mut)]
    pub seller: Signer<'info>,

    /// Listing being cancelled
    #[account(
        mut,
        seeds = [LISTING_SEED, listing.seller.as_ref(), &listing.ticket_commitment],
        bump = listing.bump,
    )]
    pub listing: Account<'info, Listing>,
}

/// Cancel a marketplace listing before it's claimed.
///
/// # Operations
/// 1. Validate listing is Active
/// 2. Set status to Cancelled
pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
    let seller = &ctx.accounts.seller;
    let listing = &mut ctx.accounts.listing;

    // Validate listing status
    require!(
        listing.status == ListingStatus::Active,
        EncoreError::ListingNotActive
    );

    // Validate seller is the listing seller
    require!(listing.seller == seller.key(), EncoreError::NotSeller);

    // Set status to Cancelled
    listing.status = ListingStatus::Cancelled;

    msg!("✅ Listing cancelled by seller: {:?}", seller.key());

    Ok(())
}
