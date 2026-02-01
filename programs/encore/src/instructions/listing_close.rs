use anchor_lang::prelude::*;

use crate::constants::LISTING_SEED;
use crate::errors::EncoreError;
use crate::state::{Listing, ListingStatus};

#[derive(Accounts)]
pub struct CloseListing<'info> {
    /// Seller who owns the listing
    #[account(mut)]
    pub seller: Signer<'info>,

    /// Listing being closed - rent returned to seller
    #[account(
        mut,
        seeds = [LISTING_SEED, listing.seller.as_ref(), &listing.ticket_commitment],
        bump = listing.bump,
        close = seller,
    )]
    pub listing: Account<'info, Listing>,
}

/// Close a cancelled or completed listing to reclaim rent.
/// This is used to clean up "zombie" listings that are no longer needed.
///
/// # Operations
/// 1. Validate listing is Cancelled or Completed
/// 2. Close account (handled by Anchor's `close` constraint)
pub fn close_listing(ctx: Context<CloseListing>) -> Result<()> {
    let seller = &ctx.accounts.seller;
    let listing = &ctx.accounts.listing;

    // Validate seller is the listing seller
    require!(listing.seller == seller.key(), EncoreError::NotSeller);

    // Can only close Cancelled or Completed listings
    require!(
        listing.status == ListingStatus::Cancelled || listing.status == ListingStatus::Completed,
        EncoreError::ListingNotCancelled
    );

    msg!("✅ Listing closed by seller: {:?}", seller.key());

    Ok(())
}
