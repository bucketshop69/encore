import type { FC } from 'react';
import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useEncore } from '../hooks/useEncore';

interface Props {
    onClose: () => void;
    onCreated: () => void;
}

export const CreateEventModal: FC<Props> = ({ onClose, onCreated }) => {
    const { publicKey, connected } = useWallet();
    const { setVisible } = useWalletModal();
    const client = useEncore();

    const [name, setName] = useState('');
    const [location, setLocation] = useState('');
    const [description, setDescription] = useState('');
    const [date, setDate] = useState('');
    const [totalSupply, setTotalSupply] = useState('100');
    // const [pricePerTicket, setPricePerTicket] = useState('0.1'); // Price not currently in contract
    const [resaleCap, setResaleCap] = useState('150'); // percent
    const [maxPerPerson, setMaxPerPerson] = useState('5');
    
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!connected) {
            setVisible(true);
            return;
        }

        if (!client || !publicKey) return;

        setLoading(true);
        setError(null);

        try {
            const supply = parseInt(totalSupply, 10);
            const capBps = Math.floor(parseFloat(resaleCap) * 100);
            const maxTickets = parseInt(maxPerPerson, 10);
            const timestamp = Math.floor(new Date(date).getTime() / 1000);

            await client.createEvent(
                publicKey,
                name,
                location,
                description,
                supply,
                capBps,
                maxTickets,
                timestamp
            );

            onCreated();
        } catch (err) {
            console.error('Failed to create event:', err);
            setError(err instanceof Error ? err.message : 'Failed to create event');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create Event</h2>
                    <button className="btn-close" onClick={onClose}>×</button>
                </div>

                <form onSubmit={handleSubmit} className="modal-form">
                    <div className="form-group">
                        <label htmlFor="name">Event Name</label>
                        <input
                            id="name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="My Concert"
                            required
                            maxLength={64}
                        />
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label htmlFor="location">Location</label>
                            <input
                                id="location"
                                type="text"
                                value={location}
                                onChange={(e) => setLocation(e.target.value)}
                                placeholder="New York, NY"
                                required
                                maxLength={64}
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="date">Date & Time</label>
                            <input
                                id="date"
                                type="datetime-local"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label htmlFor="description">Description (URL or Text)</label>
                        <textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Event details..."
                            required
                            maxLength={200}
                        />
                    </div>

                    <div className="form-row three-col">
                        <div className="form-group">
                            <label htmlFor="supply">Total Tickets</label>
                            <input
                                id="supply"
                                type="number"
                                value={totalSupply}
                                onChange={(e) => setTotalSupply(e.target.value)}
                                min="1"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="maxPerPerson">Max / Person</label>
                            <input
                                id="maxPerPerson"
                                type="number"
                                value={maxPerPerson}
                                onChange={(e) => setMaxPerPerson(e.target.value)}
                                min="1"
                                max="255"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="resaleCap">Resale Cap (%)</label>
                             <input
                                id="resaleCap"
                                type="number"
                                value={resaleCap}
                                onChange={(e) => setResaleCap(e.target.value)}
                                min="100"
                                required
                            />
                        </div>
                    </div>

                    {error && <div className="error">{error}</div>}

                    <div className="modal-actions">
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={onClose}
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={loading}
                        >
                            {loading 
                                ? 'Creating...' 
                                : !connected 
                                    ? 'Connect & Create' 
                                    : 'Create Event'
                            }
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
