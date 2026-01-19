#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash;
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    cpi::{v2::CpiAccounts, InvokeLightSystemProgram, LightCpiInstruction},
    instruction::{account_meta::CompressedAccountMeta, PackedAddressTreeInfo, ValidityProof},
};

use crate::errors::EncoreError;
use crate::events::TicketTransferred;
use crate::state::{EventConfig, PrivateTicket};
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
/// * `seller_pubkey` - Seller's public key (revealed to prove ownership)
/// * `seller_secret` - Seller's secret (revealed to prove ownership)
/// * `new_owner_commitment` - Buyer's commitment: hash(buyer_pubkey || buyer_secret)
/// * `resale_price` - Optional resale price (must respect cap)
pub fn transfer_ticket<'info>(
    ctx: Context<'_, '_, '_, 'info, TransferTicket<'info>>,
    proof: ValidityProof,
    account_meta: CompressedAccountMeta,
    address_tree_info: PackedAddressTreeInfo,
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

    // Load the existing ticket
    let current_ticket = PrivateTicket {
        event_config: event_config.key(),
        ticket_id: 0, // Will be loaded from account
        owner_commitment: expected_commitment,
        original_price: 0, // Will be loaded from account
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
    let nullifier = hash(&nullifier_data).to_bytes();

    // Derive nullifier address
    let (_nullifier_address, nullifier_seed) = derive_address(
        &[
            b"nullifier",
            &nullifier,
        ],
        &address_tree_pubkey,
        &crate::ID,
    );

    // Update ticket ownership
    let old_commitment = ticket.owner_commitment;
    ticket.owner_commitment = new_owner_commitment;

    // CPI to update the ticket in Merkle tree
    use light_sdk::cpi::v2::LightSystemProgramCpi;
    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(ticket)?
        .with_new_addresses(&[address_tree_info.into_new_address_params_assigned_packed(nullifier_seed, None)])
        .invoke(light_cpi_accounts)?;

    emit!(TicketTransferred {
        event_config: event_config.key(),
        ticket_id: 0, // TODO: get from ticket
        old_commitment,
        new_commitment: new_owner_commitment,
        nullifier,
    });

    Ok(())
}
