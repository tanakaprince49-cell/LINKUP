import React, { useEffect, useState } from 'react';
import { isDiscoverableProfile } from '../lib/discovery';
import { maybeCreateOpportunityAlerts } from '../lib/opportunityAlerts';
import { maybeCreateProjectRecommendationAlerts } from '../lib/projectRecommendations';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile } from '../types';
import { subscribeToDiscoveryProfiles } from '../lib/discoveryProfiles';

export default function OpportunityRadar() {
  const { user, profile, isOnboarded } = useAuth();
  const [people, setPeople] = useState<UserProfile[]>([]);

  useEffect(() => {
    if (!user?.uid || !isOnboarded) {
      setPeople([]);
      return;
    }

    const unsubscribe = subscribeToDiscoveryProfiles({
      userId: user.uid,
      onData: (profiles) => {
        const rows = profiles.filter((person: any) => person.uid !== user.uid && isDiscoverableProfile(person));
        setPeople(rows);
      },
      onError: (error) => {
        console.warn('Opportunity radar unavailable:', error);
        setPeople([]);
      },
    });

    return () => unsubscribe();
  }, [isOnboarded, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !isOnboarded || !profile || people.length === 0) return;
    Promise.all([
      maybeCreateOpportunityAlerts(user.uid, profile, people),
      maybeCreateProjectRecommendationAlerts(user.uid, profile, people),
    ]).catch((error) => {
      console.warn('Opportunity/project alert skipped:', error);
    });
  }, [isOnboarded, people, profile, user?.uid]);

  return null;
}
