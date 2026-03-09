const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'gigconnect.db');
let db = null;

// Wrapper to provide better-sqlite3-compatible API over sql.js
class DbWrapper {
  constructor(sqlDb) { this._db = sqlDb; }

  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        self._db.run(sql, params);
        const r = self._db.exec('SELECT last_insert_rowid() as id');
        const changes = self._db.getRowsModified();
        self._save();
        return { lastInsertRowid: r.length > 0 ? r[0].values[0][0] : 0, changes };
      },
      get(...params) {
        const stmt = self._db.prepare(sql);
        stmt.bind(params);
        if (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          stmt.free();
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const results = [];
        const stmt = self._db.prepare(sql);
        stmt.bind(params);
        while (stmt.step()) {
          const cols = stmt.getColumnNames();
          const vals = stmt.get();
          const row = {};
          cols.forEach((c, i) => row[c] = vals[i]);
          results.push(row);
        }
        stmt.free();
        return results;
      }
    };
  }

  exec(sql) { this._db.run(sql); this._save(); }

  _save() {
    try {
      const data = this._db.export();
      // Write to temp file first, then rename (atomic write to prevent corruption)
      const tmpPath = DB_PATH + '.tmp';
      fs.writeFileSync(tmpPath, Buffer.from(data));
      fs.renameSync(tmpPath, DB_PATH);
    } catch (e) { console.error('DB save error:', e); }
  }
}

async function initDatabase() {
  const SQL = await initSqlJs();
  let sqlDb;
  if (fs.existsSync(DB_PATH)) {
    sqlDb = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    sqlDb = new SQL.Database();
  }
  db = new DbWrapper(sqlDb);

  db._db.run('PRAGMA foreign_keys = ON');

  // Create tables (run each separately for sql.js compatibility)
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, password TEXT,
      role TEXT NOT NULL CHECK(role IN ('employer','student')), full_name TEXT NOT NULL,
      phone TEXT, avatar_url TEXT,
      oauth_provider TEXT, oauth_id TEXT,
      two_factor_secret TEXT, two_factor_enabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS employer_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL, company_name TEXT,
      company_description TEXT, industry TEXT, website TEXT, location TEXT, verified INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS student_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER UNIQUE NOT NULL, school_name TEXT NOT NULL,
      major TEXT, graduation_year INTEGER, gpa REAL, bio TEXT, skills TEXT, resume_url TEXT,
      portfolio_url TEXT, available INTEGER DEFAULT 1, total_earned REAL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS gigs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, employer_id INTEGER NOT NULL, title TEXT NOT NULL,
      description TEXT NOT NULL, category TEXT NOT NULL, skills_required TEXT, location TEXT,
      location_type TEXT DEFAULT 'remote' CHECK(location_type IN ('remote','onsite','hybrid')),
      pay_amount REAL NOT NULL, pay_type TEXT DEFAULT 'fixed' CHECK(pay_type IN ('fixed','hourly')),
      duration TEXT, deadline DATETIME,
      status TEXT DEFAULT 'open' CHECK(status IN ('open','in_progress','completed','cancelled')),
      max_applicants INTEGER DEFAULT 10, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employer_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, gig_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
      cover_letter TEXT, proposed_amount REAL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','withdrawn')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(gig_id, student_id),
      FOREIGN KEY (gig_id) REFERENCES gigs(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, gig_id INTEGER NOT NULL, employer_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL, amount REAL NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','completed','failed','refunded')),
      payment_method TEXT, transaction_ref TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (gig_id) REFERENCES gigs(id),
      FOREIGN KEY (employer_id) REFERENCES users(id),
      FOREIGN KEY (student_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT, gig_id INTEGER NOT NULL, reviewer_id INTEGER NOT NULL,
      reviewee_id INTEGER NOT NULL, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      comment TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (gig_id) REFERENCES gigs(id),
      FOREIGN KEY (reviewer_id) REFERENCES users(id),
      FOREIGN KEY (reviewee_id) REFERENCES users(id))`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL,
      message TEXT NOT NULL, type TEXT DEFAULT 'info', read INTEGER DEFAULT 0, link TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employer_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      gig_id INTEGER,
      last_message TEXT,
      last_message_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(employer_id, student_id),
      FOREIGN KEY (employer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (gig_id) REFERENCES gigs(id) ON DELETE SET NULL)`,
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gig_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      description TEXT,
      file_urls TEXT,
      status TEXT DEFAULT 'submitted' CHECK(status IN ('submitted','revision_requested','approved','rejected')),
      employer_feedback TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (gig_id) REFERENCES gigs(id) ON DELETE CASCADE,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE)`
  ];

  for (const sql of tables) {
    db._db.run(sql);
  }

  // Migrations — add columns if they don't exist (for existing DBs)
  const migrations = [
    { table: 'users', column: 'oauth_provider', sql: 'ALTER TABLE users ADD COLUMN oauth_provider TEXT' },
    { table: 'users', column: 'oauth_id', sql: 'ALTER TABLE users ADD COLUMN oauth_id TEXT' },
    { table: 'users', column: 'two_factor_secret', sql: 'ALTER TABLE users ADD COLUMN two_factor_secret TEXT' },
    { table: 'users', column: 'two_factor_enabled', sql: 'ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0' }
  ];

  for (const m of migrations) {
    try {
      const cols = db._db.exec(`PRAGMA table_info(${m.table})`);
      const colNames = cols.length ? cols[0].values.map(r => r[1]) : [];
      if (!colNames.includes(m.column)) {
        db._db.run(m.sql);
      }
    } catch (e) { /* column already exists */ }
  }

  db._save();

  return db;
}

function getDb() { return db; }

module.exports = { initDatabase, getDb };
