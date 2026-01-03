
'use client';

import UserProfilePage from "@/components/profile/user-profile-page";
import { useParams } from 'next/navigation';

export default function PublicProfilePage() {
  const { userId } = useParams();

  return <UserProfilePage userId={Array.isArray(userId) ? userId[0] : userId} />;
}
