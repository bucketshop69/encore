#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    cpi::{v2::CpiAccounts, InvokeLightSystemProgram, LightCpiInstruction},
    instruction::{account_meta::CompressedAccountMeta, PackedAddressTreeInfo, ValidityProof},
};
use light_sdk_types::ADDRESS_TREE_V2;

use crate::errors::EncoreError;
use crate::events::TicketTransferred;
use crate::state::{EventConfig, Nullifier, PrivateTicket};
use crate::instructions::ticket_mint::LIGHT_CPI_SIGNER;

#[derive(Accounts)]
pub struct TransferTicket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Event config to check resale cap
    pub event_config: Account<'info, EventConfig>,
}

/// Transfer a private ticket to a new owner.
/// 
/// # Privacy
/// - Seller proves ownership by revealing their pubkey + secret
/// - Buyer's identity is hidden (only commitment stored)
/// - Nullifier prevents seller from double-spending
/// 
/// # Arguments
/// * `current_ticket_id` - The ticket ID from the current account (for verification)
/// * `current_original_price` - The original price from the current account (for resale cap)
/// * `seller_pubkey` - Seller's public key (revealed to prove ownership)
/// * `seller_secret` - Seller's secret (revealed to prove ownership)
/// * `new_owner_commitment` - Buyer's commitment: hash(buyer_pubkey || buyer_secret)
/// * `resale_price` - Optional resale price (must respect cap)
pub fn transfer_ticket<'info>(
    ctx: Context<'_, '_, '_, 'info, TransferTicket<'info>>,
    proof: ValidityProof,
    account_meta: CompressedAccountMeta,
    address_tree_info: PackedAddressTreeInfo,
    // Current account data (from client):
    current_ticket_id: u32,
    current_original_price: u64,
    // Seller proves ownership:
    seller_pubkey: Pubkey,
    seller_secret: [u8; 32],
    // Buyer's new commitment:
    new_owner_commitment: [u8; 32],
    // Optional resale price:
    resale_price: Option<u64>,
) -> Result<()> {
    let event_config = &ctx.accounts.event_config;

    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        ctx.remaining_accounts,
        LIGHT_CPI_SIGNER,
    );

    // Compute what the seller's commitment should be
    let mut seller_data = Vec::with_capacity(64);
    seller_data.extend_from_slice(seller_pubkey.as_ref());
    seller_data.extend_from_slice(&seller_secret);
    let expected_commitment = hash(&seller_data).to_bytes();

    // Get address tree pubkey for address derivation
    let address_tree_pubkey = address_tree_info
        .get_tree_pubkey(&light_cpi_accounts)
        .map_err(|_| EncoreError::InvalidAddressTree)?;

    // Validate we're using V2 address tree
    if address_tree_pubkey.to_bytes() != ADDRESS_TREE_V2 {
        msg!("Invalid address tree: must use V2");
        return Err(ProgramError::InvalidAccountData.into());
    }

    // Load the existing ticket with REAL data from client
    let current_ticket = PrivateTicket {
        event_config: event_config.key(),
        ticket_id: current_ticket_id,  // From client
        owner_commitment: expected_commitment,
        original_price: current_original_price,  // From client
    };

    let mut ticket = LightAccount::<PrivateTicket>::new_mut(
        &crate::ID,
        &account_meta,
        current_ticket,
    ).map_err(|_| EncoreError::InvalidTicket)?;

    // Verify seller owns this ticket
    require!(
        ticket.owner_commitment == expected_commitment,
        EncoreError::NotTicketOwner
    );

    // Check resale cap if price provided
    if let Some(price) = resale_price {
        let max_allowed = event_config.calculate_max_resale_price(ticket.original_price);
        require!(price <= max_allowed, EncoreError::ExceedsResaleCap);
    }

    // Compute nullifier to prevent double-spending
    let mut nullifier_data = Vec::with_capacity(36);
    nullifier_data.extend_from_slice(&ticket.ticket_id.to_le_bytes());
    nullifier_data.extend_from_slice(&seller_secret);
    let nullifier_hash = hash(&nullifier_data).to_bytes();

    // Derive nullifier address
    let (nullifier_address, nullifier_seed) = derive_address(
        &[
            b"nullifier",
            &nullifier_hash,
        ],
        &address_tree_pubkey,
        &crate::ID,
    );

    // Create nullifier light account
    let mut nullifier_account = LightAccount::<Nullifier>::new_init(
        &crate::ID,
        Some(nullifier_address),
        account_meta.output_state_tree_index,  // Use same tree as ticket
    );
    nullifier_account.ticket_id = ticket.ticket_id;

    // Update ticket ownership
    let old_commitment = ticket.owner_commitment;
    ticket.owner_commitment = new_owner_commitment;

    // CPI to update the ticket AND create nullifier in one transaction
    use light_sdk::cpi::v2::LightSystemProgramCpi;
    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(ticket)?  // Account index 0
        .with_light_account(nullifier_account)?  // Account index 1
        .with_new_addresses(&[address_tree_info.into_new_address_params_assigned_packed(nullifier_seed, Some(1))])  // Assign to account 1
        .invoke(light_cpi_accounts)?;

    emit!(TicketTransferred {
        event_config: event_config.key(),
        ticket_id: current_ticket_id,
        old_commitment,
        new_commitment: new_owner_commitment,
        nullifier: nullifier_hash,
    });

    Ok(())
}
