import React, { useState, useEffect, useRef } from 'react';
import { searchUsers } from '../api/vault';

/**
 * Type-ahead user search input.
 *
 * Props:
 *   value       — current user ID (or null)
 *   displayName — display name for the current value (or null)
 *   onChange    — (userId | null, userName | null) => void
 *   placeholder — input placeholder text
 *   autoFocus   — whether to focus on mount
 */
export default function UserTypeAhead({ value, displayName, onChange, placeholder, autoFocus }) {
    const [inputText, setInputText] = useState(displayName || '');
    const [results, setResults] = useState([]);
    const [isOpen, setIsOpen] = useState(false);
    const debounceRef = useRef(null);
    const inputRef = useRef(null);

    // Sync input text when the controlled displayName changes from outside
    useEffect(() => {
        setInputText(displayName || '');
    }, [displayName]);

    useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
        }
    }, [autoFocus]);

    function handleChange(e) {
        const text = e.target.value;
        setInputText(text);

        if (!text.trim()) {
            onChange(null, null);
            setResults([]);
            setIsOpen(false);
            return;
        }

        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(async () => {
            const users = await searchUsers(text.trim());
            setResults(users);
            setIsOpen(users.length > 0);
        }, 300);
    }

    function handleSelect(user) {
        setInputText(user.name);
        setResults([]);
        setIsOpen(false);
        onChange(user.id, user.name);
    }

    function handleKeyDown(e) {
        if (e.key === 'Escape') {
            setIsOpen(false);
            // Revert to last confirmed value
            setInputText(displayName || '');
        }
    }

    function handleBlur() {
        // Delay closing so that onMouseDown on a dropdown item can fire first
        setTimeout(() => setIsOpen(false), 150);
    }

    return (
        <div className="vault-typeahead">
            <input
                ref={inputRef}
                className="vault-input"
                type="text"
                value={inputText}
                onChange={handleChange}
                onKeyDown={handleKeyDown}
                onBlur={handleBlur}
                onFocus={() => results.length > 0 && setIsOpen(true)}
                placeholder={placeholder || 'Search users...'}
                autoComplete="off"
            />
            {isOpen && results.length > 0 && (
                <div className="vault-typeahead__dropdown">
                    {results.map(u => (
                        <div
                            key={u.id}
                            className="vault-typeahead__option"
                            onMouseDown={(e) => {
                                e.preventDefault(); // prevent blur before click
                                handleSelect(u);
                            }}
                        >
                            {u.name}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
