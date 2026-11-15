// Local-first row store with an outbox, shared by web and iPhone.
// Rows live in memory + a persisted snapshot. Every local write bumps updated_at and queues the row.
// When a Supabase session is attached, the outbox is pushed, changes are pulled incrementally,
// and realtime events from the other device are merged (newer updated_at wins, same rule as the DB trigger).
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

export type TableName =
  | 'profiles' | 'days' | 'meal_entries' | 'weights' | 'workouts' | 'checklist'
  | 'foods' | 'events' | 'memories' | 'plan_adjustments' | 'plans' | 'runs';

export const TABLES: TableName[] = ['profiles', 'days', 'meal_entries', 'weights', 'workouts', 'checklist', 'foods', 'events', 'memories', 'plan_adjustments', 'plans', 'runs'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any> & { updated_at?: string; deleted_at?: string | null };

/** Local primary key per table (user_id is implied). */
export const pkOf = (t: TableName, r: Row): string => {
  switch (t) {
    case 'profiles': return 'me';
    case 'days':
    case 'weights': return String(r.date);
    case 'checklist': return `${r.list}:${r.item_key}`;
    default: return String(r.id);
  }
};

const CONFLICT: Record<TableName, string> = {
  profiles: 'user_id', days: 'user_id,date', weights: 'user_id,date', checklist: 'user_id,list,item_key',
  meal_entries: 'id', workouts: 'id', foods: 'id', events: 'id', memories: 'id', plan_adjustments: 'id', plans: 'id', runs: 'id',
};

export interface Persistence {
  load(): Promise<string | null>;
  save(json: string): Promise<void>;
}

interface Snapshot {
  v: 1;
  tables: Record<TableName, Record<string, Row>>;
  outbox: { t: TableName; pk: string; at: string }[];
  cursors: Partial<Record<TableName, string>>;
}

export type SyncState = 'local' | 'syncing' | 'synced' | 'offline' | 'error';

const emptySnapshot = (): Snapshot => ({
  v: 1,
  tables: Object.fromEntries(TABLES.map((t) => [t, {}])) as Snapshot['tables'],
  outbox: [],
  cursors: {},
});

const newer = (a?: string, b?: string): boolean => (a ?? '') > (b ?? '');

export class DataStore {
  private s: Snapshot = emptySnapshot();
  private listeners = new Set<() => void>();
  private version = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private client: SupabaseClient | null = null;
  private userId: string | null = null;
  private channel: RealtimeChannel | null = null;
  private lastStamp = 0;
  syncState: SyncState = 'local';
  lastError: string | null = null;

  constructor(private persist: Persistence) {}

  async init(): Promise<void> {
    try {
      const raw = await this.persist.load();
      if (raw) {
        const parsed = JSON.parse(raw) as Snapshot;
        if (parsed?.v === 1) {
          this.s = { ...emptySnapshot(), ...parsed, tables: { ...emptySnapshot().tables, ...parsed.tables } };
        }
      }
    } catch {
      this.s = emptySnapshot();
    }
    this.emit();
  }

  // ---------- subscription (useSyncExternalStore) ----------
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  getVersion = (): number => this.version;
  private emit() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  // ---------- reads ----------
  get<T extends Row>(t: TableName, pk: string): T | undefined {
    const r = this.s.tables[t][pk] as T | undefined;
    return r && !r.deleted_at ? r : undefined;
  }
  all<T extends Row>(t: TableName): T[] {
    return Object.values(this.s.tables[t]).filter((r) => !r.deleted_at) as T[];
  }
  where<T extends Row>(t: TableName, pred: (r: T) => boolean): T[] {
    return this.all<T>(t).filter(pred);
  }
  pendingCount(): number {
    return this.s.outbox.length;
  }

  // ---------- writes ----------
  private stamp(prev?: string): string {
    const prevMs = prev ? Date.parse(prev) : 0;
    const ms = Math.max(Date.now(), prevMs + 1, this.lastStamp + 1);
    this.lastStamp = ms;
    return new Date(ms).toISOString();
  }

  /** Insert or merge a row. Returns the stored row. */
  put<T extends Row>(t: TableName, patch: Partial<T> & Row): T {
    const pk = pkOf(t, patch);
    const prev = this.s.tables[t][pk];
    const row = { ...(prev && !prev.deleted_at ? prev : {}), ...patch, deleted_at: patch.deleted_at ?? null } as T;
    row.updated_at = this.stamp(prev?.updated_at);
    this.s.tables[t][pk] = row;
    this.s.outbox = this.s.outbox.filter((o) => !(o.t === t && o.pk === pk));
    this.s.outbox.push({ t, pk, at: row.updated_at! });
    this.changed();
    return row;
  }

  /** Soft delete (synced as deleted_at). */
  remove(t: TableName, pk: string): void {
    const prev = this.s.tables[t][pk];
    if (!prev || prev.deleted_at) return;
    const row = { ...prev, deleted_at: new Date().toISOString() };
    row.updated_at = this.stamp(prev.updated_at);
    this.s.tables[t][pk] = row;
    this.s.outbox = this.s.outbox.filter((o) => !(o.t === t && o.pk === pk));
    this.s.outbox.push({ t, pk, at: row.updated_at! });
    this.changed();
  }

  /** Write many rows in one go (imports). */
  putMany(t: TableName, rows: Row[]): void {
    for (const r of rows) {
      const pk = pkOf(t, r);
      const prev = this.s.tables[t][pk];
      const row = { ...r, updated_at: this.stamp(prev?.updated_at) };
      this.s.tables[t][pk] = row;
      this.s.outbox = this.s.outbox.filter((o) => !(o.t === t && o.pk === pk));
      this.s.outbox.push({ t, pk, at: row.updated_at });
    }
    this.changed();
  }

  private changed() {
    this.emit();
    this.scheduleSave();
    this.schedulePush();
  }

  private scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { void this.persist.save(JSON.stringify(this.s)); }, 150);
  }

  /** Flush the snapshot now (call on app background / page hide). */
  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    await this.persist.save(JSON.stringify(this.s));
  }

  // ---------- remote merge ----------
  /** Merge a row from the server. Local unsynced edits that are newer win. */
  applyRemote(t: TableName, row: Row): boolean {
    const pk = pkOf(t, row);
    const local = this.s.tables[t][pk];
    if (local && !newer(row.updated_at, local.updated_at)) return false;
    this.s.tables[t][pk] = row;
    return true;
  }

  // ---------- sync ----------
  private setSync(state: SyncState, err: string | null = null) {
    this.syncState = state;
    this.lastError = err;
    this.emit();
  }

  /** Signed-in user id, or null while the data lives only on this device. */
  get currentUserId(): string | null {
    return this.userId;
  }

  async attach(client: SupabaseClient, userId: string): Promise<void> {
    this.detach();
    this.client = client;
    this.userId = userId;
    this.setSync('syncing');
    try {
      await this.push();
      await this.pull();
      this.channel = client
        .channel(`sync-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
          const t = payload.table as TableName;
          if (!TABLES.includes(t) || !payload.new || typeof payload.new !== 'object') return;
          if (this.applyRemote(t, payload.new as Row)) { this.emit(); this.scheduleSave(); }
        })
        .subscribe();
      this.setSync('synced');
    } catch (e) {
      this.setSync('error', e instanceof Error ? e.message : String(e));
    }
  }

  detach(): void {
    if (this.channel && this.client) void this.client.removeChannel(this.channel);
    this.channel = null;
    this.client = null;
    this.userId = null;
    if (this.syncState !== 'local') this.setSync('local');
  }

  private schedulePush() {
    if (!this.client) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      this.push().then(
        () => this.setSync('synced'),
        (e) => this.setSync('offline', e instanceof Error ? e.message : String(e)),
      );
    }, 400);
  }

  /** Push queued rows, grouped per table. Rows edited again during the push stay queued. */
  async push(): Promise<void> {
    const client = this.client;
    const uid = this.userId;
    if (!client || !uid || !this.s.outbox.length) return;
    const batch = [...this.s.outbox];
    const byTable = new Map<TableName, Row[]>();
    for (const o of batch) {
      const row = this.s.tables[o.t][o.pk];
      if (!row) continue;
      const list = byTable.get(o.t) ?? [];
      list.push({ ...row, user_id: uid });
      byTable.set(o.t, list);
    }
    // parents first, so foreign keys hold inside one push (workouts.run_id -> runs, meal_entries.food_id -> foods)
    const parentFirst = (t: TableName) => (t === 'runs' || t === 'foods' ? 0 : 1);
    for (const [t, rows] of [...byTable].sort((a, b) => parentFirst(a[0]) - parentFirst(b[0]))) {
      const { error } = await client.from(t).upsert(rows, { onConflict: CONFLICT[t] });
      if (error) throw new Error(`${t}: ${error.message}`);
    }
    const sent = new Set(batch.map((o) => `${o.t}|${o.pk}|${o.at}`));
    this.s.outbox = this.s.outbox.filter((o) => !sent.has(`${o.t}|${o.pk}|${o.at}`));
    this.scheduleSave();
  }

  /** Push pending rows and pull anything newer: pull-to-refresh and coming back to the foreground. */
  async refresh(): Promise<void> {
    if (!this.client) return;
    this.setSync('syncing');
    try {
      await this.push();
      await this.pull();
      this.setSync('synced');
    } catch (e) {
      this.setSync('offline', e instanceof Error ? e.message : String(e));
    }
  }

  /** Pull rows changed since the last cursor for every table. */
  async pull(): Promise<void> {
    const client = this.client;
    if (!client) return;
    let touched = false;
    for (const t of TABLES) {
      let cursor = this.s.cursors[t] ?? '1970-01-01T00:00:00Z';
      for (;;) {
        const { data, error } = await client.from(t).select('*').gt('updated_at', cursor).order('updated_at', { ascending: true }).limit(1000);
        if (error) throw new Error(`${t}: ${error.message}`);
        if (!data?.length) break;
        for (const r of data as Row[]) if (this.applyRemote(t, r)) touched = true;
        cursor = (data[data.length - 1] as Row).updated_at ?? cursor;
        this.s.cursors[t] = cursor;
        if (data.length < 1000) break;
      }
    }
    if (touched) this.emit();
    this.scheduleSave();
  }
}
