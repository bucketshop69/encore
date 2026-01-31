// Encore App Configuration

export const CONFIG = {
    // Helius devnet RPC
    RPC_URL: "https://devnet.helius-rpc.com/?api-key=89af9d38-1256-43d3-9c5a-a9aa454d0def",

    // Encore Program ID
    PROGRAM_ID: "BjapcaBemidgideMDLWX4wujtnEETZknmNyv28uXVB7V",

    // Light Protocol V2 Batch Address Tree (devnet)
    ADDRESS_TREE: "amt2kaJA14v3urZbZvnc5v2np8jqvc4Z8zDep5wbtzx",

    // Cluster
    CLUSTER: "devnet" as const,
};

// Export individual values for convenience
export const RPC_URL = CONFIG.RPC_URL;
export const PROGRAM_ID = CONFIG.PROGRAM_ID;
export const ADDRESS_TREE = CONFIG.ADDRESS_TREE;

// LocalStorage keys
export const STORAGE_KEYS = {
    TICKETS_PREFIX: "encore_tickets_",
    CLAIMS_PREFIX: "encore_claims_",
    WALLET: "encore_wallet",
};
