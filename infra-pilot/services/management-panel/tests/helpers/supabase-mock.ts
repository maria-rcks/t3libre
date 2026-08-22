type Row = Record<string, any>;
type Db = Record<string, Row[]>;

function makeResponse(data: any, error: any = null) {
  return Promise.resolve({ data, error });
}

class QueryBuilder {
  private filters: Array<[string, any]> = [];
  private pendingInsert: Row | Row[] | null = null;
  private pendingUpdate: Row | null = null;
  private isDelete = false;

  constructor(private db: Db, private table: string) {}

  select(_columns = '*') {
    return this;
  }

  insert(row: Row | Row[]) {
    this.pendingInsert = row;
    return this;
  }

  update(row: Row) {
    this.pendingUpdate = row;
    return this;
  }

  delete() {
    this.isDelete = true;
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push([column, value]);
    return this;
  }

  order(_column: string, _options?: any) {
    return this;
  }

  limit(_count: number) {
    return this;
  }

  range(_start: number, _end: number) {
    return this.execute();
  }

  single() {
    if (this.pendingInsert) {
      const rows = Array.isArray(this.pendingInsert) ? this.pendingInsert : [this.pendingInsert];
      const inserted = rows.map((row) => this.insertRow(row));
      return makeResponse(inserted[0] ?? null);
    }

    if (this.pendingUpdate) {
      const row = this.rows().find((candidate) => this.matches(candidate));
      if (!row) return makeResponse(null, { code: 'PGRST116' });
      Object.assign(row, this.pendingUpdate);
      return makeResponse(row);
    }

    const row = this.rows().find((candidate) => this.matches(candidate));
    return row ? makeResponse(row) : makeResponse(null, { code: 'PGRST116' });
  }

  then(resolve: (value: any) => void, reject?: (reason?: any) => void) {
    return this.execute().then(resolve, reject);
  }

  private execute() {
    if (this.pendingInsert) {
      const rows = Array.isArray(this.pendingInsert) ? this.pendingInsert : [this.pendingInsert];
      return makeResponse(rows.map((row) => this.insertRow(row)));
    }

    if (this.isDelete) {
      this.db[this.table] = this.rows().filter((candidate) => !this.matches(candidate));
      return makeResponse(null);
    }

    return makeResponse(this.rows().filter((candidate) => this.matches(candidate)));
  }

  private insertRow(row: Row) {
    const next = { id: row.id ?? `${this.table}-${this.rows().length + 1}`, ...row };
    this.rows().push(next);
    return next;
  }

  private rows() {
    this.db[this.table] ??= [];
    return this.db[this.table];
  }

  private matches(row: Row) {
    return this.filters.every(([column, value]) => row[column] === value);
  }
}

function makeSupabase(db: Db, users: Record<string, Row> = { token: { id: 'user-1', email: 'user@example.test' } }) {
  return {
    auth: {
      getUser: async (token: string) => ({ data: { user: users[token] ?? null }, error: users[token] ? null : { message: 'invalid' } }),
      signUp: async ({ email }: { email: string }) => ({ data: { user: { id: 'new-user', email } }, error: null }),
      signInWithPassword: async () => ({ data: { session: { access_token: 'token', refresh_token: 'refresh' } }, error: null }),
      admin: { deleteUser: async () => ({}) },
    },
    from: (table: string) => new QueryBuilder(db, table),
  } as any;
}

export { Row, Db, makeResponse, QueryBuilder, makeSupabase };
