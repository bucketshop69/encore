#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    cpi::{v2::CpiAccounts, CpiSigner, InvokeLightSystemProgram, LightCpiInstruction},
    derive_light_cpi_signer,
    instruction::{PackedAddressTreeInfo, ValidityProof},
};

use crate::constants::*;
use crate::errors::EncoreError;
use crate::events::TicketMinted;
use crate::state::{EventConfig, PrivateTicket};

pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("BjapcaBemidgideMDLWX4wujtnEETZknmNyv28uXVB7V");

#[derive(Accounts)]
pub struct MintTicket<'info> {
    /// The buyer who is purchasing the ticket
    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: Event owner (not required to sign)
    pub event_owner: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [EVENT_SEED, event_owner.key().as_ref()],
        bump = event_config.bump,
    )]
    pub event_config: Account<'info, EventConfig>,
}

/// Mint a private ticket to a recipient.
///
/// Commitment model: CREATE ticket with owner_commitment.
/// owner_commitment = hash(owner_pubkey || secret)
/// No spam prevention (max_tickets_per_person not enforced).
pub fn mint_ticket<'info>(
    ctx: Context<'_, '_, '_, 'info, MintTicket<'info>>,
    proof: ValidityProof,
    address_tree_info: PackedAddressTreeInfo,
    output_state_tree_index: u8,
    owner_commitment: [u8; 32],
    purchase_price: u64,
    ticket_address_seed: [u8; 32],
) -> Result<()> {
    let event_config = &mut ctx.accounts.event_config;

    require!(purchase_price > 0, EncoreError::InvalidPurchasePrice);
    require!(event_config.can_mint(1), EncoreError::MaxSupplyReached);

    let ticket_id = event_config.tickets_minted + 1;

    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.buyer.as_ref(),
        ctx.remaining_accounts,
        LIGHT_CPI_SIGNER,
    );

    msg!("Starting mint ticket...");

    let address_tree_pubkey = address_tree_info
        .get_tree_pubkey(&light_cpi_accounts)
        .map_err(|_| EncoreError::InvalidAddressTree)?;

    msg!("Address tree: {:?}", address_tree_pubkey);

    // Validate we're using V2 address tree for proper compression (skip in test mode)
    #[cfg(not(feature = "test-mode"))]
    if address_tree_pubkey.to_bytes() != light_sdk_types::ADDRESS_TREE_V2 {
        msg!("Invalid address tree: must use Address Tree V2");
        return Err(ProgramError::InvalidAccountData.into());
    }

    // --- Private Ticket Logic ---
    msg!(
        "Rust: Ticket address seed (first 8): {:?}",
        &ticket_address_seed[..8]
    );
    let (ticket_address, ticket_seed) = derive_address(
        &[
            TICKET_SEED,
            ticket_address_seed.as_ref(), // Random seed from client
        ],
        &address_tree_pubkey,
        &crate::ID,
    );

    let mut ticket_account = LightAccount::<PrivateTicket>::new_init(
        &crate::ID,
        Some(ticket_address),
        output_state_tree_index,
    );
    ticket_account.event_config = event_config.key();
    ticket_account.ticket_id = ticket_id;
    ticket_account.owner_commitment = owner_commitment;
    ticket_account.original_price = purchase_price;

    // --- Execute CPI ---
    use light_sdk::cpi::v2::LightSystemProgramCpi;

    let ticket_params =
        address_tree_info.into_new_address_params_assigned_packed(ticket_seed, Some(0));

    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(ticket_account)?
        .with_new_addresses(&[ticket_params])
        .invoke(light_cpi_accounts)?;

    event_config.tickets_minted = ticket_id;

    // Emit event (Sanitized)
    emit!(TicketMinted {
        event_config: event_config.key(),
        purchase_price,
    });

    Ok(())
}
