#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    cpi::{v2::CpiAccounts, InvokeLightSystemProgram, LightCpiInstruction},
    instruction::{account_meta::CompressedAccountMeta, PackedAddressTreeInfo, ValidityProof},
};
use light_sdk_types::ADDRESS_TREE_V2;

use crate::errors::EncoreError;
use crate::events::TicketTransferred;
use crate::state::{EventConfig, PrivateTicket};
use crate::instructions::ticket_mint::LIGHT_CPI_SIGNER;
use crate::constants::TICKET_SEED;

#[derive(Accounts)]
pub struct TransferTicket<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The current owner of the ticket (Ephemeral Keypair for privacy)
    /// Must sign to prove ownership.
    pub owner: Signer<'info>,

    /// Event config to check resale cap
    pub event_config: Account<'info, EventConfig>,
}

/// Transfer a private ticket to a new owner.
/// 
/// # Privacy
/// - Privacy is achieved via Ephemeral Keypairs (Stealth Addresses).
/// - The 'owner' signer is a fresh keypair that holds this specific ticket.
/// - It is not linked to the user's main wallet.
/// - Validating the signature proves ownership without revealing secrets on-chain.
use light_sdk::address::v2::derive_address;

pub fn transfer_ticket<'info>(
    ctx: Context<'_, '_, '_, 'info, TransferTicket<'info>>,
    proof: ValidityProof,
    account_meta: CompressedAccountMeta,
    address_tree_info: PackedAddressTreeInfo,
    current_ticket_id: u32,
    current_original_price: u64,
    new_owner: Pubkey,
    new_address_seed: [u8; 32],
    resale_price: Option<u64>,
) -> Result<()> {
    let event_config = &ctx.accounts.event_config;

    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.payer.as_ref(),
        ctx.remaining_accounts,
        LIGHT_CPI_SIGNER,
    );

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
    // We construct the expected state to verify against the proof
    let current_ticket = PrivateTicket {
        event_config: event_config.key(),
        ticket_id: current_ticket_id,
        owner: ctx.accounts.owner.key(), // AUTHORITY CHECK: proof must match this owner
        original_price: current_original_price,
    };

    let mut ticket = LightAccount::<PrivateTicket>::new_mut(
        &crate::ID,
        &account_meta,
        current_ticket,
    ).map_err(|_| EncoreError::InvalidTicket)?;

    // Start strict verification:
    // The proof verifies that a compressed account exists with the data we constructed above.
    // Since we put 'ctx.accounts.owner.key()' into the constructed struct,
    // successful proof verification GUARANTEES that the on-chain account's 'owner' field
    // matches the transaction signer.
    
    // Check resale cap if price provided
    if let Some(price) = resale_price {
        let max_allowed = event_config.calculate_max_resale_price(ticket.original_price);
        require!(price <= max_allowed, EncoreError::ExceedsResaleCap);
    }

    // Update ticket ownership
    let _old_owner = ticket.owner;
    ticket.owner = new_owner;

    // Derive NEW address for privacy rotation
    let (_, address_seed) = derive_address(
        &[
            TICKET_SEED,
            new_address_seed.as_ref(),
        ],
        &address_tree_pubkey,
        &crate::ID,
    );

    // CPI to update the ticket (consume old UTXO, create new one)
    use light_sdk::cpi::v2::LightSystemProgramCpi;
    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(ticket)?
        .with_new_addresses(&[address_tree_info.into_new_address_params_assigned_packed(address_seed, Some(0))])
        .invoke(light_cpi_accounts)?;

    emit!(TicketTransferred {
        event_config: event_config.key(),
    });

    Ok(())
}
