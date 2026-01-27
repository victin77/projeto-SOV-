const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

function shouldUseSsl() {
  if (process.env.PGSSL === '0' || process.env.PGSSL === 'false') return false;
  if (process.env.PGSSL === '1' || process.env.PGSSL === 'true') return true;
  return process.env.NODE_ENV === 'production';
}

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL não definido (necessário para Postgres).');
  }

  const ssl = shouldUseSsl() ? { rejectUnauthorized: false } : false;
  return new Pool({ connectionString, ssl, max: 10 });
}

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      username TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      pass_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      origin TEXT NOT NULL,
      value DOUBLE PRECISION NOT NULL DEFAULT 0,
      next_step TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL DEFAULT 'Novo lead',
      tasks JSONB NOT NULL DEFAULT '[]'::jsonb,
      loss_reason TEXT NOT NULL DEFAULT '',
      obs TEXT NOT NULL DEFAULT '',
      owner TEXT NOT NULL DEFAULT '',
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL,
      deleted BOOLEAN NOT NULL DEFAULT FALSE,
      last_modified_by TEXT NOT NULL DEFAULT ''
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit (
      id UUID PRIMARY KEY,
      at BIGINT NOT NULL,
      actor TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS leads_deleted_idx ON leads(deleted);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads(created_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS audit_at_idx ON audit(at);`);
}

function rowToLead(row) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    origin: row.origin,
    value: Number(row.value) || 0,
    nextStep: row.next_step,
    stage: row.stage,
    tasks: row.tasks || [],
    lossReason: row.loss_reason,
    obs: row.obs,
    owner: row.owner,
    tags: row.tags || [],
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
    deleted: !!row.deleted,
    lastModifiedBy: row.last_modified_by
  };
}

function rowToAudit(row) {
  return {
    id: row.id,
    at: Number(row.at) || 0,
    actor: row.actor,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id ?? undefined
  };
}

function getSeedMode() {
  const allowDefaultSeed = process.env.SOV_ALLOW_DEFAULT_SEED === '1';
  const isProd = process.env.NODE_ENV === 'production';
  return { allowDefaultSeed, isProd };
}

function getDefaultSeedUsers() {
  return [
    { user: 'admin', pass: 'admin123', role: 'admin' },
    { user: 'grazielle', pass: 'grazielle123', role: 'consultor' },
    { user: 'pedro', pass: 'pedro123', role: 'consultor' },
    { user: 'poli', pass: 'poli123', role: 'consultor' },
    { user: 'gustavo', pass: 'gustavo123', role: 'consultor' },
    { user: 'victor', pass: 'victor123', role: 'consultor' },
    { user: 'marcelo', pass: 'marcelo123', role: 'consultor' }
  ];
}

async function createUser(client, { user, role, pass }) {
  const passHash = bcrypt.hashSync(String(pass), 10);
  await client.query(
    `INSERT INTO users (username, role, pass_hash, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO NOTHING`,
    [user, role, passHash, Date.now()]
  );
}

async function ensureUsersSeededPg(pool) {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS c FROM users`);
  const count = rows && rows[0] ? rows[0].c : 0;
  if (count > 0) return;

  const { allowDefaultSeed, isProd } = getSeedMode();
  const bootstrapUser = (process.env.SOV_BOOTSTRAP_ADMIN_USER || 'admin').trim().toLowerCase();
  const bootstrapPass = process.env.SOV_BOOTSTRAP_ADMIN_PASS;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (bootstrapPass) {
      await createUser(client, { user: bootstrapUser, role: 'admin', pass: bootstrapPass });
      await client.query('COMMIT');
      return;
    }

    if (allowDefaultSeed || !isProd) {
      const seed = getDefaultSeedUsers();
      for (const u of seed) {
        // eslint-disable-next-line no-await-in-loop
        await createUser(client, u);
      }
      await client.query('COMMIT');
      return;
    }

    const tempPass = crypto.randomBytes(12).toString('base64url');
    await createUser(client, { user: bootstrapUser, role: 'admin', pass: tempPass });
    await client.query('COMMIT');

    // eslint-disable-next-line no-console
    console.log(`[BOOTSTRAP] Admin criado: ${bootstrapUser}`);
    // eslint-disable-next-line no-console
    console.log(`[BOOTSTRAP] Senha temporária: ${tempPass}`);
    // eslint-disable-next-line no-console
    console.log('[BOOTSTRAP] Defina SOV_BOOTSTRAP_ADMIN_PASS para fixar uma senha e crie usuários no app.');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

function createPgStore() {
  const pool = createPool();
  let initialized = false;

  async function init() {
    if (initialized) return;
    await ensureSchema(pool);
    initialized = true;
  }

  return {
    kind: 'pg',
    async init() {
      await init();
    },
    async ensureUsersSeeded() {
      await init();
      await ensureUsersSeededPg(pool);
    },
    async getUser(username) {
      await init();
      const { rows } = await pool.query(
        `SELECT username AS user, role, pass_hash AS "passHash"
         FROM users
         WHERE username = $1`,
        [username]
      );
      return rows[0] || null;
    },
    async addAudit(entry) {
      await init();
      const id = crypto.randomUUID();
      const at = Date.now();
      await pool.query(
        `INSERT INTO audit (id, at, actor, action, entity_type, entity_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, at, entry.actor || '', entry.action || '', entry.entityType || '', entry.entityId || null]
      );
      await pool.query(
        `DELETE FROM audit
         WHERE id IN (
           SELECT id FROM audit
           ORDER BY at DESC
           OFFSET 2000
         )`
      );
    },
    async listLeads() {
      await init();
      const { rows } = await pool.query(
        `SELECT *
         FROM leads
         WHERE deleted = FALSE
         ORDER BY created_at ASC, id ASC`
      );
      return rows.map(rowToLead);
    },
    async getLead(id) {
      await init();
      const { rows } = await pool.query(`SELECT * FROM leads WHERE id = $1`, [id]);
      return rows[0] ? rowToLead(rows[0]) : null;
    },
    async insertLead(storedLead, actor) {
      await init();
      const { rows } = await pool.query(
        `INSERT INTO leads (
          id, name, phone, origin, value, next_step, stage, tasks, loss_reason, obs, owner, tags,
          created_at, updated_at, deleted, last_modified_by
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14,$15,$16
        )
        RETURNING *`,
        [
          storedLead.id,
          storedLead.name,
          storedLead.phone || '',
          storedLead.origin || 'Geral',
          Number(storedLead.value) || 0,
          storedLead.nextStep || '',
          storedLead.stage || 'Novo lead',
          JSON.stringify(storedLead.tasks || []),
          storedLead.lossReason || '',
          storedLead.obs || '',
          storedLead.owner || '',
          JSON.stringify(storedLead.tags || []),
          Number(storedLead.createdAt) || Date.now(),
          Number(storedLead.updatedAt) || Date.now(),
          !!storedLead.deleted,
          storedLead.lastModifiedBy || ''
        ]
      );
      await this.addAudit({ actor, action: 'lead_create', entityType: 'lead', entityId: storedLead.id });
      return rowToLead(rows[0]);
    },
    async updateLead(id, storedLead, actor) {
      await init();
      const { rows } = await pool.query(
        `UPDATE leads SET
          name = $2,
          phone = $3,
          origin = $4,
          value = $5,
          next_step = $6,
          stage = $7,
          tasks = $8::jsonb,
          loss_reason = $9,
          obs = $10,
          owner = $11,
          tags = $12::jsonb,
          created_at = $13,
          updated_at = $14,
          deleted = $15,
          last_modified_by = $16
         WHERE id = $1
         RETURNING *`,
        [
          id,
          storedLead.name,
          storedLead.phone || '',
          storedLead.origin || 'Geral',
          Number(storedLead.value) || 0,
          storedLead.nextStep || '',
          storedLead.stage || 'Novo lead',
          JSON.stringify(storedLead.tasks || []),
          storedLead.lossReason || '',
          storedLead.obs || '',
          storedLead.owner || '',
          JSON.stringify(storedLead.tags || []),
          Number(storedLead.createdAt) || Date.now(),
          Number(storedLead.updatedAt) || Date.now(),
          !!storedLead.deleted,
          storedLead.lastModifiedBy || ''
        ]
      );
      if (!rows[0]) return null;
      await this.addAudit({ actor, action: 'lead_update', entityType: 'lead', entityId: id });
      return rowToLead(rows[0]);
    },
    async softDeleteLead(id, actor) {
      await init();
      const updatedAt = Date.now();
      const { rowCount } = await pool.query(
        `UPDATE leads
         SET deleted = TRUE, updated_at = $2, last_modified_by = $3
         WHERE id = $1`,
        [id, updatedAt, actor]
      );
      if (rowCount) await this.addAudit({ actor, action: 'lead_delete', entityType: 'lead', entityId: id });
      return rowCount > 0;
    },
    async replaceLeads(nextLeads, actor) {
      await init();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM leads');

        for (const lead of nextLeads) {
          // eslint-disable-next-line no-await-in-loop
          await client.query(
            `INSERT INTO leads (
              id, name, phone, origin, value, next_step, stage, tasks, loss_reason, obs, owner, tags,
              created_at, updated_at, deleted, last_modified_by
            ) VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12::jsonb,$13,$14,$15,$16
            )`,
            [
              lead.id,
              lead.name,
              lead.phone || '',
              lead.origin || 'Geral',
              Number(lead.value) || 0,
              lead.nextStep || '',
              lead.stage || 'Novo lead',
              JSON.stringify(lead.tasks || []),
              lead.lossReason || '',
              lead.obs || '',
              lead.owner || '',
              JSON.stringify(lead.tags || []),
              Number(lead.createdAt) || Date.now(),
              Number(lead.updatedAt) || Date.now(),
              !!lead.deleted,
              lead.lastModifiedBy || ''
            ]
          );
        }

        await client.query('COMMIT');
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {}
        throw e;
      } finally {
        client.release();
      }

      await this.addAudit({ actor, action: 'leads_replace', entityType: 'lead' });
      return nextLeads.length;
    },
    async listAudit(limit) {
      await init();
      const lim = Math.min(500, Math.max(1, Number(limit || 100)));
      const { rows } = await pool.query(
        `SELECT id, at, actor, action, entity_type, entity_id
         FROM audit
         ORDER BY at DESC
         LIMIT $1`,
        [lim]
      );
      return rows.map(rowToAudit);
    }
  };
}

module.exports = {
  createPgStore
};

