use anchor_lang::prelude::*;

use crate::constants::LISTING_SEED;
use crate::errors::EncoreError;
use crate::state::{Listing, ListingStatus};

#[derive(Accounts)]
#[instruction()]
pub struct ClaimListing<'info> {
    /// Buyer who is claiming the listing
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// Listing being claimed
    #[account(
        mut,
        seeds = [LISTING_SEED, listing.seller.as_ref(), &listing.ticket_commitment],
        bump = listing.bump,
    )]
    pub listing: Account<'info, Listing>,
}

/// Claim a marketplace listing for purchase.
///
/// # Privacy Model
/// - Buyer's identity is public (they claim the listing)
/// - Buyer's new commitment is stored for ticket transfer
/// - Listing is locked for 24 hours for payment
///
/// # Operations
/// 1. Validate listing is Active
/// 2. Set buyer, buyer_commitment, claimed_at
/// 3. Set status to Claimed
pub fn claim_listing(
    ctx: Context<ClaimListing>,
    buyer_commitment: [u8; 32], // Buyer's new commitment for ticket transfer
) -> Result<()> {
    let buyer = &ctx.accounts.buyer;
    let listing = &mut ctx.accounts.listing;

    // Validate listing status
    require!(
        listing.status == ListingStatus::Active,
        EncoreError::ListingNotActive
    );

    // Set claim data
    listing.buyer = Some(*buyer.key);
    listing.buyer_commitment = Some(buyer_commitment);
    listing.claimed_at = Some(Clock::get()?.unix_timestamp);
    listing.status = ListingStatus::Claimed;

    msg!("✅ Listing claimed by buyer: {:?}", buyer.key());

    Ok(())
}
