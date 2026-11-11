import pg from 'pg'

const { Pool } = pg
let pool
const dateFields = new Set(['createdAt','updatedAt','subscriptionExpiresAt','pickupDeadline','expiresAt','adminReviewedAt'])
const refs = {
  offers: { merchantAccount: ['accounts', 'merchant_account'] },
  reservations: { offer: ['offers', 'offer'], customerAccount: ['accounts', 'customer_account'] },
  purchase_intents: { offer: ['offers', 'offer'], customerAccount: ['accounts', 'customer_account'] },
}
const snake = (key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
const camel = (key) => key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
const pgValue = (value) => value instanceof String ? value.toString() : value instanceof Date ? value.toISOString() : value
function id(value) {
  if (value == null) return value
  const text = String(value)
  return Object.assign(new String(text), { equals(other) { return text === String(other) } })
}
function rowToDoc(row) {
  if (!row) return null
  const doc = {}
  for (const [key, value] of Object.entries(row)) {
    const name = camel(key)
    if (name === '_id') doc[name] = id(value)
    else if (dateFields.has(name) && value) doc[name] = new Date(value)
    else if (name === 'price' || name === 'originalPrice') doc[name] = Number(value)
    else doc[name] = value
  }
  doc._id = id(row.id)
  delete doc.id
  Object.defineProperty(doc, 'save', { enumerable: false, value: async function () {
    const data = {}
    // updated_at is maintained by this UPDATE statement; do not also include
    // the document's updatedAt value or PostgreSQL reports a duplicate target.
    for (const [key, value] of Object.entries(this)) if (key !== '_id' && key !== 'updatedAt' && typeof value !== 'function') data[snake(key)] = pgValue(value)
    const keys = Object.keys(data)
    if (!keys.length) return this
    const sets = keys.map((key, index) => `"${key}" = $${index + 1}`).join(', ')
    const result = await pool.query(`update ${this.__table} set ${sets}, updated_at = now() where id = $${keys.length + 1} returning *`, [...Object.values(data), String(this._id)])
    Object.assign(this, rowToDoc(result.rows[0]))
    return this
  } })
  return doc
}
function matches(row, filter = {}) {
  return Object.entries(filter).every(([field, expected]) => {
    const actual = row[field]
    if (expected && typeof expected === 'object' && !(expected instanceof Date) && !(expected instanceof String) && !Array.isArray(expected)) {
      return Object.entries(expected).every(([operator, value]) => {
        const list = Array.isArray(value) ? value.map(String) : []
        if (operator === '$in') return list.includes(String(actual))
        if (operator === '$nin') return !list.includes(String(actual))
        if (operator === '$gt') return new Date(actual) > new Date(value) || Number(actual) > Number(value)
        if (operator === '$gte') return new Date(actual) >= new Date(value) || Number(actual) >= Number(value)
        if (operator === '$lte') return new Date(actual) <= new Date(value) || Number(actual) <= Number(value)
        if (operator === '$exists') return value ? actual != null : actual == null
        return false
      })
    }
    return String(actual ?? '') === String(expected ?? '')
  })
}
class Query {
  constructor(model, filter = {}, one = false) { this.model = model; this.filter = filter; this.one = one; this.max = Infinity; this.order = null; this.populates = [] }
  sort(spec) { this.order = spec; return this }
  limit(value) { this.max = value; return this }
  select() { return this }
  populate(field) { this.populates.push(field); return this }
  async exec() {
    let { rows } = await pool.query(`select * from ${this.model.table}`)
    let docs = rows.map(rowToDoc).filter((doc) => matches(doc, this.filter))
    if (this.order) {
      const [field, direction] = Object.entries(this.order)[0]
      docs.sort((a, b) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * direction)
    }
    docs = docs.slice(0, this.max)
    for (const doc of docs) {
      Object.defineProperty(doc, '__table', { value: this.model.table, enumerable: false })
      for (const field of this.populates) {
        const ref = refs[this.model.table]?.[field]
        if (!ref || !doc[field]) continue
        const result = await pool.query(`select * from ${ref[0]} where id = $1`, [String(doc[field])])
        doc[field] = rowToDoc(result.rows[0])
        if (doc[field]) Object.defineProperty(doc[field], '__table', { value: ref[0], enumerable: false })
      }
    }
    return this.one ? docs[0] || null : docs
  }
  then(resolve, reject) { return this.exec().then(resolve, reject) }
}
export class Model {
  constructor(table) { this.table = table }
  find(filter = {}) { return new Query(this, filter) }
  findOne(filter = {}) { return new Query(this, filter, true) }
  findById(value) { return new Query(this, { _id: String(value) }, true) }
  async create(data) {
    const entries = Object.entries(data).filter(([, value]) => value !== undefined)
    const columns = entries.map(([key]) => `"${key === '_id' ? 'id' : snake(key)}"`)
    const values = entries.map(([, value]) => pgValue(value))
    const params = values.map((_, index) => `$${index + 1}`)
    const result = await pool.query(`insert into ${this.table} (${columns.join(',')}) values (${params.join(',')}) returning *`, values)
    const doc = rowToDoc(result.rows[0]); Object.defineProperty(doc, '__table', { value: this.table, enumerable: false }); return doc
  }
  async exists(filter) { return Boolean(await this.findOne(filter)) }
  async updateMany(filter, update) { const docs = await this.find(filter); for (const doc of docs) { applyUpdate(doc, update); await doc.save() } return { modifiedCount: docs.length } }
  async updateOne(filter, update) { const doc = await this.findOne(filter); if (!doc) return { modifiedCount: 0 }; applyUpdate(doc, update); await doc.save(); return { modifiedCount: 1 } }
  async findByIdAndUpdate(value, update) { const doc = await this.findById(value); if (!doc) return null; applyUpdate(doc, update); return doc.save() }
  async findOneAndUpdate(filter, update) { const doc = await this.findOne(filter); if (!doc) return null; applyUpdate(doc, update); return doc.save() }
}
function applyUpdate(doc, update) {
  Object.assign(doc, update.$set || {})
  for (const [key, amount] of Object.entries(update.$inc || {})) doc[key] = Number(doc[key]) + Number(amount)
}
export const Account = new Model('accounts')
export const Offer = new Model('offers')
export const Reservation = new Model('reservations')
export const PurchaseIntent = new Model('purchase_intents')
export async function connectDatabase() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('Недостасува DATABASE_URL (Supabase PostgreSQL connection string).')
  pool ||= new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 5 })
  await pool.query('select 1')
}
export function databaseConnected() { return Boolean(pool) }
