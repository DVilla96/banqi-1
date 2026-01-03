
'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db } from '@/lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';

export type UserProfile = {
  // Initial registration
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  
  // From ID
  photoUrl?: string;
  idNumber?: string;
  idIssuePlace?: string;
  dateOfBirth?: string;

  // From Work Certificate
  employerName?: string;
  position?: string;
  salary?: number;
  startDate?: string;

  // From Bank Certificate
  bankName?: string;
  accountHolder?: string;
  accountType?: string;
  accountNumber?: string;
}

type AuthContextType = {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  idToken: string | null;
};

const AuthContext = createContext<AuthContextType>({ user: null, profile: null, loading: true, idToken: null });

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      console.log(`AUTH_PROVIDER: Auth state changed. User: ${user?.email || 'No user'}, UID: ${user?.uid || 'No UID'}`);
      setUser(user);
      
      if (user) {
        const token = await user.getIdToken();
        console.log("AUTH_PROVIDER: User token acquired.");
        setIdToken(token);
        
        // Listen for profile changes in real-time
        const profileRef = doc(db, 'users', user.uid);
        const unsubscribeProfile = onSnapshot(profileRef, (doc) => {
          console.log("AUTH_PROVIDER: Profile snapshot received.");
          if (doc.exists()) {
            setProfile(doc.data() as UserProfile);
            console.log("AUTH_PROVIDER: Profile updated:", doc.data());
          } else {
            setProfile(null);
            console.log("AUTH_PROVIDER: No profile document found for UID:", user.uid);
          }
          setLoading(false);
        }, (error) => {
            console.error("AUTH_PROVIDER: Error listening to profile snapshot:", error);
            setLoading(false);
        });

        // Return a cleanup function for the profile listener
        return () => unsubscribeProfile();

      } else {
        console.log("AUTH_PROVIDER: User signed out.");
        setIdToken(null);
        setProfile(null);
        setLoading(false);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, idToken }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
