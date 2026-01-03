// Client-only Firebase initialization to prevent SSR localStorage issues
import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  browserLocalPersistence,
  type Auth
} from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getDatabase, type Database } from "firebase/database";

const firebaseConfig = {
  "projectId": "lendlink-bmg93",
  "appId": "1:145937965920:web:46d7ddc890acf337e43405",
  "storageBucket": "lendlink-bmg93.firebasestorage.app",
  "apiKey": "AIzaSyDb7qm_FYGEIpgmA2nSAf9uq6mWv8KFwkc",
  "authDomain": "lendlink-bmg93.firebaseapp.com",
  "messagingSenderId": "145937965920",
  "databaseURL": "https://lendlink-bmg93-default-rtdb.firebaseio.com"
};

// Initialize Firebase App (safe for SSR)
const app: FirebaseApp = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Firestore, Storage, and Realtime Database are SSR-safe
const db: Firestore = getFirestore(app);
const storage: FirebaseStorage = getStorage(app);
const rtdb: Database = getDatabase(app);

// Auth initialization - only on client
let auth: Auth;

if (typeof window !== "undefined") {
  // Client-side: use browser persistence
  try {
    auth = initializeAuth(app, {
      persistence: browserLocalPersistence,
    });
  } catch (e) {
    // If already initialized, get existing instance
    auth = getAuth(app);
  }
} else {
  // Server-side: create a stub that will be replaced on client
  // This prevents any localStorage access on the server
  auth = {} as Auth;
}

export { app, auth, db, storage, rtdb };
