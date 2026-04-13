// esbuild.mjs - Bundle RetroVault client code for Vault Custom Pages
import * as esbuild from 'esbuild';

await esbuild.build({
    entryPoints: ['src/index.jsx'],
    bundle: true,
    sourcemap: true,
    outdir: 'dist',
    format: 'esm',
    jsx: 'automatic',
    loader: { '.jsx': 'jsx' },
    minify: false,
    target: ['es2020']
});

console.log('Build complete: dist/index.js');
