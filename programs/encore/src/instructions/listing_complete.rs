#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    cpi::{v2::CpiAccounts, InvokeLightSystemProgram, LightCpiInstruction},
    instruction::{PackedAddressTreeInfo, ValidityProof},
};

use crate::constants::{ESCROW_SEED, LISTING_SEED, TICKET_SEED};
use crate::errors::EncoreError;
use crate::events::SaleCompleted;
use crate::instructions::ticket_mint::LIGHT_CPI_SIGNER;
use crate::instructions::ticket_transfer::NULLIFIER_PREFIX;
use crate::state::{Listing, ListingStatus, Nullifier, PrivateTicket};

#[derive(Accounts)]
#[instruction()]
pub struct CompleteSale<'info> {
    /// Seller who is completing the sale
    #[account(mut)]
    pub seller: Signer<'info>,

    /// Listing being completed
    #[account(
        mut,
        seeds = [LISTING_SEED, listing.seller.as_ref(), &listing.ticket_commitment],
        bump = listing.bump,
    )]
    pub listing: Account<'info, Listing>,

    /// Escrow PDA holding buyer's payment
    /// CHECK: This is a PDA that holds SOL, validated by seeds
    #[account(
        mut,
        seeds = [ESCROW_SEED, listing.key().as_ref()],
        bump,
    )]
    pub escrow: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Complete a marketplace sale by transferring the ticket to the buyer.
///
/// # Privacy Model (Issue #009 pattern)
/// - Seller proves ownership via secret + commitment
/// - Creates nullifier to prevent double-spend
/// - Creates new ticket with buyer's commitment
///
/// # Operations
/// 1. Validate listing is Claimed
/// 2. Verify seller owns the ticket via commitment
/// 3. CREATE nullifier (prevents reuse of this secret)
/// 4. CREATE new ticket with buyer's commitment
/// 5. Set listing status to Completed
pub fn complete_sale<'info>(
    ctx: Context<'_, '_, '_, 'info, CompleteSale<'info>>,
    proof: ValidityProof,
    address_tree_info: PackedAddressTreeInfo,
    output_state_tree_index: u8,
    new_ticket_address_seed: [u8; 32],
    _ticket_bump: u8,
    seller_secret: [u8; 32],
) -> Result<()> {
    let seller = &ctx.accounts.seller;

    // Get listing key and escrow bump before mutable borrow
    let listing_key = ctx.accounts.listing.key();
    let escrow_bump = ctx.bumps.escrow;

    let listing = &mut ctx.accounts.listing;

    // Validate listing status
    require!(
        listing.status == ListingStatus::Claimed,
        EncoreError::ListingNotClaimed
    );

    // Verify seller owns the ticket via commitment
    // commitment = SHA256(owner_pubkey || secret)
    let mut commitment_input = Vec::with_capacity(64);
    commitment_input.extend_from_slice(seller.key.as_ref());
    commitment_input.extend_from_slice(&seller_secret);
    let computed_commitment = hash(&commitment_input);
    require!(
        computed_commitment.to_bytes() == listing.ticket_commitment,
        EncoreError::NotTicketOwner
    );

    msg!("Seller pubkey: {:?}", seller.key());
    msg!(
        "Computed commitment (first 8): {:?}",
        &computed_commitment.to_bytes()[..8]
    );

    // Get buyer commitment from listing (must be set during claim)
    let buyer_commitment = listing
        .buyer_commitment
        .ok_or(EncoreError::ListingNotClaimed)?;

    // --- Light Protocol CPI Setup ---
    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.seller.as_ref(),
        ctx.remaining_accounts,
        LIGHT_CPI_SIGNER,
    );

    // Get address tree pubkey
    let address_tree_pubkey = address_tree_info
        .get_tree_pubkey(&light_cpi_accounts)
        .map_err(|_| EncoreError::InvalidAddressTree)?;

    // Validate V2 address tree (skip in test mode)
    #[cfg(not(feature = "test-mode"))]
    if address_tree_pubkey.to_bytes() != light_sdk_types::ADDRESS_TREE_V2 {
        msg!("Invalid address tree: must use V2");
        return Err(ProgramError::InvalidAccountData.into());
    }

    // --- Step 1: Create nullifier ---
    // Nullifier address = derive(["nullifier", hash(secret)])
    // Using hash of secret for the nullifier seed
    let nullifier_seed = hash(&seller_secret);

    let (nullifier_address, nullifier_address_seed) = derive_address(
        &[NULLIFIER_PREFIX, nullifier_seed.as_ref()],
        &address_tree_pubkey,
        &crate::ID,
    );
    msg!("Nullifier address: {:?}", nullifier_address);

    let nullifier_account = LightAccount::<Nullifier>::new_init(
        &crate::ID,
        Some(nullifier_address),
        output_state_tree_index,
    );

    // --- Step 2: Create new ticket with buyer's commitment ---
    let (new_ticket_address, new_ticket_seed) = derive_address(
        &[TICKET_SEED, new_ticket_address_seed.as_ref()],
        &address_tree_pubkey,
        &crate::ID,
    );
    msg!("New ticket address: {:?}", new_ticket_address);

    let mut new_ticket_account = LightAccount::<PrivateTicket>::new_init(
        &crate::ID,
        Some(new_ticket_address),
        output_state_tree_index,
    );
    new_ticket_account.event_config = listing.event_config;
    new_ticket_account.ticket_id = listing.ticket_id; // Preserve ticket ID
    new_ticket_account.owner_commitment = buyer_commitment; // Buyer's commitment
    new_ticket_account.original_price = listing.price_lamports; // Preserve for resale cap

    // --- Execute CPI: CREATE nullifier + CREATE new ticket ---
    use light_sdk::cpi::v2::LightSystemProgramCpi;

    // Two new addresses: nullifier (index 0) and new ticket (index 1)
    let nullifier_params =
        address_tree_info.into_new_address_params_assigned_packed(nullifier_address_seed, Some(0));
    let new_ticket_params =
        address_tree_info.into_new_address_params_assigned_packed(new_ticket_seed, Some(1));

    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(nullifier_account)? // CREATE nullifier
        .with_light_account(new_ticket_account)? // CREATE new ticket
        .with_new_addresses(&[nullifier_params, new_ticket_params])
        .invoke(light_cpi_accounts)?;

    // --- Step 3: Transfer escrow SOL to seller using PDA signing ---
    let escrow_balance = ctx.accounts.escrow.lamports();
    if escrow_balance > 0 {
        let escrow_seeds: &[&[u8]] = &[ESCROW_SEED, listing_key.as_ref(), &[escrow_bump]];

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                },
                &[escrow_seeds],
            ),
            escrow_balance,
        )?;
        msg!(
            "💰 Transferred {} lamports from escrow to seller",
            escrow_balance
        );
    }

    // Update listing status
    listing.status = ListingStatus::Completed;

    emit!(SaleCompleted {
        listing: listing.key(),
        seller: seller.key(),
        buyer: listing.buyer.unwrap(),
        event_config: listing.event_config,
        ticket_id: listing.ticket_id,
        price_lamports: listing.price_lamports,
    });

    msg!("✅ Sale completed: nullifier created, new ticket issued to buyer");

    Ok(())
}
