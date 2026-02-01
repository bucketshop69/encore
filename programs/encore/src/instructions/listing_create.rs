use anchor_lang::prelude::*;
use anchor_lang::system_program::System;

use crate::constants::LISTING_SEED;
use crate::errors::EncoreError;
use crate::state::{Listing, ListingStatus};

#[derive(Accounts)]
#[instruction(ticket_commitment: [u8; 32])]
pub struct CreateListing<'info> {
    /// Seller who is listing the ticket
    #[account(mut)]
    pub seller: Signer<'info>,

    /// Listing account to be created
    #[account(
        init,
        payer = seller,
        space = 8 + std::mem::size_of::<Listing>(),
        seeds = [LISTING_SEED, seller.key().as_ref(), &ticket_commitment],
        bump
    )]
    pub listing: Account<'info, Listing>,

    pub system_program: Program<'info, System>,
}

/// Create a new marketplace listing for a private ticket.
///
/// # Privacy Model
/// - Seller proves ownership via commitment (from ticket)
/// - Encrypted secret allows ownership proof without revealing secret
/// - Listing is public but ticket ownership remains private
///
/// # Operations
/// 1. Validate price > 0
/// 2. Create listing account
/// 3. Set status to Active
pub fn create_listing(
    ctx: Context<CreateListing>,
    ticket_commitment: [u8; 32], // The ticket's current commitment
    encrypted_secret: [u8; 32],  // secret XOR hash(listing_pda)
    price_lamports: u64,
    event_config: Pubkey,
    ticket_id: u32,
    _ticket_address_seed: [u8; 32], // Not used, for client reference
    _ticket_bump: u8,               // Not used, for client reference
) -> Result<()> {
    let seller = &ctx.accounts.seller;
    let listing = &mut ctx.accounts.listing;

    // Validate price
    require!(price_lamports > 0, EncoreError::InvalidPrice);

    // Initialize listing
    listing.seller = *seller.key;
    listing.ticket_commitment = ticket_commitment;
    listing.encrypted_secret = encrypted_secret;
    listing.price_lamports = price_lamports;
    listing.event_config = event_config;
    listing.ticket_id = ticket_id;
    listing.buyer = None;
    listing.buyer_commitment = None;
    listing.claimed_at = None;
    listing.status = ListingStatus::Active;
    listing.created_at = Clock::get()?.unix_timestamp;
    listing.bump = ctx.bumps.listing;

    msg!(
        "✅ Listing created: {} lamports for ticket {}",
        price_lamports,
        ticket_id
    );

    Ok(())
}
