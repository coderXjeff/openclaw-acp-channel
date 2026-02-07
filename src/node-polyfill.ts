/**
 * Node.js polyfill for browser APIs required by acp-ts
 * This must be imported BEFORE any acp-ts imports
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Storage directory for persistent data
const STORAGE_DIR = path.join(os.homedir(), ".acp-storage");

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const STORAGE_FILE = path.join(STORAGE_DIR, "localStorage.json");

// Load existing data
function loadStorage(): Record<string, string> {
  try {
    if (fs.existsSync(STORAGE_FILE)) {
      const data = fs.readFileSync(STORAGE_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("[ACP Polyfill] Failed to load storage:", e);
  }
  return {};
}

// Save data to file
function saveStorage(data: Record<string, string>): void {
  try {
    fs.writeFileSync(STORAGE_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error("[ACP Polyfill] Failed to save storage:", e);
  }
}

// In-memory storage backed by file
let storageData = loadStorage();

// Create localStorage polyfill
const localStoragePolyfill = {
  getItem(key: string): string | null {
    return storageData[key] ?? null;
  },
  setItem(key: string, value: string): void {
    storageData[key] = value;
    saveStorage(storageData);
  },
  removeItem(key: string): void {
    delete storageData[key];
    saveStorage(storageData);
  },
  clear(): void {
    storageData = {};
    saveStorage(storageData);
  },
  key(index: number): string | null {
    const keys = Object.keys(storageData);
    return keys[index] ?? null;
  },
  get length(): number {
    return Object.keys(storageData).length;
  },
};

// Set up global window object with localStorage
if (typeof globalThis !== "undefined") {
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.localStorage = localStoragePolyfill;
  // Also set localStorage directly on globalThis for some libraries
  (globalThis as any).localStorage = localStoragePolyfill;
}

// For older Node.js versions
if (typeof global !== "undefined") {
  (global as any).window = (global as any).window || {};
  (global as any).window.localStorage = localStoragePolyfill;
  (global as any).localStorage = localStoragePolyfill;
}

console.log("[ACP Polyfill] Node.js polyfill for browser APIs initialized");
console.log("[ACP Polyfill] Storage location:", STORAGE_FILE);

export { localStoragePolyfill };
