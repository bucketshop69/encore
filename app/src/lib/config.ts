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

// LocalStorage keys
export const STORAGE_KEYS = {
    TICKETS: "encore_tickets",
    WALLET: "encore_wallet",
};
