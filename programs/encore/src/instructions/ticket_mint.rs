#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    cpi::{v2::CpiAccounts, CpiSigner, InvokeLightSystemProgram, LightCpiInstruction},
    derive_light_cpi_signer,
    instruction::{PackedAddressTreeInfo, ValidityProof},
};
use light_sdk_types::ADDRESS_TREE_V2;

use crate::constants::*;
use crate::errors::EncoreError;
use crate::events::TicketMinted;
use crate::state::{EventConfig, PrivateTicket};

pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("2Ky4W1nqfzo82q4KTCR1RJpTjF7ihWU7dcwSVb7Rc6pT");

#[derive(Accounts)]
pub struct MintTicket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [EVENT_SEED, authority.key().as_ref()],
        bump = event_config.bump,
        has_one = authority @ EncoreError::Unauthorized
    )]
    pub event_config: Account<'info, EventConfig>,
}

/// Mint a private ticket to a recipient.
/// 
/// # Privacy
/// The `owner_commitment` hides who owns the ticket.
/// Recipient computes: commitment = Poseidon(their_pubkey, their_secret)
/// Only the recipient knows the secret needed to prove ownership later.
/// 
/// # Arguments
/// * `owner_commitment` - Hash of (owner_pubkey, secret), computed by recipient
/// * `purchase_price` - Price paid for the ticket (becomes original_price)
pub fn mint_ticket<'info>(
    ctx: Context<'_, '_, '_, 'info, MintTicket<'info>>,
    proof: ValidityProof,
    address_tree_info: PackedAddressTreeInfo,
    output_state_tree_index: u8,
    owner_commitment: [u8; 32],
    purchase_price: u64,
) -> Result<()> {
    let event_config = &mut ctx.accounts.event_config;

    require!(purchase_price > 0, EncoreError::InvalidPurchasePrice);
    require!(
        event_config.can_mint(1),
        EncoreError::MaxSupplyReached
    );

    let ticket_id = event_config.tickets_minted + 1;

    let light_cpi_accounts = CpiAccounts::new(
        ctx.accounts.authority.as_ref(),
        ctx.remaining_accounts,
        LIGHT_CPI_SIGNER,
    );

    let address_tree_pubkey = address_tree_info
        .get_tree_pubkey(&light_cpi_accounts)
        .map_err(|_| EncoreError::InvalidAddressTree)?;

    // Validate we're using V2 address tree
    if address_tree_pubkey.to_bytes() != ADDRESS_TREE_V2 {
        msg!("Invalid address tree: must use V2");
        return Err(ProgramError::InvalidAccountData.into());
    }

    let (address, address_seed) = derive_address(
        &[
            TICKET_SEED,
            event_config.key().as_ref(),
            &ticket_id.to_le_bytes(),
        ],
        &address_tree_pubkey,
        &crate::ID,
    );

    // Create private ticket with commitment (not pubkey!)
    let mut light_account = LightAccount::<PrivateTicket>::new_init(
        &crate::ID,
        Some(address),
        output_state_tree_index,
    );

    light_account.event_config = event_config.key();
    light_account.ticket_id = ticket_id;
    light_account.owner_commitment = owner_commitment;
    light_account.original_price = purchase_price;

    use light_sdk::cpi::v2::LightSystemProgramCpi;
    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(light_account)?
        .with_new_addresses(&[address_tree_info.into_new_address_params_assigned_packed(address_seed, Some(0))])
        .invoke(light_cpi_accounts)?;

    event_config.tickets_minted = ticket_id;

    // Emit event with commitment (preserves privacy)
    emit!(TicketMinted {
        event_config: event_config.key(),
        ticket_id,
        owner_commitment,
        purchase_price,
    });

    Ok(())
}
