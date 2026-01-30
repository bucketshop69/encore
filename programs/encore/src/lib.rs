use anchor_lang::prelude::*;
use light_sdk::instruction::{PackedAddressTreeInfo, ValidityProof};

pub mod constants;
pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("BjapcaBemidgideMDLWX4wujtnEETZknmNyv28uXVB7V");

#[program]
pub mod encore {
    use super::*;

    pub fn create_event(
        ctx: Context<CreateEvent>,
        max_supply: u32,
        resale_cap_bps: u32,
        event_name: String,
        event_location: String,
        event_description: String,
        max_tickets_per_person: u8,
        event_timestamp: i64,
    ) -> Result<()> {
        instructions::create_event(
            ctx,
            max_supply,
            resale_cap_bps,
            event_name,
            event_location,
            event_description,
            max_tickets_per_person,
            event_timestamp,
        )
    }

    pub fn update_event(ctx: Context<UpdateEvent>, resale_cap_bps: Option<u32>) -> Result<()> {
        instructions::update_event(ctx, resale_cap_bps)
    }

    pub fn mint_ticket<'info>(
        ctx: Context<'_, '_, '_, 'info, MintTicket<'info>>,
        proof: ValidityProof,
        address_tree_info: PackedAddressTreeInfo,
        output_state_tree_index: u8,
        owner_commitment: [u8; 32],
        purchase_price: u64,
        ticket_address_seed: [u8; 32],
    ) -> Result<()> {
        instructions::mint_ticket(
            ctx,
            proof,
            address_tree_info,
            output_state_tree_index,
            owner_commitment,
            purchase_price,
            ticket_address_seed,
        )
    }

    /// Transfer ticket using Commitment + Nullifier pattern.
    /// - Seller reveals secret to prove ownership
    /// - Creates nullifier (prevents double-spend)
    /// - Creates new ticket with buyer's commitment
    pub fn transfer_ticket<'info>(
        ctx: Context<'_, '_, '_, 'info, TransferTicket<'info>>,
        proof: ValidityProof,
        address_tree_info: PackedAddressTreeInfo,
        output_state_tree_index: u8,
        current_ticket_id: u32,
        current_original_price: u64,
        seller_secret: [u8; 32],
        new_owner_commitment: [u8; 32],
        new_ticket_address_seed: [u8; 32],
        resale_price: Option<u64>,
    ) -> Result<()> {
        instructions::transfer_ticket(
            ctx,
            proof,
            address_tree_info,
            output_state_tree_index,
            current_ticket_id,
            current_original_price,
            seller_secret,
            new_owner_commitment,
            new_ticket_address_seed,
            resale_price,
        )
    }
}
