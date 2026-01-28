#!/usr/bin/env node

// Build script for BetterNet extension
// Creates browser-specific builds from source with esbuild bundling

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { build } from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const browsers = ['chrome', 'firefox', 'edge'];
const targetBrowser = process.argv[2] || 'chrome';

if (!browsers.includes(targetBrowser)) {
  console.error(`Invalid browser: ${targetBrowser}`);
  console.error(`Supported browsers: ${browsers.join(', ')}`);
  process.exit(1);
}

const srcDir = path.join(__dirname, '..', 'src');
const distDir = path.join(__dirname, '..', 'dist', targetBrowser);

console.log(`Building ${targetBrowser} extension...`);

// Clean and create dist directory
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}
fs.mkdirSync(distDir, { recursive: true });

// Copy source files (excluding files that will be bundled)
function copyRecursive(src, dest, excludeFiles = []) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(file => {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      const relativePath = path.relative(srcDir, srcPath);
      
      // Skip files that will be bundled
      if (excludeFiles.some(exclude => relativePath === exclude || relativePath.startsWith(exclude + '/'))) {
        return;
      }
      
      copyRecursive(srcPath, destPath, excludeFiles);
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

// Copy source files (excluding background and content scripts which will be bundled)
copyRecursive(srcDir, distDir, [
  'background/background.js',
  'content/content.js'
]);

// Bundle background script
console.log('Bundling background script...');
await build({
  entryPoints: [path.join(srcDir, 'background', 'background.js')],
  bundle: true,
  outfile: path.join(distDir, 'background', 'background.js'),
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: false,
  sourcemap: false,
  logLevel: 'info'
});

// Bundle content script
console.log('Bundling content script...');
await build({
  entryPoints: [path.join(srcDir, 'content', 'content.js')],
  bundle: true,
  outfile: path.join(distDir, 'content', 'content.js'),
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  minify: false,
  sourcemap: false,
  logLevel: 'info',
  // Content scripts need to be IIFE, not ESM
  globalName: 'BetterNetContent'
});

// Copy appropriate manifest and increment version
const manifestFile = targetBrowser === 'firefox' ? 'manifest.firefox.json' : 'manifest.json';
const manifestSrc = path.join(__dirname, '..', manifestFile);
const manifestDest = path.join(distDir, 'manifest.json');

// Read and increment version for main manifest (not firefox)
if (manifestFile === 'manifest.json') {
  const manifestContent = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));
  
  // Increment patch version (3rd digit)
  const versionParts = manifestContent.version.split('.');
  if (versionParts.length >= 3) {
    const patchVersion = parseInt(versionParts[2], 10);
    versionParts[2] = (patchVersion + 1).toString();
    manifestContent.version = versionParts.join('.');
    console.log(`Version incremented: ${manifestContent.version}`);
    
    // Write updated version back to source manifest
    fs.writeFileSync(manifestSrc, JSON.stringify(manifestContent, null, 2) + '\n', 'utf8');
  }
}

// Copy manifest to dist
fs.copyFileSync(manifestSrc, manifestDest);

// Copy icons if they exist
const iconsSrc = path.join(__dirname, '..', 'icons');
if (fs.existsSync(iconsSrc)) {
  copyRecursive(iconsSrc, path.join(distDir, 'icons'));
} else {
  console.warn('Warning: icons directory not found. Creating placeholder...');
  // Create icons directory with placeholder
  const iconsDir = path.join(distDir, 'icons');
  fs.mkdirSync(iconsDir, { recursive: true });
}

console.log(`✓ Build complete: ${distDir}`);
