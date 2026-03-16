import { useState, useEffect, useCallback } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth'
import { auth, googleProvider, isEmailAllowed } from '../firebase'

export default function useAuth() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const allowed = await isEmailAllowed(firebaseUser.email)
        if (!allowed) {
          setAuthError('Access denied. Your email is not authorized.')
          await signOut(auth)
          setUser(null)
        } else {
          setAuthError('')
          setUser(firebaseUser)
        }
      } else {
        setUser(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  const loginWithGoogle = useCallback(() => signInWithPopup(auth, googleProvider), [])

  const loginWithEmail = useCallback((email, password) =>
    signInWithEmailAndPassword(auth, email, password), [])

  const signUpWithEmail = useCallback((email, password) =>
    createUserWithEmailAndPassword(auth, email, password), [])

  const logout = useCallback(() => {
    localStorage.removeItem('active-project')
    return signOut(auth)
  }, [])

  const getToken = useCallback(async () => {
    if (!auth.currentUser) return null
    return auth.currentUser.getIdToken()
  }, [])

  return { user, loading, authError, loginWithGoogle, loginWithEmail, signUpWithEmail, logout, getToken }
}
