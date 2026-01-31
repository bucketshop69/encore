import { PublicKey } from "@solana/web3.js";
import {
    createRpc,
    Rpc,
    bn,
    deriveAddressV2,
    deriveAddressSeedV2,
    PackedAccounts,
    SystemAccountMetaConfig,
} from "@lightprotocol/stateless.js";
import { sha256 } from "@noble/hashes/sha256";
import { CONFIG } from "../config";

// Singleton RPC instance
let rpc: Rpc | null = null;

/**
 * Get Light Protocol RPC client (singleton)
 */
export function getRpc(): Rpc {
    if (!rpc) {
        rpc = createRpc(CONFIG.RPC_URL, CONFIG.RPC_URL);
    }
    return rpc;
}

/**
 * Get the batch address tree public key
 */
export function getAddressTree(): PublicKey {
    return new PublicKey(CONFIG.ADDRESS_TREE);
}

/**
 * Derive ticket address from seed
 * Address = deriveAddressV2(["ticket", seed], addressTree, programId)
 */
export function deriveTicketAddress(
    seed: Uint8Array,
    programId: PublicKey
): PublicKey {
    const addressTree = getAddressTree();
    const ticketSeed = deriveAddressSeedV2([
        Buffer.from("ticket"),
        Buffer.from(seed),
    ]);
    return deriveAddressV2(ticketSeed, addressTree, programId);
}

/**
 * Derive nullifier address from secret
 * Address = deriveAddressV2(["nullifier", hash(secret)], addressTree, programId)
 */
export function deriveNullifierAddress(
    secret: Uint8Array,
    programId: PublicKey
): PublicKey {
    const addressTree = getAddressTree();
    const secretHash = sha256(secret);
    const nullifierSeed = deriveAddressSeedV2([
        Buffer.from("nullifier"),
        Buffer.from(secretHash),
    ]);
    return deriveAddressV2(nullifierSeed, addressTree, programId);
}

/**
 * Get validity proof for new addresses (CREATE operations)
 */
export async function getValidityProof(newAddresses: PublicKey[]) {
    const rpcClient = getRpc();
    const addressTree = getAddressTree();

    return rpcClient.getValidityProofV0(
        [], // No existing accounts for CREATE
        newAddresses.map((addr) => ({
            address: bn(addr.toBytes()),
            tree: addressTree,
            queue: addressTree,
        }))
    );
}

/**
 * Build packed accounts for Light Protocol CPI
 */
export async function buildPackedAccounts(programId: PublicKey) {
    const rpcClient = getRpc();
    const addressTree = getAddressTree();

    // Get state tree infos
    const stateTreeInfos = await rpcClient.getStateTreeInfos();
    const stateTreeInfo = stateTreeInfos.find((i) =>
        i.tree.toBase58().startsWith("bmt")
    );
    if (!stateTreeInfo) {
        throw new Error("No batched state tree found on devnet");
    }

    // Build packed accounts
    const config = SystemAccountMetaConfig.new(programId);
    const packed = PackedAccounts.newWithSystemAccountsV2(config);

    const addressTreeIndex = packed.insertOrGet(addressTree);
    const outputStateTreeIndex = packed.insertOrGet(stateTreeInfo.queue);

    return {
        packed,
        addressTreeIndex,
        addressQueueIndex: addressTreeIndex, // Same for V2
        outputStateTreeIndex,
    };
}

/**
 * Build address tree info for instruction
 */
export function buildAddressTreeInfo(
    rootIndex: number,
    addressTreeIndex: number
) {
    return {
        rootIndex,
        addressMerkleTreePubkeyIndex: addressTreeIndex,
        addressQueuePubkeyIndex: addressTreeIndex,
    };
}
