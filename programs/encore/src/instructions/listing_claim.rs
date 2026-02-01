use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::{ESCROW_SEED, LISTING_SEED};
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

    /// Escrow PDA to hold payment
    /// CHECK: This is a PDA owned by the system program that will hold SOL
    #[account(
        mut,
        seeds = [ESCROW_SEED, listing.key().as_ref()],
        bump,
    )]
    pub escrow: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Claim a marketplace listing for purchase.
///
/// # Privacy Model
/// - Buyer's identity is public (they claim the listing)
/// - Buyer's new commitment is stored for ticket transfer
/// - Listing is locked for 24 hours for payment
///
/// # Escrow
/// - Buyer deposits listing.price_lamports to escrow PDA
/// - SOL is held until sale completes or claim is cancelled
///
/// # Operations
/// 1. Validate listing is Active
/// 2. Transfer SOL from buyer to escrow
/// 3. Set buyer, buyer_commitment, claimed_at
/// 4. Set status to Claimed
pub fn claim_listing(
    ctx: Context<ClaimListing>,
    buyer_commitment: [u8; 32], // Buyer's new commitment for ticket transfer
) -> Result<()> {
    let buyer = &ctx.accounts.buyer;
    let listing = &mut ctx.accounts.listing;
    let escrow = &ctx.accounts.escrow;

    // Validate listing status
    require!(
        listing.status == ListingStatus::Active,
        EncoreError::ListingNotActive
    );

    // Transfer SOL from buyer to escrow
    let price = listing.price_lamports;
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: buyer.to_account_info(),
                to: escrow.to_account_info(),
            },
        ),
        price,
    )?;

    msg!("💰 Deposited {} lamports to escrow", price);

    // Set claim data
    listing.buyer = Some(*buyer.key);
    listing.buyer_commitment = Some(buyer_commitment);
    listing.claimed_at = Some(Clock::get()?.unix_timestamp);
    listing.status = ListingStatus::Claimed;

    msg!("✅ Listing claimed by buyer: {:?}", buyer.key());

    Ok(())
}
