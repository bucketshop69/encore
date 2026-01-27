use anchor_lang::prelude::*;
use light_sdk::instruction::{account_meta::CompressedAccountMeta, PackedAddressTreeInfo, ValidityProof};

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
        instructions::create_event(ctx, max_supply, resale_cap_bps, event_name, event_location, event_description, max_tickets_per_person, event_timestamp)
    }

    pub fn update_event(
        ctx: Context<UpdateEvent>,
        resale_cap_bps: Option<u32>,
    ) -> Result<()> {
        instructions::update_event(ctx, resale_cap_bps)
    }

    pub fn mint_ticket<'info>(
        ctx: Context<'_, '_, '_, 'info, MintTicket<'info>>,
        proof: ValidityProof,
        address_tree_info: PackedAddressTreeInfo,
        output_state_tree_index: u8,
        owner: Pubkey,
        purchase_price: u64,
    ) -> Result<()> {
        instructions::mint_ticket(ctx, proof, address_tree_info, output_state_tree_index, owner, purchase_price)
    }

    pub fn transfer_ticket<'info>(
        ctx: Context<'_, '_, '_, 'info, TransferTicket<'info>>,
        proof: ValidityProof,
        account_meta: CompressedAccountMeta,
        address_tree_info: PackedAddressTreeInfo,
        current_ticket_id: u32,
        current_original_price: u64,
        new_owner: Pubkey,
        resale_price: Option<u64>,
    ) -> Result<()> {
        instructions::transfer_ticket(ctx, proof, account_meta, address_tree_info, current_ticket_id, current_original_price, new_owner, resale_price)
    }
}

