import { useEffect, useState, type FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { Link } from 'react-router-dom';
import { useEncore } from '../hooks/useEncore';
import { CreateEventModal } from '../components/CreateEventModal';
import type { EventWithPubkey } from '../lib/services/encore';

interface EventData {
    pubkey: string;
    name: string;
    location: string;
    totalSupply: number;
    ticketsMinted: number;
    timestamp: number;
    authority: string;
}

export const Home: FC = () => {
    const { connected } = useWallet();
    const client = useEncore();
    const [events, setEvents] = useState<EventData[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);

    useEffect(() => {
        loadEvents();
    }, [client]);

    const loadEvents = async () => {
        if (!client) return;

        setLoading(true);
        try {
            const allEvents = await client.fetchAllEvents();
            console.log("Fetched events:", allEvents);

            const validEvents = allEvents.filter((e: any) => {
                return e.account && e.account.authority && e.account.eventName;
            }).map((e: EventWithPubkey) => ({
                pubkey: e.publicKey.toBase58(),
                name: e.account.eventName,
                location: e.account.eventLocation,
                totalSupply: e.account.maxSupply,
                ticketsMinted: e.account.ticketsMinted,
                timestamp: e.account.eventTimestamp ? Number(e.account.eventTimestamp) : 0,
                authority: e.account.authority.toBase58(),
            }));

            setEvents(validEvents);
        } catch (err) {
            console.error('Failed to load events:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleEventCreated = () => {
        setShowCreateModal(false);
        loadEvents();
    };

    return (
        <div className="container">
            <header className="header">
                <div className="logo-title">
                    <img src="/logo.png" alt="Encore Logo" className="logo" />
                    <h1>Encore</h1>
                </div>
                <p className="subtitle">Privacy-Preserving Event Tickets on Solana</p>
                <WalletMultiButton />
            </header>

            <main className="main">
                <div className="actions">
                    <button
                        className="btn btn-primary"
                        onClick={() => setShowCreateModal(true)}
                    >
                        + Create Event
                    </button>
                    <button className="btn btn-secondary" onClick={loadEvents}>
                        Refresh
                    </button>
                </div>

                {loading ? (
                    <div className="loading">Loading events...</div>
                ) : events.length === 0 ? (
                    <div className="empty">
                        <p>No events yet.</p>
                        {connected && <p>Be the first to create an event!</p>}
                    </div>
                ) : (
                    <div className="events-grid">
                        {events.map((event) => (
                            <Link
                                key={event.pubkey}
                                to={`/event/${event.pubkey}`}
                                className="event-card"
                            >
                                <div className="event-date">
                                    {new Date(event.timestamp * 1000).toLocaleDateString()}
                                </div>
                                <h3 className="event-name">{event.name}</h3>
                                <p className="event-location">{event.location}</p>
                                <div className="event-details">
                                    <span>{event.ticketsMinted} / {event.totalSupply} sold</span>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </main>

            {showCreateModal && (
                <CreateEventModal
                    onClose={() => setShowCreateModal(false)}
                    onCreated={handleEventCreated}
                />
            )}
        </div>
    );
};
