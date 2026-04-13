import React, { useEffect } from 'react';

export default function Toast({ message, type = 'info', onDismiss }) {
    useEffect(() => {
        const t = setTimeout(onDismiss, 3000);
        return () => clearTimeout(t);
    }, [onDismiss]);

    return (
        <div className={'vault-toast vault-toast--' + type}>
            {message}
        </div>
    );
}
