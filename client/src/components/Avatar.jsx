// Avatar — circular user image with initials fallback.
// Pulls the image URL from a user-id -> imageUrl cache populated by
// loadUserImages() in vault.js. Falls back to coloured initials when no
// image is available or the image fails to load.
import React, { useEffect, useState } from 'react';
import { loadUserImages, fetchUserImageBlobUrl } from '../api/vault';

const PALETTE = [
    '#6B46C1', '#0D9488', '#BE185D', '#4C51BF',
    '#92400E', '#4B5563', '#0E7490', '#7C3AED',
];

function hashColor(seed) {
    if (!seed) return PALETTE[0];
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
}

function initialsOf(name) {
    if (!name) return '?';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const sizeMap = {
    xs: 18, sm: 24, md: 32, lg: 44, xl: 64,
};

/**
 * <Avatar userId="123" name="Zied Belkhodja" size="md" />
 *
 * Props:
 *   userId  — Vault user__sys id (string or number); used to look up the cached image
 *   name    — display name; used for initials and the deterministic colour
 *   size    — "xs" | "sm" | "md" | "lg" | "xl" or a number (pixels)
 *   title   — tooltip (defaults to name)
 */
export default function Avatar({ userId, name, size = 'md', title }) {
    const [imageUrl, setImageUrl] = useState(null);
    const [errored, setErrored] = useState(false);

    const isUnassigned = !userId || String(userId).startsWith('__');

    useEffect(() => {
        let cancelled = false;
        if (isUnassigned) {
            setImageUrl(null);
            return;
        }
        (async () => {
            const map = await loadUserImages();
            if (cancelled) return;
            const mediaId = map.get(String(userId));
            if (!mediaId) {
                setImageUrl(null);
                return;
            }
            const url = await fetchUserImageBlobUrl(mediaId);
            if (!cancelled) setImageUrl(url);
        })();
        return () => { cancelled = true; };
    }, [userId, isUnassigned]);

    const px = typeof size === 'number' ? size : (sizeMap[size] || sizeMap.md);
    const showImage = imageUrl && !errored;

    const style = {
        width: px,
        height: px,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        overflow: 'hidden',
        verticalAlign: 'middle',
    };

    if (isUnassigned) {
        const fontSize = Math.max(11, Math.round(px * 0.55));
        return (
            <span
                className="vault-avatar vault-avatar--unassigned"
                title={title || name || 'Unassigned'}
                style={{
                    ...style,
                    background: 'var(--vault-silver-light, #eee)',
                    fontSize,
                    lineHeight: 1,
                    userSelect: 'none',
                }}
                aria-label={name || 'Unassigned'}
            >
                🤖
            </span>
        );
    }

    if (showImage) {
        return (
            <img
                src={imageUrl}
                alt={name || 'User'}
                title={title || name || ''}
                style={style}
                onError={() => setErrored(true)}
            />
        );
    }

    const bg = hashColor(name || String(userId || ''));
    const fontSize = Math.max(9, Math.round(px * 0.4));
    return (
        <span
            className="vault-avatar vault-avatar--initials"
            title={title || name || ''}
            style={{
                ...style,
                background: bg,
                color: 'white',
                fontSize,
                fontWeight: 600,
                lineHeight: 1,
                userSelect: 'none',
            }}
            aria-label={name || 'User'}
        >
            {initialsOf(name)}
        </span>
    );
}
