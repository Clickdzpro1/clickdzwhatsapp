const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://clickdz:clickdz_password@localhost:5432/clickdz_whatsapp',
});

async function seed() {
  const client = await pool.connect();
  try {
    // Create default superadmin
    const passwordHash = await bcrypt.hash('admin123', 12);
    await client.query(
      `INSERT INTO admins (email, password_hash, name, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO NOTHING`,
      ['admin@clickdz.com', passwordHash, 'ClickDz Admin', 'superadmin']
    );
    console.log('Superadmin created: admin@clickdz.com / admin123');
    console.log('IMPORTANT: Change this password immediately in production!');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
