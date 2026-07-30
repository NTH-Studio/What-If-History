import { config } from '../config.js';
import { openDatabase } from './database.js';

const database = openDatabase(config.databasePath);
const version = database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
console.log(`SQLite schema ready at version ${String(version?.version ?? 0)}.`);
database.close();
