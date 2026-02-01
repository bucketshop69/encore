import type { FC } from 'react';
import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton, useWalletModal } from '@solana/wallet-adapter-react-ui';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN } from "@coral-xyz/anchor";
import { useEncore } from '../hooks/useEncore';
import type { ListingWithPubkey } from '../lib/services/encore';
import {
    generateMasterKey,
    deriveTicketSecret,
    computeCommitment,
    commitmentToHex,
    decryptSecret,
    hexToBytes,
} from '../lib/services/commitment';
import { STORAGE_KEYS } from '../lib/config';

interface EventData {
    name: string;
    location: string;
    maxSupply: number;
    ticketsMinted: number;
    authority: string;
}

interface ListingData {
    pubkey: string;
    eventConfig: string;
    ticketId: number;
    seller: string;
    pricePerTicket: number;
    buyer: string | null;
    buyerCommitment: number[] | null;
    encryptedSecret: number[];
    createdAt: number;
}

interface MyTicket {
    ticketId: number;
    secret: Uint8Array;
    commitment: string;
}

// Pending claim (Bob claimed but waiting for Alice to release)
interface MyClaim {
    ticketId: number;
    listingPubkey: string;
    secret: Uint8Array;
    commitment: string;
    status: 'claimed' | 'completed' | 'cancelled' | 'unknown';
}

// Listing status for a ticket
interface TicketListingStatus {
    ticketId: number;
    listingPda: string;
    status: 'active' | 'claimed' | 'completed' | 'cancelled' | null;
    isMine: boolean;  // Is current user the seller?
    buyer: string | null;
    pricePerTicket: number;
}

const DEFAULT_MINT_PRICE = 0.1 * LAMPORTS_PER_SOL;

