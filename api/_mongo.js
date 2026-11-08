// Shared MongoDB connection for Vercel serverless functions.
//
// The MongoClient is cached on globalThis so warm invocations reuse one
// connection pool instead of opening a new pool per request (Atlas M0
// allows 100 concurrent connections; a pool of 5 per warm container is
// plenty and leaves headroom for cron + webhook bursts).
//
// Env:
//   MONGO_URI  — full Atlas connection string (set in Vercel, never in code)
//   MONGO_DB   — database name, defaults to "linkup"
import { MongoClient } from 'mongodb';

const DB_NAME = () => String(process.env.MONGO_DB || 'linkup').trim() || 'linkup';

function getClient() {
  if (!globalThis.__linkupMongoClient) {
    const uri = String(process.env.MONGO_URI || '').trim();
    if (!uri) {
      throw new Error('MONGO_URI is not set. Add it in Vercel env (Project → Settings → Environment Variables).');
    }
    globalThis.__linkupMongoClient = new MongoClient(uri, {
      maxPoolSize: 5,
      minPoolSize: 0,
      maxIdleTimeMS: 60_000,
      serverSelectionTimeoutMS: 10_000,
      retryWrites: true,
    });
    globalThis.__linkupMongoPromise = globalThis.__linkupMongoClient.connect();
  }
  return globalThis.__linkupMongoPromise;
}

export async function getMongoDb() {
  const client = await getClient();
  return client.db(DB_NAME());
}

export async function getMongoClient() {
  return getClient();
}
