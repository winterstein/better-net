#!/usr/bin/env node

// Watch script for BetterNet extension
// Monitors source files and rebuilds on changes

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawn } from 'child_process';

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
const rootDir = path.join(__dirname, '..');

// Debounce timer
let buildTimer = null;
const DEBOUNCE_MS = 500; // Wait 500ms after last change before building

// Track if a build is in progress
let isBuilding = false;

/**
 * Execute build command
 */
function build() {
  if (isBuilding) {
    console.log('⏳ Build already in progress, skipping...');
    return;
  }

  isBuilding = true;
  console.log(`\n🔨 Rebuilding ${targetBrowser} extension...`);
  
  const buildScript = path.join(__dirname, 'build.js');
  const buildProcess = spawn('node', [buildScript, targetBrowser], {
    stdio: 'inherit',
    shell: true
  });

  buildProcess.on('close', (code) => {
    isBuilding = false;
    if (code === 0) {
      console.log(`✅ Build complete for ${targetBrowser}\n`);
    } else {
      console.error(`❌ Build failed with code ${code}\n`);
    }
  });

  buildProcess.on('error', (error) => {
    isBuilding = false;
    console.error(`❌ Build error: ${error.message}\n`);
  });
}

/**
 * Debounced build function
 */
function debouncedBuild() {
  if (buildTimer) {
    clearTimeout(buildTimer);
  }
  
  buildTimer = setTimeout(() => {
    build();
  }, DEBOUNCE_MS);
}

/**
 * Watch a directory recursively
 */
function watchDirectory(dir, relativePath = '') {
  if (!fs.existsSync(dir)) {
    console.warn(`Warning: Directory does not exist: ${dir}`);
    return;
  }

  // Watch the directory itself
  const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    
    const fullPath = path.join(dir, filename);
    const displayPath = path.join(relativePath, filename);
    
    // Ignore temporary files and common editor files
    if (filename.includes('~') || 
        filename.endsWith('.swp') || 
        filename.endsWith('.tmp') ||
        filename.startsWith('.')) {
      return;
    }

    // Check if it's a file (not a directory)
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        console.log(`📝 File changed: ${displayPath}`);
        debouncedBuild();
      } else if (stat.isDirectory()) {
        // New directory, start watching it
        watchDirectory(fullPath, displayPath);
      }
    } catch (error) {
      // File might have been deleted, that's okay
    }
  });

  watcher.on('error', (error) => {
    console.error(`Watch error: ${error.message}`);
  });

  // Recursively watch subdirectories
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(dir, entry.name);
        const subRelativePath = path.join(relativePath, entry.name);
        watchDirectory(subDir, subRelativePath);
      }
    }
  } catch (error) {
    // Ignore read errors
  }

  return watcher;
}

// Initial build
console.log(`🚀 Starting watch mode for ${targetBrowser} extension...`);
console.log(`📁 Watching: ${srcDir}`);
console.log(`💡 Press Ctrl+C to stop\n`);

build();

// Start watching
watchDirectory(srcDir, 'src');

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Stopping watch mode...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Stopping watch mode...');
  process.exit(0);
});