export const EventDetail: FC = () => {
    const { eventId } = useParams<{ eventId: string }>();
    const { publicKey, connected, signMessage } = useWallet();
    const client = useEncore();

    const [event, setEvent] = useState<EventData | null>(null);
    const [listings, setListings] = useState<ListingData[]>([]);
    const [myTickets, setMyTickets] = useState<MyTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    // Resell modal state
    const [showResellModal, setShowResellModal] = useState(false);
    const [resellTicketId, setResellTicketId] = useState<number | null>(null);
    const [resellPrice, setResellPrice] = useState('');

    // Track listing status for each of my tickets
    const [ticketListingStatuses, setTicketListingStatuses] = useState<Map<number, TicketListingStatus>>(new Map());

    // Track my pending claims (as buyer)
    const [myClaims, setMyClaims] = useState<MyClaim[]>([]);

    const loadEvent = useCallback(async () => {
        if (!client || !eventId) return;

        setLoading(true);
        try {
            const eventPubkey = new PublicKey(eventId);
            const eventData = await client.fetchEvent(eventPubkey);

            if (eventData) {
                setEvent({
                    name: eventData.eventName,
                    location: eventData.eventLocation,
                    maxSupply: eventData.maxSupply,
                    ticketsMinted: eventData.ticketsMinted,
                    authority: eventData.authority.toBase58(),
                });
            }

            // Load listings for this event
            const allListings = await client.fetchActiveListings();
            const eventListings = allListings.filter(
                (l: ListingWithPubkey) => l.account.eventConfig.toBase58() === eventId
            );

            setListings(
                eventListings.map((l: ListingWithPubkey) => ({
                    pubkey: l.publicKey.toBase58(),
                    eventConfig: l.account.eventConfig.toBase58(),
                    ticketId: l.account.ticketId,
                    seller: l.account.seller.toBase58(),
                    pricePerTicket: Number(l.account.priceLamports),
                    buyer: l.account.buyer ? l.account.buyer.toBase58() : null,
                    buyerCommitment: l.account.buyerCommitment ? Array.from(l.account.buyerCommitment) : null,
                    encryptedSecret: Array.from(l.account.encryptedSecret),
                    createdAt: Number(l.account.createdAt),
                }))
            );

            // Note: loadMyTickets is called in separate useEffect after event is set
        } catch (err) {
            console.error('Failed to load event:', err);
            setError('Failed to load event');
        } finally {
            setLoading(false);
        }
    }, [client, eventId]);

    // Load tickets from localStorage
    const loadMyTickets = useCallback(() => {
        if (!publicKey || !eventId) {
            setMyTickets([]);
            return;
        }

        const storageKey = `${STORAGE_KEYS.TICKETS_PREFIX}${publicKey.toBase58()}_${eventId}`;
        const stored = localStorage.getItem(storageKey);

        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                setMyTickets(
                    parsed.map((t: { ticketId: number; secret: number[]; commitment: string }) => ({
                        ticketId: t.ticketId,
                        secret: new Uint8Array(t.secret),
                        commitment: t.commitment,
                    }))
                );
            } catch {
                setMyTickets([]);
            }
        } else {
            setMyTickets([]);
        }
    }, [publicKey, eventId]);

    // Save ticket to localStorage
    const saveTicket = (ticketId: number, secret: Uint8Array, commitment: Uint8Array) => {
        if (!publicKey || !eventId) return;

        const storageKey = `${STORAGE_KEYS.TICKETS_PREFIX}${publicKey.toBase58()}_${eventId}`;
        const stored = localStorage.getItem(storageKey);
        const tickets = stored ? JSON.parse(stored) : [];

        // Avoid duplicates
        if (!tickets.find((t: { ticketId: number }) => t.ticketId === ticketId)) {
            tickets.push({
                ticketId,
                secret: Array.from(secret),
                commitment: commitmentToHex(commitment),
            });
            localStorage.setItem(storageKey, JSON.stringify(tickets));
        }

        loadMyTickets();
    };

    // Remove ticket from localStorage
    const removeTicket = (ticketId: number) => {
        if (!publicKey || !eventId) {
            console.log('❌ removeTicket: missing publicKey or eventId');
            return;
        }

        const storageKey = `${STORAGE_KEYS.TICKETS_PREFIX}${publicKey.toBase58()}_${eventId}`;
        const stored = localStorage.getItem(storageKey);
        console.log(`🗑️ removeTicket #${ticketId}:`, { storageKey, hadData: !!stored });

        if (stored) {
            const tickets = JSON.parse(stored);
            const updated = tickets.filter((t: { ticketId: number }) => t.ticketId !== ticketId);
            console.log(`🗑️ Tickets before: ${tickets.length}, after: ${updated.length}`);
            localStorage.setItem(storageKey, JSON.stringify(updated));
        }
        loadMyTickets();
    };

    // Check listing status for each of my tickets by deriving PDA
    const checkMyTicketListings = useCallback(async () => {
        if (!client || !publicKey || myTickets.length === 0) return;

        const statuses = new Map<number, TicketListingStatus>();

        for (const ticket of myTickets) {
            try {
                // Compute commitment from our secret
                const ticketCommitment = computeCommitment(publicKey, ticket.secret);

                // Derive the listing PDA
                const listingPda = client.getListingPda(publicKey, ticketCommitment);

                // Try to fetch the listing
                const listing = await client.fetchListing(listingPda);

                if (listing) {
                    // Determine status string
                    let status: 'active' | 'claimed' | 'completed' | 'cancelled' = 'active';
                    if ('claimed' in listing.status) status = 'claimed';
                    else if ('sold' in listing.status || 'completed' in listing.status) status = 'completed';
                    else if ('cancelled' in listing.status) status = 'cancelled';

                    statuses.set(ticket.ticketId, {
                        ticketId: ticket.ticketId,
                        listingPda: listingPda.toBase58(),
                        status,
                        isMine: listing.seller.toBase58() === publicKey.toBase58(),
                        buyer: listing.buyer?.toBase58() || null,
                        pricePerTicket: Number(listing.priceLamports),
                    });
                } else {
                    // No listing exists
                    statuses.set(ticket.ticketId, {
                        ticketId: ticket.ticketId,
                        listingPda: listingPda.toBase58(),
                        status: null,
                        isMine: false,
                        buyer: null,
                        pricePerTicket: 0,
                    });
                }
            } catch (err) {
                console.error(`Failed to check listing for ticket ${ticket.ticketId}:`, err);
                // Assume no listing on error
                statuses.set(ticket.ticketId, {
                    ticketId: ticket.ticketId,
                    listingPda: '',
                    status: null,
                    isMine: false,
                    buyer: null,
                    pricePerTicket: 0,
                });
            }
        }

        setTicketListingStatuses(statuses);
    }, [client, publicKey, myTickets]);

    useEffect(() => {
        loadEvent();
    }, [loadEvent]);

    // Check listings whenever my tickets change
    useEffect(() => {
        checkMyTicketListings();
    }, [checkMyTicketListings]);

    // Check for completed claims that should be moved to my tickets
    // Also loads pending claims for display
    const checkAndLoadClaims = useCallback(async () => {
        if (!publicKey || !eventId || !client) return;

        const claimKeyPrefix = `${STORAGE_KEYS.CLAIMS_PREFIX}${publicKey.toBase58()}_`;
        const pendingClaims: MyClaim[] = [];
        let ticketsUpdated = false;

        // Iterate through local storage to find claims
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(claimKeyPrefix)) {
                try {
                    const claimData = JSON.parse(localStorage.getItem(key)!);

                    // Skip if no ticketId stored
                    if (!claimData.ticketId || !claimData.listingPubkey) continue;

                    // Fetch the actual listing status from chain
                    let listingStatus: 'claimed' | 'completed' | 'cancelled' | 'unknown' = 'unknown';
                    try {
                        const listing = await client.fetchListing(new PublicKey(claimData.listingPubkey));
                        console.log(`📋 Checking claim for ticket #${claimData.ticketId}:`, {
                            listingPubkey: claimData.listingPubkey,
                            listingExists: !!listing,
                            status: listing?.status
                        });

                        if (listing) {
                            if ('claimed' in listing.status) listingStatus = 'claimed';
                            else if ('sold' in listing.status || 'completed' in listing.status) listingStatus = 'completed';
                            else if ('cancelled' in listing.status) listingStatus = 'cancelled';
                        } else {
                            // Listing account doesn't exist (closed) - assume completed
                            listingStatus = 'completed';
                        }
                    } catch {
                        // Fetch failed - listing might be closed, assume completed
                        listingStatus = 'completed';
                    }

                    if (listingStatus === 'completed') {
                        // Sale completed! Save ticket to localStorage
                        const buyerSecret = new Uint8Array(claimData.secret);
                        const buyerCommitment = hexToBytes(claimData.commitment);

                        saveTicket(claimData.ticketId, buyerSecret, buyerCommitment);
                        localStorage.removeItem(key);
                        ticketsUpdated = true;
                        console.log(`✅ Claim converted to ticket: #${claimData.ticketId}`);
                    } else if (listingStatus === 'cancelled') {
                        // Seller cancelled - remove our claim
                        localStorage.removeItem(key);
                        console.log(`❌ Claim removed (seller cancelled): #${claimData.ticketId}`);
                    } else if (listingStatus === 'claimed') {
                        // Still pending - add to display list
                        pendingClaims.push({
                            ticketId: claimData.ticketId,
                            listingPubkey: claimData.listingPubkey,
                            secret: new Uint8Array(claimData.secret),
                            commitment: claimData.commitment,
                            status: listingStatus,
                        });
                    }
                } catch (e) {
                    console.error('Error processing claim:', e);
                }
            }
        }

        setMyClaims(pendingClaims);

        if (ticketsUpdated) {
            loadMyTickets();
        }
    }, [publicKey, eventId, client]);

    useEffect(() => {
        checkAndLoadClaims();
    }, [checkAndLoadClaims]);

    // Re-check claims when listings change (someone might have completed a sale)
    useEffect(() => {
        if (listings.length >= 0) {
            checkAndLoadClaims();
        }
    }, [listings]);

    // Load tickets when wallet or event changes
    useEffect(() => {
        loadMyTickets();
    }, [publicKey, eventId, loadMyTickets]);

    const { setVisible } = useWalletModal(); // Add this hook

    // ... existing state ...

    const handleMintTicket = async () => {
        if (!connected) {
            setVisible(true);
            return;
        }

        if (!client || !publicKey || !eventId || !event) return;

        setActionLoading('mint');
        setError(null);
        setSuccess(null);

        try {
            if (!signMessage) {
                setError('Wallet does not support message signing');
                return;
            }

            const ticketId = event.ticketsMinted + 1;

            // Generate master key (one signature) then derive ticket secret
            const masterKey = await generateMasterKey(signMessage, new PublicKey(eventId));
            const secret = deriveTicketSecret(masterKey, ticketId);
            const commitment = computeCommitment(publicKey, secret);

            // Mint the ticket
            await client.mintTicket(
                new PublicKey(eventId),
                publicKey,
                commitment,
                new BN(DEFAULT_MINT_PRICE)
            );

            // Save ticket locally
            saveTicket(ticketId, secret, commitment);

            setSuccess(`Ticket #${ticketId} minted! Your secret has been saved locally.`);

            // Reload event data
            await loadEvent();
        } catch (err) {
            console.error('Failed to mint ticket:', err);
            setError(err instanceof Error ? err.message : 'Failed to mint ticket');
        } finally {
            setActionLoading(null);
        }
    };

    const handleCreateListing = async () => {
        if (!client || !publicKey || !eventId || resellTicketId === null) return;

        const ticket = myTickets.find((t) => t.ticketId === resellTicketId);
        if (!ticket) return;

        setActionLoading('list');
        setError(null);
        setSuccess(null);

        try {
            const priceLamports = Math.floor(parseFloat(resellPrice) * LAMPORTS_PER_SOL);

            // Compute commitment from our secret
            const ticketCommitment = computeCommitment(publicKey, ticket.secret);

            await client.createListing(
                new PublicKey(eventId),
                resellTicketId,
                publicKey,
                ticketCommitment,
                ticket.secret,
                priceLamports
            );

            setSuccess(`Ticket #${resellTicketId} listed for ${resellPrice} SOL!`);
            setShowResellModal(false);
            setResellTicketId(null);
            setResellPrice('');

            // Don't remove ticket yet - seller still owns it until sale completes
            await loadEvent();
        } catch (err) {
            console.error('Failed to create listing:', err);
            setError(err instanceof Error ? err.message : 'Failed to create listing');
        } finally {
            setActionLoading(null);
        }
    };

    const handleClaimListing = async (listing: ListingData) => {
        if (!connected) {
            setVisible(true);
            return;
        }

        if (!client || !publicKey) return;

        setActionLoading(`claim-${listing.pubkey}`);
        setError(null);
        setSuccess(null);

        try {
            if (!signMessage) {
                setError('Wallet does not support message signing');
                return;
            }

            // Generate master key (one signature) then derive ticket secret
            const masterKey = await generateMasterKey(signMessage, new PublicKey(listing.eventConfig));
            const secret = deriveTicketSecret(masterKey, listing.ticketId);
            const commitment = computeCommitment(publicKey, secret);

            await client.claimListing(
                new PublicKey(listing.pubkey),
                publicKey,
                commitment
            );

            // Save the commitment info for completing the purchase
            const claimKey = `${STORAGE_KEYS.CLAIMS_PREFIX}${publicKey.toBase58()}_${listing.pubkey}`;
            localStorage.setItem(claimKey, JSON.stringify({
                secret: Array.from(secret),
                commitment: commitmentToHex(commitment),
                encryptedSecret: listing.encryptedSecret,
                listingPubkey: listing.pubkey,
                ticketId: listing.ticketId // Save ticketId so we can construct the ticket later
            }));

            setSuccess(`Listing claimed! Waiting for seller to release the ticket.`);
            await loadEvent();
        } catch (err) {
            console.error('Failed to claim listing:', err);
            setError(err instanceof Error ? err.message : 'Failed to claim listing');
        } finally {
            setActionLoading(null);
        }
    };

    const handleCompleteSale = async (listing: ListingData) => {
        if (!client || !publicKey || !eventId) return;

        if (!listing.buyerCommitment) {
            setError("Error: Buyer commitment not found on listing.");
            return;
        }

        setActionLoading(`complete-${listing.pubkey}`);
        setError(null);
        setSuccess(null);

        try {
            // Decrypt seller's secret using listing PDA as key
            const listingPda = new PublicKey(listing.pubkey);
            const sellerSecret = decryptSecret(
                new Uint8Array(listing.encryptedSecret),
                listingPda.toBytes()
            );

            const buyerCommitment = new Uint8Array(listing.buyerCommitment);

            await client.completeSale(
                new PublicKey(eventId),
                listing.ticketId,
                new PublicKey(listing.seller),
                publicKey, // Seller signs
                sellerSecret,
                buyerCommitment
            );

            console.log(`✅ completeSale succeeded for ticket #${listing.ticketId}, now removing from localStorage...`);

            // Remove ticket from seller's localStorage
            removeTicket(listing.ticketId);

            setSuccess(`Ticket released! Sale completed for Ticket #${listing.ticketId}.`);
            await loadEvent();
        } catch (err) {
            console.error('Failed to complete sale:', err);
            setError(err instanceof Error ? err.message : 'Failed to complete sale');
        } finally {
            setActionLoading(null);
        }
    };

    const handleCancelListing = async (listing: ListingData) => {
        if (!client || !publicKey) return;

        setActionLoading(`cancel-${listing.pubkey}`);
        setError(null);
        setSuccess(null);

        try {
            await client.cancelListing(
                new PublicKey(listing.pubkey),
                publicKey
            );

            setSuccess(`Listing for Ticket #${listing.ticketId} cancelled.`);
            await loadEvent();
        } catch (err) {
            console.error('Failed to cancel listing:', err);
            setError(err instanceof Error ? err.message : 'Failed to cancel listing');
        } finally {
            setActionLoading(null);
        }
    };

    // Cancel listing from My Tickets view (using ticket's listing status)
    const handleCancelMyListing = async (ticketId: number) => {
        if (!client || !publicKey) return;

        const listingStatus = ticketListingStatuses.get(ticketId);
        if (!listingStatus || !listingStatus.listingPda) return;

        setActionLoading(`cancel-ticket-${ticketId}`);
        setError(null);
        setSuccess(null);

        try {
            await client.cancelListing(
                new PublicKey(listingStatus.listingPda),
                publicKey
            );

            setSuccess(`Listing for Ticket #${ticketId} cancelled.`);
            await loadEvent();
            await checkMyTicketListings();
        } catch (err) {
            console.error('Failed to cancel listing:', err);
            setError(err instanceof Error ? err.message : 'Failed to cancel listing');
        } finally {
            setActionLoading(null);
        }
    };

    // Complete sale from My Tickets view
    const handleCompleteMyListing = async (ticketId: number) => {
        if (!client || !publicKey || !eventId) return;

        const listingStatus = ticketListingStatuses.get(ticketId);
        if (!listingStatus || !listingStatus.listingPda) return;

        const ticket = myTickets.find(t => t.ticketId === ticketId);
        if (!ticket) return;

        setActionLoading(`complete-ticket-${ticketId}`);
        setError(null);
        setSuccess(null);

        try {
            // Fetch the listing to get buyer info
            const listing = await client.fetchListing(new PublicKey(listingStatus.listingPda));
            if (!listing || !listing.buyerCommitment) {
                setError('Listing not found or not claimed yet');
                return;
            }

            // Decrypt seller's secret using listing PDA as key
            const listingPda = new PublicKey(listingStatus.listingPda);
            const sellerSecret = decryptSecret(
                new Uint8Array(listing.encryptedSecret),
                listingPda.toBytes()
            );

            const buyerCommitment = new Uint8Array(listing.buyerCommitment);

            await client.completeSale(
                new PublicKey(eventId),
                ticketId,
                listing.seller,
                publicKey, // Seller signs
                sellerSecret,
                buyerCommitment
            );

            // Remove ticket from seller's localStorage
            removeTicket(ticketId);

            setSuccess(`Ticket #${ticketId} sold! Ticket released to buyer.`);
            await loadEvent();
        } catch (err) {
            console.error('Failed to complete sale:', err);
            setError(err instanceof Error ? err.message : 'Failed to complete sale');
        } finally {
            setActionLoading(null);
        }
    };

    if (loading) {
        return (
            <div className="container">
                <header className="header">
                    <Link to="/" className="back-link">← Back</Link>
                    <WalletMultiButton />
                </header>
                <div className="loading">Loading event...</div>
            </div>
        );
    }

    if (!event) {
        return (
            <div className="container">
                <header className="header">
                    <Link to="/" className="back-link">← Back</Link>
                    <WalletMultiButton />
                </header>
                <div className="error">Event not found</div>
            </div>
        );
    }

    const soldOut = event.ticketsMinted >= event.maxSupply;
    const isAuthority = publicKey?.toBase58() === event.authority;

    return (
        <div className="container">
            <header className="header">
                <Link to="/" className="back-link">← Back</Link>
                <WalletMultiButton />
            </header>

            <main className="main">
                {/* Event Info - The Big Card */}
                <section className="event-hero">
                    <div className="event-location-large">{event.location}</div>
                    <h1>{event.name}</h1>
                    <div className="event-stats">
                        <div className="stat">
                            <span className="stat-value">{event.ticketsMinted}/{event.maxSupply}</span>
                            <span className="stat-label">Sold</span>
                        </div>
                        <div className="stat">
                            <span className="stat-value">{(DEFAULT_MINT_PRICE / LAMPORTS_PER_SOL).toFixed(2)}</span>
                            <span className="stat-label">SOL</span>
                        </div>
                    </div>

                    {!soldOut && (
                        <div style={{ marginTop: '2rem' }}>
                            <button
                                className="btn btn-primary btn-large"
                                onClick={handleMintTicket}
                                disabled={actionLoading === 'mint'}
                            >
                                {actionLoading === 'mint'
                                    ? 'Minting...'
                                    : !connected
                                        ? 'Connect & Buy Ticket'
                                        : 'Buy Ticket'
                                }
                            </button>
                        </div>
                    )}

                    {isAuthority && <div style={{ marginTop: '1rem' }}><span className="badge">You're the organizer</span></div>}
                </section>

                {/* Messages */}
                {error && <div className="alert alert-error">{error}</div>}
                {success && <div className="alert alert-success">{success}</div>}

                {soldOut && (
                    <section className="section">
                        <h2>🎟️ Sold Out!</h2>
                        <p>Check the marketplace below for resale tickets.</p>
                    </section>
                )}

                {/* My Tickets */}
                {connected && myTickets.length > 0 && (
                    <section className="section">
                        <h2>🎫 My Tickets ({myTickets.length})</h2>
                        <div className="tickets-list">
                            {myTickets.map((ticket) => {
                                const listingStatus = ticketListingStatuses.get(ticket.ticketId);
                                const isListed = listingStatus?.status === 'active';
                                const isClaimed = listingStatus?.status === 'claimed';
                                const isCancelled = listingStatus?.status === 'cancelled';

                                return (
                                    <div key={ticket.ticketId} className="ticket-card">
                                        <div className="ticket-info">
                                            <span className="ticket-id">Ticket #{ticket.ticketId}</span>
                                            <span className="ticket-commitment" title={ticket.commitment}>
                                                {ticket.commitment.slice(0, 8)}...
                                            </span>
                                            {isListed && (
                                                <span className="badge badge-listed">
                                                    Listed for {(listingStatus!.pricePerTicket / LAMPORTS_PER_SOL).toFixed(2)} SOL
                                                </span>
                                            )}
                                            {isClaimed && (
                                                <span className="badge badge-claimed">
                                                    Claimed - Ready to release
                                                </span>
                                            )}
                                            {isCancelled && (
                                                <span className="badge badge-cancelled">
                                                    Cancelled (needs cleanup)
                                                </span>
                                            )}
                                        </div>
                                        <div className="ticket-actions">
                                            {/* No listing or cancelled zombie - can list */}
                                            {(!listingStatus?.status || isCancelled) && (
                                                <button
                                                    className="btn btn-secondary"
                                                    onClick={() => {
                                                        setResellTicketId(ticket.ticketId);
                                                        setResellPrice((DEFAULT_MINT_PRICE / LAMPORTS_PER_SOL).toFixed(2));
                                                        setShowResellModal(true);
                                                    }}
                                                >
                                                    List for Sale
                                                </button>
                                            )}
                                            {/* Listed but not claimed - can cancel */}
                                            {isListed && (
                                                <button
                                                    className="btn btn-secondary"
                                                    onClick={() => handleCancelMyListing(ticket.ticketId)}
                                                    disabled={actionLoading === `cancel-ticket-${ticket.ticketId}`}
                                                >
                                                    {actionLoading === `cancel-ticket-${ticket.ticketId}`
                                                        ? 'Cancelling...'
                                                        : 'Cancel Listing'}
                                                </button>
                                            )}
                                            {/* Claimed - seller should release */}
                                            {isClaimed && (
                                                <button
                                                    className="btn btn-primary"
                                                    onClick={() => handleCompleteMyListing(ticket.ticketId)}
                                                    disabled={actionLoading === `complete-ticket-${ticket.ticketId}`}
                                                >
                                                    {actionLoading === `complete-ticket-${ticket.ticketId}`
                                                        ? 'Releasing...'
                                                        : 'Release Ticket'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* My Pending Claims (as Buyer) */}
                {connected && myClaims.length > 0 && (
                    <section className="section">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2>⏳ Pending Purchases ({myClaims.length})</h2>
                            <button
                                className="btn btn-secondary"
                                onClick={async () => {
                                    setActionLoading('refresh-claims');
                                    await checkAndLoadClaims();
                                    setActionLoading(null);
                                }}
                                disabled={actionLoading === 'refresh-claims'}
                            >
                                {actionLoading === 'refresh-claims' ? 'Checking...' : '🔄 Check Status'}
                            </button>
                        </div>
                        <div className="tickets-list">
                            {myClaims.map((claim) => (
                                <div key={claim.listingPubkey} className="ticket-card">
                                    <div className="ticket-info">
                                        <span className="ticket-id">Ticket #{claim.ticketId}</span>
                                        <span className="badge badge-pending">
                                            Waiting for seller to release
                                        </span>
                                    </div>
                                    <div className="ticket-actions">
                                        <button
                                            className="btn btn-secondary"
                                            onClick={async () => {
                                                if (!client || !publicKey) return;
                                                setActionLoading(`cancel-claim-${claim.listingPubkey}`);
                                                try {
                                                    await client.cancelClaim(
                                                        new PublicKey(claim.listingPubkey),
                                                        publicKey
                                                    );
                                                    // Remove from localStorage
                                                    const claimKey = `${STORAGE_KEYS.CLAIMS_PREFIX}${publicKey.toBase58()}_${claim.listingPubkey}`;
                                                    localStorage.removeItem(claimKey);
                                                    setSuccess('Claim cancelled');
                                                    await loadEvent();
                                                    await checkAndLoadClaims();
                                                } catch (err) {
                                                    setError(err instanceof Error ? err.message : 'Failed to cancel claim');
                                                } finally {
                                                    setActionLoading(null);
                                                }
                                            }}
                                            disabled={actionLoading === `cancel-claim-${claim.listingPubkey}`}
                                        >
                                            {actionLoading === `cancel-claim-${claim.listingPubkey}`
                                                ? 'Cancelling...'
                                                : 'Cancel Claim'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Marketplace Listings - Always visible */}
                <section className="section">
                    <h2>🏪 Marketplace ({listings.length} listings)</h2>
                    {listings.length === 0 ? (
                        <p className="empty">No tickets for sale right now.</p>
                    ) : (
                        <div className="listings-list">
                            {listings.map((listing) => {
                                const isMyClaim = connected && listing.buyer === publicKey?.toBase58();
                                const isClaimed = listing.buyer !== null;
                                const isMine = connected && listing.seller === publicKey?.toBase58();

                                return (
                                    <div key={listing.pubkey} className="listing-card">
                                        <div className="listing-info">
                                            <span className="ticket-id">Ticket #{listing.ticketId}</span>
                                            <span className="listing-price">
                                                {(listing.pricePerTicket / LAMPORTS_PER_SOL).toFixed(2)} SOL
                                            </span>
                                            <span className="listing-seller">
                                                Seller: {listing.seller.slice(0, 4)}...{listing.seller.slice(-4)}
                                            </span>
                                            {isClaimed && (
                                                <span className="badge badge-claimed">
                                                    {isMyClaim ? 'You claimed' : 'Claimed'}
                                                </span>
                                            )}
                                        </div>
                                        <div className="listing-actions">
                                            {isMine ? (
                                                !isClaimed ? (
                                                    <button
                                                        className="btn btn-secondary"
                                                        onClick={() => handleCancelListing(listing)}
                                                        disabled={actionLoading === `cancel-${listing.pubkey}`}
                                                    >
                                                        {actionLoading === `cancel-${listing.pubkey}`
                                                            ? 'Cancelling...'
                                                            : 'Cancel Listing'}
                                                    </button>
                                                ) : (
                                                    <button
                                                        className="btn btn-primary"
                                                        onClick={() => handleCompleteSale(listing)}
                                                        disabled={actionLoading === `complete-${listing.pubkey}`}
                                                    >
                                                        {actionLoading === `complete-${listing.pubkey}`
                                                            ? 'Releasing...'
                                                            : 'Release Ticket'}
                                                    </button>
                                                )
                                            ) : isMyClaim ? (
                                                <span className="badge badge-pending">Awaiting seller release</span>
                                            ) : !isClaimed ? (
                                                <button
                                                    className="btn btn-primary"
                                                    onClick={() => handleClaimListing(listing)}
                                                    disabled={actionLoading === `claim-${listing.pubkey}`}
                                                >
                                                    {actionLoading === `claim-${listing.pubkey}`
                                                        ? 'Claiming...'
                                                        : !connected
                                                            ? 'Connect & Buy'
                                                            : 'Buy'
                                                    }
                                                </button>
                                            ) : (
                                                <span className="badge badge-pending">Pending sale</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </section>
            </main>

            {/* Resell Modal */}
            {showResellModal && resellTicketId !== null && (
                <div className="modal-overlay" onClick={() => setShowResellModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>List Ticket #{resellTicketId} for Sale</h2>
                            <button className="btn-close" onClick={() => setShowResellModal(false)}>×</button>
                        </div>
                        <div className="modal-form">
                            <div className="form-group">
                                <label htmlFor="resellPrice">Sale Price (SOL)</label>
                                <input
                                    id="resellPrice"
                                    type="number"
                                    value={resellPrice}
                                    onChange={(e) => setResellPrice(e.target.value)}
                                    min="0"
                                    step="0.01"
                                />
                            </div>
                            <div className="modal-actions">
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setShowResellModal(false)}
                                    disabled={actionLoading === 'list'}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="btn btn-primary"
                                    onClick={handleCreateListing}
                                    disabled={actionLoading === 'list' || !resellPrice}
                                >
                                    {actionLoading === 'list' ? 'Creating...' : 'List for Sale'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
