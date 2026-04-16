// esbuild.mjs - Bundle RetroVault client code for Vault Custom Pages.
// Two entries: one per Vault Page (Boards, Insights).
import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/boards.jsx', 'src/insights.jsx'],
    bundle: true,
    sourcemap: true,
    outdir: 'dist',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.jsx': 'jsx' },
    minify: false,
    target: ['es2020']
});

console.log('Build complete: dist/boards.js, dist/insights.js');
