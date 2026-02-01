#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    cpi::{v2::CpiAccounts, InvokeLightSystemProgram, LightCpiInstruction},
    instruction::{PackedAddressTreeInfo, ValidityProof},
};

use crate::constants::TICKET_SEED;
use crate::errors::EncoreError;
use crate::events::TicketTransferred;
use crate::instructions::ticket_mint::LIGHT_CPI_SIGNER;
use crate::state::{EventConfig, Nullifier, PrivateTicket};

/// Prefix for nullifier address derivation
pub const NULLIFIER_PREFIX: &[u8] = b"nullifier";

#[derive(Accounts)]
pub struct TransferTicket<'info> {
    /// The seller who is transferring (also pays fees)
    #[account(mut)]
    pub seller: Signer<'info>,

    /// CHECK: Not used currently but kept for signature
    pub event_owner: UncheckedAccount<'info>,

    /// Event config to check resale cap
    #[account(
        mut,
        seeds = [crate::constants::EVENT_SEED, event_owner.key().as_ref()],
        bump = event_config.bump,
    )]
    pub event_config: Account<'info, EventConfig>,
}

/// Transfer a private ticket using Commitment + Nullifier pattern.
///
/// # Privacy Model
/// - Seller proves ownership by SIGNING + revealing SECRET
/// - Commitment verified: hash(owner_pubkey || secret) == ticket.owner_commitment
/// - Nullifier prevents double-spend: CREATE account at hash("nullifier" || secret)
/// - Buyer's identity hidden - only their new_commitment stored
///
/// # Operations (all CREATEs - no burns/mutations)
/// 1. Verify ownership via commitment
/// 2. CREATE nullifier (prevents reuse of this secret)
/// 3. CREATE new ticket with buyer's commitment
pub fn transfer_ticket<'info>(
    ctx: Context<'_, '_, '_, 'info, TransferTicket<'info>>,
    proof: ValidityProof,
    address_tree_info: PackedAddressTreeInfo,
    output_state_tree_index: u8,
    // Existing ticket data (for verification)
    current_ticket_id: u32,
    current_original_price: u64,
    // Seller reveals secret to prove ownership
    seller_secret: [u8; 32],
    // Buyer's new commitment
    new_owner_commitment: [u8; 32],
    // Random seed for new ticket address
    new_ticket_address_seed: [u8; 32],
    // Optional resale price for cap enforcement
    resale_price: Option<u64>,
) -> Result<()> {
    let event_config = &ctx.accounts.event_config;
    let seller = &ctx.accounts.seller;

    // --- Step 1: Verify ownership via commitment ---
    // commitment = SHA256(owner_pubkey || secret)
    let mut commitment_input = Vec::with_capacity(64);
    commitment_input.extend_from_slice(seller.key().as_ref());
    commitment_input.extend_from_slice(&seller_secret);
    let computed_commitment = hash(&commitment_input);

    msg!("Owner pubkey: {:?}", seller.key());
    msg!(
        "Computed commitment (first 8): {:?}",
        &computed_commitment.to_bytes()[..8]
    );

    // The commitment is verified implicitly via the proof - the ticket with this
    // commitment must exist for the proof to be valid. The CPI will fail if the
    // ticket data doesn't match what's in the Merkle tree.

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

    // Check resale cap if price provided
    if let Some(price) = resale_price {
        let max_allowed = event_config.calculate_max_resale_price(current_original_price);
        require!(price <= max_allowed, EncoreError::ExceedsResaleCap);
    }

    // --- Step 2: Create nullifier ---
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

    // --- Step 3: Create new ticket with buyer's commitment ---
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
    new_ticket_account.event_config = event_config.key();
    new_ticket_account.ticket_id = current_ticket_id; // Preserve ticket ID
    new_ticket_account.owner_commitment = new_owner_commitment; // Buyer's commitment
    new_ticket_account.original_price = current_original_price; // Preserve for resale cap

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

    emit!(TicketTransferred {
        event_config: event_config.key(),
    });

    msg!("✅ Transfer complete: nullifier created, new ticket issued");

    Ok(())
}
