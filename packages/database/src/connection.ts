import mongoose from "mongoose";

interface MongooseCache {
  connection: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
  uri: string | null;
}

declare global {
  var xenodeMongoose: MongooseCache | undefined;
}

const cache: MongooseCache = globalThis.xenodeMongoose ?? {
  connection: null,
  promise: null,
  uri: null,
};

globalThis.xenodeMongoose = cache;
mongoose.set("updatePipeline", true);

export async function connectDatabase(
  uri = process.env.MONGODB_URI,
): Promise<typeof mongoose> {
  if (!uri) throw new Error("MONGODB_URI environment variable is required");
  if (cache.connection && cache.uri === uri) return cache.connection;

  if (!cache.promise || cache.uri !== uri) {
    cache.uri = uri;
    cache.promise = mongoose
      .connect(uri, { bufferCommands: false })
      .then((connected) => connected);
  }

  try {
    cache.connection = await cache.promise;
    return cache.connection;
  } catch (error) {
    cache.promise = null;
    cache.connection = null;
    cache.uri = null;
    throw error;
  }
}

export function getDatabase() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error("Database is not connected; call connectDatabase() first");
  }
  return database;
}

export function getMongoose(): typeof mongoose {
  return mongoose;
}

export async function withTransaction<T>(
  operation: (session: mongoose.ClientSession) => Promise<T>,
): Promise<T> {
  await connectDatabase();
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => operation(session));
  } finally {
    await session.endSession();
  }
}

export async function disconnectDatabaseForTests(): Promise<void> {
  await mongoose.disconnect();
  cache.connection = null;
  cache.promise = null;
  cache.uri = null;
}

export default connectDatabase;
