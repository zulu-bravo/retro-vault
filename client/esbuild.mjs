// esbuild.mjs - Bundle RetroVault client code for Vault Custom Pages.
// One entry per Vault Page (Boards, Actions, Releases, Teams).
import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: [
        'src/boards.jsx',
        'src/actions.jsx',
        'src/releases.jsx',
        'src/teams.jsx',
    ],
    bundle: true,
    sourcemap: true,
    outdir: 'dist',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.jsx': 'jsx' },
    minify: false,
    target: ['es2020']
});

console.log('Build complete: dist/boards.js, dist/actions.js, dist/releases.js, dist/teams.js');
