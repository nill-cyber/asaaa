import { getApps, initializeApp, cert, App } from "firebase-admin/app";
import { getDatabase, Database } from "firebase-admin/database";

let app: App;

function getApp(): App {
  if (app) return app;
  const existing = getApps();
  if (existing.length) {
    app = existing[0];
    return app;
  }
  app = initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
  return app;
}

export function db(): Database {
  return getDatabase(getApp());
}
