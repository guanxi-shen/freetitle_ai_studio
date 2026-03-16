import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore, doc, getDoc } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyA0EtKTtBS8iew3bIt6R8teXg0BbvDcTuI",
  authDomain: "tbot-9e98e.firebaseapp.com",
  projectId: "tbot-9e98e",
  storageBucket: "tbot-9e98e.firebasestorage.app",
  messagingSenderId: "963905106335",
  appId: "1:963905106335:web:69df8a428ebd3221a0cdaa",
  measurementId: "G-NTKDGDMGSK",
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()

export async function isEmailAllowed(email) {
  const snap = await getDoc(doc(db, 'allowed_emails', email))
  return snap.exists()
}
