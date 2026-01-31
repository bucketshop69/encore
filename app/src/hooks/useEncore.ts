import { useMemo } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { EncoreClient } from "../lib/services/encore";

/**
 * Hook to get Encore client instance
 * Returns null if wallet not connected
 */
export function useEncore(): EncoreClient | null {
    const { connection } = useConnection();
    const wallet = useAnchorWallet();

    const client = useMemo(() => {
        if (!wallet) return null;

        const provider = new AnchorProvider(connection, wallet, {
            commitment: "confirmed",
        });

        return new EncoreClient(provider);
    }, [connection, wallet]);

    return client;
}
