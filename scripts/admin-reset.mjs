// Utilidad de administración (correr con `railway run` para usar la env del servicio).
//   railway run --service api node scripts/admin-reset.mjs list
//   railway run --service api node scripts/admin-reset.mjs set <email> <nuevaPassword>
import mongoose from 'mongoose';
import { connectDB } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Tenant } from '../src/models/Tenant.js';

const [, , cmd, email, pass] = process.argv;
await connectDB();

if (cmd === 'list') {
  const users = await User.find().select('email role tenantId createdAt').sort({ createdAt: 1 }).lean();
  for (const u of users) {
    const t = await Tenant.findById(u.tenantId).select('name slug').lean();
    console.log(`${u.email}  |  ${u.role}  |  ${t?.slug || '—'}  |  ${new Date(u.createdAt).toISOString().slice(0, 10)}`);
  }
  console.log(`\nTotal: ${users.length} usuarios`);
} else if (cmd === 'set' && email && pass) {
  const u = await User.findOne({ email: String(email).toLowerCase() });
  if (!u) console.log('NO existe un usuario con ese email:', email);
  else { await u.setPassword(pass); await u.save(); console.log('OK — contraseña actualizada para', u.email); }
} else {
  console.log('uso: list  |  set <email> <nuevaPassword>');
}

await mongoose.connection.close();
