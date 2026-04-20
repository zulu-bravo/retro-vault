// Combobox + ComboboxMulti: type-ahead pickers that filter a known list of
// options and optionally offer a "Create 'xyz'" row when the typed value
// doesn't match anything. Behaves like JIRA's Labels picker.
import React, { useState, useRef, useEffect, useMemo } from 'react';

/**
 * Single-select combobox.
 *
 * Props:
 *   value        — selected option id (or '' / null for none)
 *   options      — [{ id, label }]
 *   onChange     — (id) => void            // '' or null to clear
 *   onCreate     — async (text) => id       // omit to disable creation
 *   placeholder  — string
 *   disabled     — bool
 *   allowClear   — bool (default true): show a × to clear
 */
export function Combobox({ value, options, onChange, onCreate, placeholder, disabled, allowClear = true }) {
    const selected = options.find(o => o.id === value) || null;
    const [inputText, setInputText] = useState(selected ? selected.label : '');
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(0);
    const [creating, setCreating] = useState(false);
    const wrapperRef = useRef(null);

    // Resync when the controlled value changes externally.
    useEffect(() => {
        setInputText(selected ? selected.label : '');
    }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

    const filtered = useMemo(() => {
        const q = inputText.trim().toLowerCase();
        if (!q) return options;
        return options.filter(o => o.label.toLowerCase().includes(q));
    }, [options, inputText]);

    const trimmed = inputText.trim();
    const exactMatch = filtered.some(o => o.label.toLowerCase() === trimmed.toLowerCase());
    const canCreate = !!onCreate && trimmed.length > 0 && !exactMatch;
    const rowCount = filtered.length + (canCreate ? 1 : 0);

    useEffect(() => {
        if (highlighted >= rowCount) setHighlighted(Math.max(0, rowCount - 1));
    }, [rowCount, highlighted]);

    function commitSelection(option) {
        onChange(option.id);
        setInputText(option.label);
        setOpen(false);
    }

    function clearSelection() {
        onChange('');
        setInputText('');
        setOpen(false);
    }

    async function commitCreate(text) {
        if (!onCreate || creating) return;
        setCreating(true);
        try {
            const id = await onCreate(text);
            if (id) {
                onChange(id);
                setInputText(text);
                setOpen(false);
            }
        } finally {
            setCreating(false);
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHighlighted(i => Math.min(rowCount - 1, i + 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlighted(i => Math.max(0, i - 1));
        } else if (e.key === 'Enter') {
            if (!open) return;
            e.preventDefault();
            if (highlighted < filtered.length) {
                commitSelection(filtered[highlighted]);
            } else if (canCreate) {
                commitCreate(trimmed);
            }
        } else if (e.key === 'Escape') {
            setOpen(false);
            setInputText(selected ? selected.label : '');
        } else if (e.key === 'Backspace' && allowClear && inputText === '' && selected) {
            clearSelection();
        }
    }

    function handleBlur() {
        // Delay so option onMouseDown can win.
        setTimeout(() => {
            setOpen(false);
            // Revert the visible text to the last committed selection if the user
            // typed something they didn't commit to.
            setInputText(selected ? selected.label : '');
        }, 150);
    }

    return (
        <div className="vault-typeahead vault-combobox" ref={wrapperRef}>
            <input
                type="text"
                className="vault-input"
                value={inputText}
                disabled={disabled}
                placeholder={placeholder}
                onChange={(e) => { setInputText(e.target.value); setOpen(true); setHighlighted(0); }}
                onFocus={() => setOpen(true)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                autoComplete="off"
            />
            {allowClear && selected && !disabled && (
                <button
                    type="button"
                    className="vault-combobox__clear"
                    onMouseDown={(e) => { e.preventDefault(); clearSelection(); }}
                    title="Clear"
                    aria-label="Clear"
                >×</button>
            )}
            {open && rowCount > 0 && (
                <div className="vault-typeahead__dropdown">
                    {filtered.map((o, i) => (
                        <div
                            key={o.id}
                            className={'vault-typeahead__option' + (i === highlighted ? ' vault-typeahead__option--highlighted' : '')}
                            onMouseDown={(e) => { e.preventDefault(); commitSelection(o); }}
                            onMouseEnter={() => setHighlighted(i)}
                        >
                            {o.label}
                        </div>
                    ))}
                    {canCreate && (
                        <div
                            className={'vault-typeahead__option vault-typeahead__option--create' + (highlighted === filtered.length ? ' vault-typeahead__option--highlighted' : '')}
                            onMouseDown={(e) => { e.preventDefault(); commitCreate(trimmed); }}
                            onMouseEnter={() => setHighlighted(filtered.length)}
                        >
                            {creating ? 'Creating…' : <>+ Create <strong>"{trimmed}"</strong></>}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Multi-select combobox. Selected items shown as chips; typing filters
 * remaining options; Enter picks the highlighted row or creates.
 *
 * Props:
 *   values      — selected option ids
 *   options     — [{ id, label }]  (full list including already-selected)
 *   onAdd       — (id) => void
 *   onRemove    — (id) => void
 *   onCreate    — async (text) => id    // omit to disable creation
 *   placeholder — string
 *   disabled    — bool
 */
export function ComboboxMulti({ values, options, onAdd, onRemove, onCreate, placeholder, disabled }) {
    const valueSet = useMemo(() => new Set(values || []), [values]);
    const selectedOptions = (values || [])
        .map(id => options.find(o => o.id === id))
        .filter(Boolean);

    const [inputText, setInputText] = useState('');
    const [open, setOpen] = useState(false);
    const [highlighted, setHighlighted] = useState(0);
    const [creating, setCreating] = useState(false);
    const inputRef = useRef(null);

    const filtered = useMemo(() => {
        const q = inputText.trim().toLowerCase();
        return options
            .filter(o => !valueSet.has(o.id))
            .filter(o => !q || o.label.toLowerCase().includes(q));
    }, [options, valueSet, inputText]);

    const trimmed = inputText.trim();
    const exactMatch = options.some(o => o.label.toLowerCase() === trimmed.toLowerCase());
    const canCreate = !!onCreate && trimmed.length > 0 && !exactMatch;
    const rowCount = filtered.length + (canCreate ? 1 : 0);

    useEffect(() => {
        if (highlighted >= rowCount) setHighlighted(Math.max(0, rowCount - 1));
    }, [rowCount, highlighted]);

    function commitAdd(option) {
        onAdd(option.id);
        setInputText('');
        setHighlighted(0);
        // Keep the dropdown open so the user can pick several in a row.
        setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
    }

    async function commitCreate(text) {
        if (!onCreate || creating) return;
        setCreating(true);
        try {
            const id = await onCreate(text);
            if (id) {
                onAdd(id);
                setInputText('');
                setHighlighted(0);
                setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
            }
        } finally {
            setCreating(false);
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setHighlighted(i => Math.min(rowCount - 1, i + 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlighted(i => Math.max(0, i - 1));
        } else if (e.key === 'Enter') {
            if (!open) return;
            e.preventDefault();
            if (highlighted < filtered.length) {
                commitAdd(filtered[highlighted]);
            } else if (canCreate) {
                commitCreate(trimmed);
            }
        } else if (e.key === 'Escape') {
            setOpen(false);
        } else if (e.key === 'Backspace' && inputText === '' && selectedOptions.length > 0) {
            onRemove(selectedOptions[selectedOptions.length - 1].id);
        }
    }

    return (
        <div className="vault-typeahead vault-combobox vault-combobox--multi">
            <div className="vault-combobox__field">
                {selectedOptions.map(o => (
                    <span key={o.id} className="vault-chip">
                        {o.label}
                        {!disabled && (
                            <button
                                type="button"
                                aria-label={`Remove ${o.label}`}
                                onMouseDown={(e) => { e.preventDefault(); onRemove(o.id); }}
                            >×</button>
                        )}
                    </span>
                ))}
                <input
                    ref={inputRef}
                    type="text"
                    className="vault-combobox__input"
                    value={inputText}
                    disabled={disabled}
                    placeholder={selectedOptions.length === 0 ? placeholder : ''}
                    onChange={(e) => { setInputText(e.target.value); setOpen(true); setHighlighted(0); }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setTimeout(() => setOpen(false), 150)}
                    onKeyDown={handleKeyDown}
                    autoComplete="off"
                />
            </div>
            {open && rowCount > 0 && (
                <div className="vault-typeahead__dropdown">
                    {filtered.map((o, i) => (
                        <div
                            key={o.id}
                            className={'vault-typeahead__option' + (i === highlighted ? ' vault-typeahead__option--highlighted' : '')}
                            onMouseDown={(e) => { e.preventDefault(); commitAdd(o); }}
                            onMouseEnter={() => setHighlighted(i)}
                        >
                            {o.label}
                        </div>
                    ))}
                    {canCreate && (
                        <div
                            className={'vault-typeahead__option vault-typeahead__option--create' + (highlighted === filtered.length ? ' vault-typeahead__option--highlighted' : '')}
                            onMouseDown={(e) => { e.preventDefault(); commitCreate(trimmed); }}
                            onMouseEnter={() => setHighlighted(filtered.length)}
                        >
                            {creating ? 'Creating…' : <>+ Create <strong>"{trimmed}"</strong></>}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
