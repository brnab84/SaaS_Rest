// Servidor de prueba para el smoke de UI (Playwright): levanta la app contra una Mongo
// en memoria y siembra un comercio normal, un root y un producto. No usa datos reales.
import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri();
process.env.JWT_SECRET = 'ui-smoke-secret-0123456789-abcdef';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef';
process.env.ROOT_EMAIL = 'root@test.local';
process.env.REGISTRATION_OPEN = 'true';
process.env.RATE_LIMIT_OFF = '1'; // el smoke hace muchas requests seguidas desde la misma IP
process.env.LOG_LEVEL = 'silent';
process.env.PORT = process.env.PORT || '4173';

const { connectDB } = await import('../src/config/db.js');
await connectDB();
const { loadPlans } = await import('../src/config/plans.js');
await loadPlans();

const { Tenant } = await import('../src/models/Tenant.js');
const { User } = await import('../src/models/User.js');
const { Product } = await import('../src/models/Product.js');
const { Expense } = await import('../src/models/Expense.js');

async function seed(name, slug, email) {
  let t = await Tenant.findOne({ slug });
  if (!t) t = await Tenant.create({ name, slug });
  if (!(await User.findOne({ email }))) {
    const u = new User({ tenantId: t._id, email, role: 'owner' });
    await u.setPassword('test1234');
    await u.save();
  }
  return t;
}

const qa = await seed('QA Demo', 'qa-demo', 'qa@test.local');
await seed('QA Root', 'qa-root', 'root@test.local');
if (!(await Product.findOne({ tenantId: qa._id }))) {
  await Product.create({ tenantId: qa._id, name: 'Roll QA', price: 5000, category: 'Rolls', available: true });
}
if (!(await Expense.findOne({ tenantId: qa._id }))) {
  await Expense.create({ tenantId: qa._id, vendor: 'jumbo', note: '1kg', total: 983, category: 'supplies', items: [{ desc: 'Harina 0000', amount: 983 }] });
}

const { createApp } = await import('../src/app.js');
createApp().listen(Number(process.env.PORT), () => console.log(`test-server listo en :${process.env.PORT}`));
