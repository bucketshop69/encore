import { useMemo } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { EncoreClient } from "../lib/services/encore";

/**
 * Hook to get Encore client instance
 * Works without wallet for read-only operations (fetching events/listings)
 * Wallet needed for transactions (mint, list, buy)
 */
export function useEncore(): EncoreClient | null {
    const { connection } = useConnection();
    const wallet = useAnchorWallet();

    const client = useMemo(() => {
        // Create a read-only provider if no wallet
        // This allows fetching events without connecting
        const provider = wallet
            ? new AnchorProvider(connection, wallet, { commitment: "confirmed" })
            : new AnchorProvider(
                connection,
                {
                    publicKey: null as unknown as import("@solana/web3.js").PublicKey,
                    signTransaction: async () => {
                        throw new Error("Wallet not connected");
                    },
                    signAllTransactions: async () => {
                        throw new Error("Wallet not connected");
                    },
                },
                { commitment: "confirmed" }
            );

        return new EncoreClient(provider);
    }, [connection, wallet]);

    return client;
}
