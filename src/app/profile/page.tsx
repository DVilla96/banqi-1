
'use client';

import { useAuth } from "@/hooks/use-auth";
import UserProfilePage from "@/components/profile/user-profile-page";

export default function ProfilePage() {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return <UserProfilePage loading />;
  }

  if (!user || !profile) {
    return <UserProfilePage loading />;
  }

  return <UserProfilePage userId={user.uid} profile={profile} />;
}
