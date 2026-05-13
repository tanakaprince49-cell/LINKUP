import { collection, addDoc, serverTimestamp, setDoc, doc } from 'firebase/firestore';
import { db } from './firebase';

const founders = [
  { 
    displayName: "Alex Rivet", 
    bio: "Building the next generation of AI-driven supply chain. Ex-Tesla engineer.", 
    skills: ["Python", "Rust", "Computer Vision"], 
    city: "San Francisco", 
    ambition: "unicorn",
    profilePic: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=400&fit=crop"
  },
  { 
    displayName: "Sarah Chen", 
    bio: "Growth hacker turned founder. Scaling SaaS from 0 to 1M ARR.", 
    skills: ["SEO", "Copywriting", "React"], 
    city: "New York", 
    ambition: "unicorn",
    profilePic: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&h=400&fit=crop"
  },
  { 
    displayName: "Marcus Thorne", 
    bio: "Solopreneur. Building 12 startups in 12 months. Currently at 4/12.", 
    skills: ["Next.js", "Tailwind", "Firebase"], 
    city: "London", 
    ambition: "lifestyle",
    profilePic: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&h=400&fit=crop"
  },
  { 
    displayName: "Elena Vance", 
    bio: "UI/UX Obsessed. Making enterprise software look like a video game.", 
    skills: ["Figma", "React Native", "Animation"], 
    city: "Berlin", 
    ambition: "impact",
    profilePic: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&h=400&fit=crop"
  },
  { 
    displayName: "David Wu", 
    bio: "Fintech disruptor. Simplifying cross-border payments for creators.", 
    skills: ["Solidity", "Go", "Finance"], 
    city: "Singapore", 
    ambition: "unicorn",
    profilePic: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400&h=400&fit=crop"
  }
];

export const seedDatabase = async (currentUserId: string) => {
  console.log("Seeding database with real founder photos...");
  try {
    for (const founder of founders) {
      const founderId = `seed_${founder.displayName.toLowerCase().replace(/ /g, '_')}`;
      await setDoc(doc(db, 'users', founderId), {
        ...founder,
        uid: founderId,
        onboarded: true,
        reputationScore: Math.floor(Math.random() * 500) + 500,
        streakCount: Math.floor(Math.random() * 30),
        createdAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
        isVisible: true,
        isBot: false,
        projects: [],
        portfolioLinks: [],
        startupIdeas: [],
        socialLinks: {},
        resume: { shippedProducts: [], sideProjects: [], startupAttempts: [], hackathonWins: [], buildStreaks: 10 }
      });

      // Add a post
      await addDoc(collection(db, 'posts'), {
        authorId: founderId,
        authorName: founder.displayName,
        content: `Just hit a major milestone on the ${founder.displayName} project! Proof of Work is everything. #BuildingInPublic`,
        type: 'build',
        timestamp: serverTimestamp(),
        likesCount: Math.floor(Math.random() * 100),
        commentsCount: Math.floor(Math.random() * 20),
        likedBy: []
      });

      // Add a notification for the current user
      if (currentUserId) {
        await addDoc(collection(db, 'notifications'), {
          userId: currentUserId,
          type: 'match',
          content: `${founder.displayName} just verified your Proof of Work!`,
          isRead: false,
          timestamp: serverTimestamp(),
          fromId: founderId
        });
      }
    }
    console.log("Seeding complete!");
  } catch (err) {
    console.error("Seeding error:", err);
  }
};
