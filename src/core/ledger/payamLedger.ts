/**
 * PayamLedger — Append-Only Immutable Institutional Audit Trail
 * Persists to IndexedDB in browser sessions with transparent in-memory
 * fallback for Node/unit-test environments.
 */

import { payamBus } from '../bus/eventBus';
import type { LedgerEntry } from '../types';

const DB_NAME = 'payam_sovereign_ledger_v1';
const STORE_NAME = 'audit_entries';
const MAX_IN_MEMORY_ENTRIES = 250;

export class PayamLedgerStore {
  private entries: LedgerEntry[] = [];
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private getDb(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      return Promise.resolve(null);
    }
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(DB_NAME, 1);
          req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    }
    return this.dbPromise;
  }

  async hydrate(): Promise<readonly LedgerEntry[]> {
    const db = await this.getDb();
    if (!db) return this.entries;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => {
          const rows = (req.result as LedgerEntry[] | undefined) ?? [];
          rows.sort((a, b) => b.timestamp - a.timestamp);
          this.entries = rows.slice(0, MAX_IN_MEMORY_ENTRIES);
          resolve(this.entries);
        };
        req.onerror = () => resolve(this.entries);
      } catch {
        resolve(this.entries);
      }
    });
  }

  async append(entry: Omit<LedgerEntry, 'id'>): Promise<LedgerEntry> {
    const fullEntry: LedgerEntry = {
      ...entry,
      id: `LDG-${entry.timestamp.toString(36).toUpperCase()}-${Math.random()
        .toString(36)
        .slice(2, 6)
        .toUpperCase()}`,
    };

    this.entries = [fullEntry, ...this.entries].slice(0, MAX_IN_MEMORY_ENTRIES);

    payamBus.emit({
      type: 'LEDGER_COMMITTED',
      entry: fullEntry,
      timestamp: fullEntry.timestamp,
    });

    const db = await this.getDb();
    if (db) {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(fullEntry);
      } catch {
        // Non-fatal in restricted storage iframes
      }
    }

    return fullEntry;
  }

  getSnapshot(): readonly LedgerEntry[] {
    return this.entries;
  }

  exportJson(): string {
    return JSON.stringify(
      {
        system: 'Payam Sovereign',
        exportedAt: new Date().toISOString(),
        count: this.entries.length,
        entries: this.entries,
      },
      null,
      2
    );
  }
}

export const payamLedger = new PayamLedgerStore();
