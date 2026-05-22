import React, { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { isDiscoverableProfile } from '../lib/discovery';
import { maybeCreateOpportunityAlerts } from '../lib/opportunityAlerts';
import { maybeCreateProjectRecommendationAlerts } from '../lib/projectRecommendations';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile } from '../types';

export default function OpportunityRadar() {
  const { user, profile, isOnboarded } = useAuth();
  const [people, setPeople] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (!user?.uid || !isOnboarded) {
      setPeople([]);
      return;
    }

    const usersQuery = query(
      collection(db, 'users'),
      where('isVisible', '==', true),
      where('isStealthMode', '==', false),
      limit(40)
    );

    const unsubscribe = onSnapshot(
      usersQuery,
      (snapshot) => {
        const rows = snapshot.docs
          .map((docSnap) => docSnap.data() as UserProfile)
          .filter((person: any) => person.uid !== user.uid && isDiscoverableProfile(person));
        setPeople(rows);
      },
      (error) => {
        console.warn('AI opportunity radar unavailable:', error);
        setPeople([]);
      }
    );

    return () => unsubscribe();
  }, [isOnboarded, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !isOnboarded || !profile || people.length === 0) return;
    Promise.all([
      maybeCreateOpportunityAlerts(user.uid, profile, people),
      maybeCreateProjectRecommendationAlerts(user.uid, profile, people),
    ]).catch((error) => {
      console.warn('AI opportunity/project alert skipped:', error);
    });
  }, [isOnboarded, people, profile, user?.uid]);

  return null;
}
