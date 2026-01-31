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
    generateRandomSecret,
    computeCommitment,
    commitmentToHex,
    decryptSecret,
    hexToBytes
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

const DEFAULT_MINT_PRICE = 0.1 * LAMPORTS_PER_SOL;

export const EventDetail: FC = () => {
    const { eventId } = useParams<{ eventId: string }>();
    const { publicKey, connected } = useWallet();
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

            // Load my tickets from localStorage
            loadMyTickets();
        } catch (err) {
            console.error('Failed to load event:', err);
            setError('Failed to load event');
        } finally {
            setLoading(false);
        }
    }, [client, eventId]);

    const loadMyTickets = () => {
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
    };

    const saveTicket = (ticketId: number, secret: Uint8Array, commitment: Uint8Array) => {
        if (!publicKey || !eventId) return;

        const storageKey = `${STORAGE_KEYS.TICKETS_PREFIX}${publicKey.toBase58()}_${eventId}`;
        const stored = localStorage.getItem(storageKey);
        const tickets = stored ? JSON.parse(stored) : [];

        tickets.push({
            ticketId,
            secret: Array.from(secret),
            commitment: commitmentToHex(commitment),
        });

        localStorage.setItem(storageKey, JSON.stringify(tickets));
        loadMyTickets();
    };

    useEffect(() => {
        loadEvent();
    }, [loadEvent]);

    useEffect(() => {
        loadMyTickets();
    }, [publicKey, eventId]);

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
            // Generate secret and commitment
            const secret = generateRandomSecret();
            const commitment = computeCommitment(publicKey, secret);
            const ticketId = event.ticketsMinted + 1;

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
            // Generate buyer's secret and commitment
            const secret = generateRandomSecret();
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
            }));

            setSuccess(`Listing claimed! Now complete the purchase.`);
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

        setActionLoading(`complete-${listing.pubkey}`);
        setError(null);
        setSuccess(null);

        try {
            // Get stored claim info
            const claimKey = `${STORAGE_KEYS.CLAIMS_PREFIX}${publicKey.toBase58()}_${listing.pubkey}`;
            const stored = localStorage.getItem(claimKey);
            if (!stored) throw new Error('Claim info not found');

            const claimInfo = JSON.parse(stored);
            const buyerSecret = new Uint8Array(claimInfo.secret);
            const buyerCommitment = hexToBytes(claimInfo.commitment);

            // Get the listing PDA to decrypt the seller's secret
            const listingPda = new PublicKey(listing.pubkey);

            // Decrypt seller's secret using listing PDA as key
            const sellerSecret = decryptSecret(
                new Uint8Array(listing.encryptedSecret),
                listingPda.toBytes()
            );

            await client.completeSale(
                new PublicKey(eventId),
                listing.ticketId,
                new PublicKey(listing.seller),
                publicKey,
                sellerSecret,
                buyerCommitment
            );

            // Save the new ticket
            saveTicket(listing.ticketId, buyerSecret, buyerCommitment);

            // Remove claim info
            localStorage.removeItem(claimKey);

            setSuccess(`Purchase complete! Ticket #${listing.ticketId} is now yours.`);
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
                            {myTickets.map((ticket) => (
                                <div key={ticket.ticketId} className="ticket-card">
                                    <div className="ticket-info">
                                        <span className="ticket-id">Ticket #{ticket.ticketId}</span>
                                        <span className="ticket-commitment" title={ticket.commitment}>
                                            {ticket.commitment.slice(0, 8)}...
                                        </span>
                                    </div>
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
                                                <span className="badge">Your listing</span>
                                            ) : isMyClaim ? (
                                                <button
                                                    className="btn btn-primary"
                                                    onClick={() => handleCompleteSale(listing)}
                                                    disabled={actionLoading === `complete-${listing.pubkey}`}
                                                >
                                                    {actionLoading === `complete-${listing.pubkey}`
                                                        ? 'Completing...'
                                                        : 'Complete Purchase'}
                                                </button>
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
