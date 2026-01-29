#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    cpi::{v2::CpiAccounts, CpiSigner, InvokeLightSystemProgram, LightCpiInstruction},
    derive_light_cpi_signer,
    instruction::{account_meta::CompressedAccountMeta, PackedAddressTreeInfo, ValidityProof},
};

use crate::constants::*;
use crate::errors::EncoreError;
use crate::events::TicketMinted;
use crate::state::{EventConfig, IdentityCounter, PrivateTicket};

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
pub fn mint_ticket<'info>(
    ctx: Context<'_, '_, '_, 'info, MintTicket<'info>>,
    proof: ValidityProof,
    identity_address_tree_info: Option<PackedAddressTreeInfo>,
    ticket_address_tree_info: PackedAddressTreeInfo,
    output_state_tree_index: u8,
    owner: Pubkey,
    purchase_price: u64,
    ticket_address_seed: [u8; 32],
    identity_account_meta: Option<CompressedAccountMeta>,
    current_tickets_minted: Option<u8>,
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

    // Get address tree from whichever tree info is provided
    // For first mint: identity_address_tree_info is Some
    // For subsequent: identity_address_tree_info is None, use ticket's
    let address_tree_info = identity_address_tree_info
        .as_ref()
        .unwrap_or(&ticket_address_tree_info);

    let address_tree_pubkey = address_tree_info
        .get_tree_pubkey(&light_cpi_accounts)
        .map_err(|_| EncoreError::InvalidAddressTree)?;

    msg!("Address tree: {:?}", address_tree_pubkey);

    // Validate we're using V2 address tree for proper compression
    if address_tree_pubkey.to_bytes() != light_sdk_types::ADDRESS_TREE_V2 {
        msg!("Invalid address tree: must use Address Tree V2");
        return Err(ProgramError::InvalidAccountData.into());
    }

    // --- Identity Counter Logic ---
    let (identity_address, identity_seed) = derive_address(
        &[
            IDENTITY_COUNTER_SEED,
            event_config.key().as_ref(),
            ctx.accounts.buyer.key().as_ref(), // User identity
        ],
        &address_tree_pubkey,
        &crate::ID,
    );

    let identity_counter_account = if let Some(meta) = identity_account_meta {
        // Update existing counter - user has minted before
        let current_count = current_tickets_minted.ok_or(ProgramError::InvalidInstructionData)?;

        // Validation: Ensure user hasn't reached their limit
        // If max_tickets_per_person = 2, allow minting when current_count is 0 or 1
        // When current_count = 2, this check will fail (2 < 2 is false)
        require!(
            current_count < event_config.max_tickets_per_person,
            EncoreError::MaxTicketsPerPersonReached
        );

        // Construct the OLD state for proof verification
        // Light Protocol will verify this matches on-chain data
        let old_counter = IdentityCounter {
            event: event_config.key(),
            authority: ctx.accounts.buyer.key(),
            tickets_minted: current_count,
        };

        // Create mutable account that will be updated to NEW state
        let mut account = LightAccount::<IdentityCounter>::new_mut(&crate::ID, &meta, old_counter)
            .map_err(|_| ProgramError::InvalidAccountData)?;

        // Increment counter for this new mint
        account.tickets_minted = current_count
            .checked_add(1)
            .ok_or(ProgramError::ArithmeticOverflow)?;
        account
    } else {
        // Create new counter - first mint for this user+event
        // Validation: Ensure event allows at least 1 ticket per person
        require!(
            event_config.max_tickets_per_person >= 1,
            EncoreError::MaxTicketsPerPersonReached
        );

        let mut account = LightAccount::<IdentityCounter>::new_init(
            &crate::ID,
            Some(identity_address),
            output_state_tree_index,
        );
        account.event = event_config.key();
        account.authority = ctx.accounts.buyer.key();
        account.tickets_minted = 1;
        account
    };

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
    ticket_account.owner = owner;
    ticket_account.original_price = purchase_price;

    // --- Execute CPI ---
    use light_sdk::cpi::v2::LightSystemProgramCpi;

    // Create address params based on whether this is first or subsequent mint
    let mut cpi = LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(identity_counter_account)?
        .with_light_account(ticket_account)?;

    // For first mint: create both addresses
    // For subsequent mint: only create ticket address (identity already exists)
    if let Some(identity_tree_info) = identity_address_tree_info {
        let identity_params =
            identity_tree_info.into_new_address_params_assigned_packed(identity_seed, Some(0));
        let ticket_params =
            ticket_address_tree_info.into_new_address_params_assigned_packed(ticket_seed, Some(1));

        cpi = cpi.with_new_addresses(&[identity_params, ticket_params]);
    } else {
        // Subsequent mint: only ticket is a new address
        let ticket_params =
            ticket_address_tree_info.into_new_address_params_assigned_packed(ticket_seed, Some(0));

        cpi = cpi.with_new_addresses(&[ticket_params]);
    }

    cpi.invoke(light_cpi_accounts)?;

    event_config.tickets_minted = ticket_id;

    // Emit event (Sanitized)
    emit!(TicketMinted {
        event_config: event_config.key(),
        purchase_price,
    });

    Ok(())
}
