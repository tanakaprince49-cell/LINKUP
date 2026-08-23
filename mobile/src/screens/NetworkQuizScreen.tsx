import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Dimensions, Alert, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { COLORS, appBackground, textColor } from '../theme/theme';
import { RefreshCw, Brain, Share2, Swords, CheckCircle2, Loader } from 'lucide-react-native';
import GameChallengeModal from '../components/GameChallengeModal';
import { submitChallengeScore, subscribeToChallenge, GameChallenge, setPlayerJoined } from '../lib/gameChallenges';
import { useAuth } from '../contexts/AuthContext';

const QUESTIONS = [
  { q: 'Which company acquired Instagram?', options: ['Google', 'Facebook', 'Twitter', 'Snapchat'], answer: 1 },
  { q: 'What does "B2B" stand for?', options: ['Back to Basics', 'Business to Business', 'Brick to Brick', 'Bootstrap to Build'], answer: 1 },
  { q: 'What is a "unicorn" startup?', options: ['A company with a unicorn mascot', 'A startup worth >$1B', 'A company with one founder', 'A failed startup'], answer: 1 },
  { q: 'Which Y Combinator startup became a $100B+ company?', options: ['Dropbox', 'Airbnb', 'Reddit', 'Stripe'], answer: 1 },
  { q: 'What is "burn rate"?', options: ['How fast a company grows', 'How fast a company spends cash', 'Employee turnover rate', 'Server processing speed'], answer: 1 },
  { q: 'What does ARR stand for?', options: ['Annual Recurring Revenue', 'Annual Return Rate', 'Average Risk Ratio', 'Actual Revenue Recorded'], answer: 0 },
  { q: 'Who is the youngest self-made billionaire?', options: ['Mark Zuckerberg', 'Austin Russell', 'Kylie Jenner', 'Vitalik Buterin'], answer: 1 },
  { q: 'What does "MVP" mean in startups?', options: ['Most Valuable Player', 'Minimum Viable Product', 'Maximum Venture Potential', 'Market Value Proposition'], answer: 1 },
  { q: 'Which company was originally called "TheFacebook"?', options: ['Facebook', 'Twitter', 'Instagram', 'LinkedIn'], answer: 0 },
  { q: 'What is "bootstrapping"?', options: ['Using investor money only', 'Building a company without external funding', 'Hiring without interviews', 'A type of pitch deck'], answer: 1 },
  { q: 'Which is NOT a stage of startup funding?', options: ['Series A', 'Series B', 'Series D', 'Series M'], answer: 3 },
  { q: 'What does "pivot" mean?', options: ['Changing the company name', 'Fundamentally changing business strategy', 'Hiring a new CEO', 'Moving to a new office'], answer: 1 },
  { q: 'Who wrote "The Lean Startup"?', options: ['Steve Blank', 'Eric Ries', 'Peter Thiel', 'Paul Graham'], answer: 1 },
  { q: 'What is "traction"?', options: ['A car metaphor', 'Evidence of market demand', 'Investor meetings scheduled', 'Patent filings'], answer: 1 },
  { q: 'Which company started in a dorm room?', options: ['Apple', 'Microsoft', 'Facebook', 'Amazon'], answer: 2 },
  { q: 'What does "SaaS" stand for?', options: ['System as a Service', 'Software as a Service', 'Service as a Solution', 'Software and Security'], answer: 1 },
  { q: 'Who is the CEO of Tesla?', options: ['Elon Musk', 'Tim Cook', 'Satya Nadella', 'Jeff Bezos'], answer: 0 },
  { q: 'Which company developed the iPhone?', options: ['Microsoft', 'Google', 'Apple', 'Samsung'], answer: 2 },
  { q: 'What is "machine learning"?', options: ['Teaching machines to learn from data', 'Building physical robots', 'Writing code by hand', 'Cloud computing'], answer: 0 },
  { q: 'What does "API" stand for?', options: ['Application Programming Interface', 'Automated Program Integration', 'Application Process Integration', 'Advanced Programming Interface'], answer: 0 },
  { q: 'Who founded Amazon?', options: ['Bill Gates', 'Jeff Bezos', 'Steve Jobs', 'Larry Page'], answer: 1 },
  { q: 'What is "blockchain"?', options: ['A type of database', 'A distributed ledger technology', 'A programming language', 'A social network'], answer: 1 },
  { q: 'Which company owns YouTube?', options: ['Microsoft', 'Apple', 'Google', 'Amazon'], answer: 2 },
  { q: 'What does "URL" stand for?', options: ['Universal Resource Locator', 'Uniform Resource Locator', 'Unified Resource Link', 'Universal Reference Link'], answer: 1 },
  { q: 'Who is the founder of Microsoft?', options: ['Steve Jobs', 'Bill Gates', 'Mark Zuckerberg', 'Larry Ellison'], answer: 1 },
  { q: 'What is "cybersecurity"?', options: ['Protecting computer systems from threats', 'Building computer hardware', 'Writing code', 'Managing databases'], answer: 0 },
  { q: 'Which company is known for search engine?', options: ['Yahoo', 'Bing', 'Google', 'DuckDuckGo'], answer: 2 },
  { q: 'What does "RAM" stand for?', options: ['Random Access Memory', 'Read Access Memory', 'Rapid Access Module', 'Random Algorithmic Memory'], answer: 0 },
  { q: 'Who invented the World Wide Web?', options: ['Tim Berners-Lee', 'Vint Cerf', 'Robert Kahn', 'Bill Gates'], answer: 0 },
  { q: 'What is "cloud computing"?', options: ['Storing and accessing data over the internet', 'Computing in the sky', 'Using physical servers', 'Desktop software'], answer: 0 },
  { q: 'Which company makes Android?', options: ['Apple', 'Microsoft', 'Google', 'Samsung'], answer: 2 },
  { q: 'What does "CSS" stand for?', options: ['Cascading Style Sheets', 'Computer Style Sheets', 'Creative Style Sheets', 'Colorful Style Sheets'], answer: 0 },
  { q: 'Who founded Facebook?', options: ['Mark Zuckerberg', 'Eduardo Saverin', 'Dustin Moskovitz', 'Chris Hughes'], answer: 0 },
  { q: 'What is "AI"?', options: ['Artificial Intelligence', 'Automated Integration', 'Advanced Interface', 'Algorithmic Input'], answer: 0 },
  { q: 'Which company makes the PlayStation?', options: ['Microsoft', 'Nintendo', 'Sony', 'Sega'], answer: 2 },
  { q: 'What does "VPN" stand for?', options: ['Virtual Private Network', 'Very Personal Network', 'Virtual Public Network', 'Verified Private Network'], answer: 0 },
  { q: 'Who is the founder of Alibaba?', options: ['Jack Ma', 'Robin Li', 'Pony Ma', 'Lei Jun'], answer: 0 },
  { q: 'What is "IoT"?', options: ['Internet of Things', 'Input Output Technology', 'Integration of Tools', 'Internal Operating Technology'], answer: 0 },
  { q: 'Which company owns WhatsApp?', options: ['Google', 'Microsoft', 'Meta', 'Apple'], answer: 2 },
  { q: 'What does "HTML" stand for?', options: ['HyperText Markup Language', 'HyperText Modeling Language', 'High Text Markup Language', 'HyperTransfer Markup Language'], answer: 0 },
  { q: 'Who co-founded Apple?', options: ['Steve Jobs and Steve Wozniak', 'Steve Jobs and Bill Gates', 'Steve Wozniak and Tim Cook', 'Jony Ive and Steve Jobs'], answer: 0 },
  { q: 'What is "venture capital"?', options: ['Funding for early-stage companies', 'A type of bank loan', 'Government grants', 'Personal savings'], answer: 0 },
  { q: 'Which company was first to reach $1 trillion market cap?', options: ['Apple', 'Microsoft', 'Amazon', 'Google'], answer: 0 },
  { q: 'What does "IPO" stand for?', options: ['Initial Public Offering', 'Initial Private Offering', 'Internal Public Offering', 'Investment Public Option'], answer: 0 },
  { q: 'Who is known as the "father of the computer"?', options: ['Alan Turing', 'Charles Babbage', 'John von Neumann', 'Ada Lovelace'], answer: 1 },
  { q: 'What is "agile" methodology?', options: ['Iterative software development', 'Waterfall planning', 'Random coding', 'No planning'], answer: 0 },
  { q: 'Which company makes the most semiconductors?', options: ['Intel', 'TSMC', 'Samsung', 'AMD'], answer: 1 },
  { q: 'What does "CEO" stand for?', options: ['Chief Executive Officer', 'Chief Executive Official', 'Corporate Executive Officer', 'Chief Engagement Officer'], answer: 0 },
  { q: 'Who founded SpaceX?', options: ['Jeff Bezos', 'Richard Branson', 'Elon Musk', 'Paul Allen'], answer: 2 },
  { q: 'What is "open source" software?', options: ['Software with publicly accessible source code', 'Free software only', 'Software that cannot be modified', 'Paid software'], answer: 0 },
  { q: 'Which programming language is used for iOS apps?', options: ['Java', 'Swift', 'Python', 'C#'], answer: 1 },
  { q: 'What does "SQL" stand for?', options: ['Structured Query Language', 'Simple Query Language', 'Standard Query Language', 'Structured Question Language'], answer: 0 },
  { q: 'Who founded Oracle?', options: ['Larry Ellison', 'Mark Zuckerberg', 'Bill Gates', 'Michael Dell'], answer: 0 },
  { q: 'What is "digital transformation"?', options: ['Adopting digital technology across a business', 'Replacing all employees with computers', 'Building a website', 'Using social media'], answer: 0 },
  { q: 'Which company makes the most smartphones?', options: ['Apple', 'Samsung', 'Xiaomi', 'Huawei'], answer: 1 },
  { q: 'What does "UI" stand for?', options: ['User Interface', 'User Integration', 'Unified Interface', 'Universal Input'], answer: 0 },
  { q: 'Who invented Python programming language?', options: ['Guido van Rossum', 'Dennis Ritchie', 'Brendan Eich', 'James Gosling'], answer: 0 },
  { q: 'What is "e-commerce"?', options: ['Buying and selling online', 'Electronic commerce laws', 'Email marketing', 'Online banking'], answer: 0 },
  { q: 'Which company owns Instagram?', options: ['Meta', 'Google', 'Twitter', 'Snap'], answer: 0 },
  { q: 'What does "UX" stand for?', options: ['User Experience', 'User Extension', 'Universal Experience', 'Unified Xperience'], answer: 0 },
  { q: 'Who is the founder of Netflix?', options: ['Reed Hastings', 'Marc Randolph', 'Both', 'Ted Sarandos'], answer: 2 },
  { q: 'What is "cryptocurrency"?', options: ['Digital currency using cryptography', 'A type of stock', 'A physical coin', 'A bank account'], answer: 0 },
  { q: 'Which company makes the Windows OS?', options: ['Apple', 'Microsoft', 'Google', 'Linux'], answer: 1 },
  { q: 'What does "GDPR" stand for?', options: ['General Data Protection Regulation', 'Global Data Privacy Rules', 'General Digital Protection Regulation', 'Government Data Protection Rules'], answer: 0 },
  { q: 'Who founded Pinterest?', options: ['Ben Silbermann', 'Jack Dorsey', 'Evan Spiegel', 'Kevin Systrom'], answer: 0 },
  { q: 'What is "fintech"?', options: ['Technology in financial services', 'Financial textbooks', 'Tax software', 'Banking regulations'], answer: 0 },
  { q: 'Which company makes the most GPUs?', options: ['Intel', 'AMD', 'NVIDIA', 'ARM'], answer: 2 },
  { q: 'What does "SaaS" stand for?', options: ['Software as a Service', 'Sales as a Service', 'System as a Service', 'Solution as a Service'], answer: 0 },
  { q: 'Who is the founder of Virgin Group?', options: ['Richard Branson', 'Elon Musk', 'Jeff Bezos', 'Peter Thiel'], answer: 0 },
  { q: 'What is "machine vision"?', options: ['Computers interpreting visual data', 'Computer screens', 'Virtual reality', 'Data visualization'], answer: 0 },
  { q: 'Which company owns LinkedIn?', options: ['Microsoft', 'Google', 'Meta', 'Apple'], answer: 0 },
  { q: 'What does "ROI" stand for?', options: ['Return on Investment', 'Rate of Interest', 'Return on Innovation', 'Risk of Investment'], answer: 0 },
  { q: 'Who invented the telephone?', options: ['Alexander Graham Bell', 'Thomas Edison', 'Nikola Tesla', 'Guglielmo Marconi'], answer: 0 },
  { q: 'What is "big data"?', options: ['Large datasets analyzed computationally', 'A large hard drive', 'Many spreadsheets', 'Cloud storage'], answer: 0 },
  { q: 'Which company is the largest e-commerce platform?', options: ['Amazon', 'Alibaba', 'eBay', 'Shopify'], answer: 0 },
  { q: 'What does "KPI" stand for?', options: ['Key Performance Indicator', 'Key Process Indicator', 'Key Performance Index', 'Knowledge Performance Indicator'], answer: 0 },
  { q: 'Who founded Twitter?', options: ['Jack Dorsey', 'Evan Williams', 'Biz Stone', 'All of the above'], answer: 3 },
  { q: 'What is "edge computing"?', options: ['Processing data near the source', 'The edge of a network', 'Serverless computing', 'Cloud computing'], answer: 0 },
  { q: 'Which company makes the most CPUs for PCs?', options: ['Intel', 'AMD', 'ARM', 'Qualcomm'], answer: 0 },
  { q: 'What does "NPS" stand for in business?', options: ['Net Promoter Score', 'Net Profit Share', 'New Product Strategy', 'National Product Standard'], answer: 0 },
  { q: 'Who is the founder of IKEA?', options: ['Ingvar Kamprad', 'Hans Rausing', 'Erling Persson', 'Stefan Persson'], answer: 0 },
  { q: 'What is "augmented reality"?', options: ['Digital overlays on the real world', 'Fully virtual environments', '3D modeling', 'Video editing'], answer: 0 },
  { q: 'Which company owns Chrome?', options: ['Google', 'Microsoft', 'Apple', 'Mozilla'], answer: 0 },
  { q: 'What does "B2C" stand for?', options: ['Business to Consumer', 'Back to Customer', 'Business to Commerce', 'Brand to Consumer'], answer: 0 },
  { q: 'Who founded Spotify?', options: ['Daniel Ek', 'Markus Persson', 'Niklas Zennström', 'Sean Parker'], answer: 0 },
  { q: 'What is "quantum computing"?', options: ['Computing using quantum-mechanical phenomena', 'Faster classical computing', 'Biological computing', 'Optical computing'], answer: 0 },
  { q: 'Which company makes the most microchips by revenue?', options: ['Intel', 'Samsung', 'TSMC', 'Qualcomm'], answer: 1 },
  { q: 'What does "CAC" stand for in startups?', options: ['Customer Acquisition Cost', 'Capital Allocation Cost', 'Client Activity Cost', 'Corporate Access Cost'], answer: 0 },
  { q: 'Who founded Tesla?', options: ['Elon Musk', 'Martin Eberhard', 'Marc Tarpenning', 'Both B and C'], answer: 3 },
  { q: 'What is "5G"?', options: ['Fifth generation wireless', '5 gigahertz frequency', '5 gigabit speed', 'Fifth generation computer'], answer: 0 },
  { q: 'Which company owns Android?', options: ['Google', 'Samsung', 'Open Handset Alliance', 'Linux Foundation'], answer: 0 },
  { q: 'What does "LTV" stand for in business?', options: ['Lifetime Value', 'Long Term Value', 'Loan to Value', 'Leading Technology Value'], answer: 0 },
  { q: 'Who is the founder of Dell?', options: ['Michael Dell', 'Steve Jobs', 'Bill Gates', 'Larry Ellison'], answer: 0 },
  { q: 'What is "renewable energy"?', options: ['Energy from natural replenishing sources', 'Energy used repeatedly', 'Recycled energy', 'Solar only'], answer: 0 },
  { q: 'Which company developed the first smartphone?', options: ['Apple', 'IBM', 'Nokia', 'BlackBerry'], answer: 1 },
  { q: 'What does "ML" stand for?', options: ['Machine Learning', 'Markup Language', 'Memory Location', 'Micro Logic'], answer: 0 },
  { q: 'Who founded Uber?', options: ['Travis Kalanick', 'Garrett Camp', 'Both', 'Ryan Graves'], answer: 2 },
  { q: 'What is "blockchain" primarily used for?', options: ['Cryptocurrency and records', 'Social networking', 'Email', 'Video streaming'], answer: 0 },
  { q: 'Which company makes the most electric vehicles?', options: ['Tesla', 'BYD', 'NIO', 'Volkswagen'], answer: 1 },
  { q: 'What does "P2P" stand for?', options: ['Peer to Peer', 'Point to Point', 'Path to Profit', 'Product to Platform'], answer: 0 },
  { q: 'Who founded Stripe?', options: ['Patrick and John Collison', 'Elon Musk', 'Peter Thiel', 'Jack Dorsey'], answer: 0 },
  { q: 'What is "regtech"?', options: ['Technology for regulatory compliance', 'Registering technology', 'Tracking technology', 'Regenerative technology'], answer: 0 },
  { q: 'Which company owns Snapchat?', options: ['Snap Inc.', 'Meta', 'Google', 'Twitter'], answer: 0 },
  { q: 'What does "ESG" stand for?', options: ['Environmental, Social, Governance', 'Economic Sustainability Growth', 'Enterprise Security Guidelines', 'Energy Standard Group'], answer: 0 },
  { q: 'Who is considered the first computer programmer?', options: ['Ada Lovelace', 'Alan Turing', 'Charles Babbage', 'Grace Hopper'], answer: 0 },
  { q: 'What is "insurtech"?', options: ['Technology innovation in insurance', 'Insurance for tech', 'Tech insurance policies', 'Insurance regulations'], answer: 0 },
];

const NetworkQuizScreen: React.FC<{ navigation: any; route?: any }> = ({ navigation, route }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const { user } = useAuth();
  const [questions, setQuestions] = useState<any[]>([]);
  const [current, setCurrent] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [challengeVisible, setChallengeVisible] = useState(false);
  const incomingChallengeId = route?.params?.challengeId as string | undefined;
  const [challengeId, setChallengeId] = useState<string | null>(incomingChallengeId || null);
  const [challengeResult, setChallengeResult] = useState<GameChallenge | null>(null);
  const waitingRef = useRef(!!incomingChallengeId);
  const [waitingForOpponent, setWaitingForOpponent] = useState(!!incomingChallengeId);
  const [countdown, setCountdown] = useState(0);

  // Challenge sync: set joined + wait for opponent
  useEffect(() => {
    if (!challengeId || !user?.uid) return;
    let cancelled = false;
    void setPlayerJoined(challengeId, user.uid);
    const unsub = subscribeToChallenge(challengeId, (c) => {
      if (cancelled || !c) return;
      if (c.status === 'completed' || (c.senderScore != null && c.recipientScore != null)) {
        setChallengeResult(c);
        return;
      }
      if (c.senderJoined && c.recipientJoined && waitingRef.current) {
        waitingRef.current = false;
        setWaitingForOpponent(false);
        setCountdown(3);
        const interval = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) { clearInterval(interval); return 0; }
            return prev - 1;
          });
        }, 1000);
      }
    });
    return () => { cancelled = true; unsub(); };
  }, [challengeId, user?.uid]);

  // Timeout: play solo after 15s
  useEffect(() => {
    if (!waitingForOpponent) return;
    const timer = setTimeout(() => { waitingRef.current = false; setWaitingForOpponent(false); }, 15000);
    return () => clearTimeout(timer);
  }, [waitingForOpponent]);

  const shuffleAndStart = useCallback(() => {
    const shuffled = [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, 10);
    setQuestions(shuffled);
    setCurrent(0);
    setScore(0);
    setSelected(null);
    setRevealed(false);
    setFinished(false);
  }, []);

  useEffect(() => { shuffleAndStart(); }, [shuffleAndStart]);

  const handleAnswer = useCallback((index: number) => {
    if (revealed) return;
    setSelected(index);
    setRevealed(true);
    if (index === questions[current].answer) {
      setScore((s) => s + 1);
    }
  }, [revealed, current, questions]);

  const nextQuestion = useCallback(() => {
    if (current + 1 >= questions.length) {
      setFinished(true);
    } else {
      setCurrent((c) => c + 1);
      setSelected(null);
      setRevealed(false);
    }
  }, [current, questions]);

  const shareScore = useCallback(async () => {
    try {
      await Share.share({
        message: `I scored ${score}/${questions.length} on LINKUP Network Quiz! Can you beat me? 🧠`,
      });
    } catch (_) {}
  }, [score, questions]);

  useEffect(() => {
    if (!finished || !challengeId || !user?.uid) return;
    submitChallengeScore(challengeId, user.uid, score).catch(() => {});
  }, [finished, challengeId, user?.uid, score]);

  return (
    <View style={{ flex: 1 }}>
      <SafeAreaView style={[styles.root, appBackground(isDark)]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: textColor(isDark) }]}>← Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: textColor(isDark) }]}>Network Quiz</Text>
        <View style={styles.headerRight} />
      </View>

      {waitingForOpponent ? (
        <View style={styles.waitingWrap}>
          {countdown > 0 ? (
            <Text style={[styles.countdownText, { color: COLORS.primaryStrong }]}>{countdown}</Text>
          ) : (
            <>
              <Loader size={36} color={COLORS.primaryStrong} />
              <Text style={[styles.waitingText, { color: textColor(isDark) }]}>Waiting for opponent...</Text>
              <Text style={[styles.waitingSub, { color: textColor(isDark, 'muted') }]}>Share the challenge so your friend joins</Text>
            </>
          )}
        </View>
      ) : !finished && questions.length > 0 ? (
        <>
          <View style={styles.progressRow}>
            <Brain size={14} color={COLORS.primaryStrong} />
            <Text style={[styles.progressText, { color: textColor(isDark, 'muted') }]}>
              {current + 1} / {questions.length}
            </Text>
            <View style={styles.scoreBadge}>
              <Text style={styles.scoreText}>{score} pts</Text>
            </View>
          </View>

          <View style={styles.progressBarBg}>
            <View
              style={[styles.progressBarFill, { width: `${((current + 1) / questions.length) * 100}%` }]}
            />
          </View>

          <View style={[styles.questionCard, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}>
            <Text style={[styles.questionText, { color: textColor(isDark) }]}>{questions[current].q}</Text>
          </View>

          <View style={styles.options}>
            {questions[current].options.map((opt: string, i: number) => {
              let bg = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
              let borderColor = 'transparent';
              if (revealed && i === questions[current].answer) {
                bg = '#22C55E';
                borderColor = '#22C55E';
              } else if (revealed && i === selected && i !== questions[current].answer) {
                bg = '#FF3B5C';
                borderColor = '#FF3B5C';
              } else if (i === selected) {
                bg = COLORS.primary;
                borderColor = COLORS.primary;
              }
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.optionBtn, { backgroundColor: bg, borderColor }]}
                  onPress={() => handleAnswer(i)}
                  disabled={revealed}
                >
                  <Text style={[styles.optionText, { color: (revealed && (i === questions[current].answer || i === selected)) ? '#FFF' : textColor(isDark) }]}>
                    {opt}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {revealed && (
            <TouchableOpacity style={styles.nextBtn} onPress={nextQuestion}>
              <Text style={styles.nextBtnText}>
                {current + 1 >= questions.length ? 'See Results →' : 'Next →'}
              </Text>
            </TouchableOpacity>
          )}
        </>
      ) : null}

      {finished && challengeResult && (challengeResult.senderScore != null || challengeResult.recipientScore != null) && (
        <View style={styles.finishedContainer}>
          <Text style={styles.finishedEmoji}>🏆</Text>
          <Text style={[styles.finishedScore, { color: textColor(isDark) }]}>Challenge Complete!</Text>
          {challengeResult.senderScore != null && challengeResult.recipientScore != null ? (
            <>
              <Text style={[styles.finishedSub, { color: textColor(isDark, 'muted') }]}>
                You: {user?.uid === challengeResult.senderId ? challengeResult.senderScore : challengeResult.recipientScore}/{questions.length}
              </Text>
              <Text style={[styles.finishedSub, { color: textColor(isDark, 'muted') }]}>
                Opponent: {user?.uid === challengeResult.senderId ? challengeResult.recipientScore : challengeResult.senderScore}/{questions.length}
              </Text>
              <Text style={[styles.finishedSub, { color: textColor(isDark), fontWeight: '900', marginTop: 4 }]}>
                {(() => {
                  const my = user?.uid === challengeResult.senderId ? challengeResult.senderScore : challengeResult.recipientScore;
                  const their = user?.uid === challengeResult.senderId ? challengeResult.recipientScore : challengeResult.senderScore;
                  if (my == null || their == null) return '';
                  if (my > their) return 'You win! 🏆';
                  if (their > my) return 'Opponent wins!';
                  return 'It\'s a tie! 🤝';
                })()}
              </Text>
            </>
          ) : (
            <Text style={[styles.finishedSub, { color: textColor(isDark, 'muted') }]}>Waiting for opponent to play...</Text>
          )}
          <View style={styles.finishedActions}>
            <TouchableOpacity style={styles.finishedBtn} onPress={shuffleAndStart}>
              <RefreshCw size={16} color="#000" />
              <Text style={styles.finishedBtnText}>Play Again</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {finished && !(challengeResult && (challengeResult.senderScore != null || challengeResult.recipientScore != null)) && (
        <View style={styles.finishedContainer}>
          <Text style={styles.finishedEmoji}>{score >= 8 ? '🏆' : score >= 5 ? '👏' : '💪'}</Text>
          <Text style={[styles.finishedScore, { color: textColor(isDark) }]}>
            {score} / {questions.length}
          </Text>
          <Text style={[styles.finishedSub, { color: textColor(isDark, 'muted') }]}>
            {score >= 9 ? 'Founder Genius!' : score >= 7 ? 'Startup Pro!' : score >= 5 ? 'Getting there!' : 'Keep learning!'}
          </Text>
          <View style={styles.finishedActions}>
            <TouchableOpacity style={styles.finishedBtn} onPress={shuffleAndStart}>
              <RefreshCw size={16} color="#000" />
              <Text style={styles.finishedBtnText}>Play Again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.finishedBtn, { backgroundColor: '#FFF' }]} onPress={shareScore}>
              <Share2 size={16} color="#000" />
              <Text style={[styles.finishedBtnText, { color: '#000' }]}>Share</Text>
            </TouchableOpacity>
            {!challengeId && (
              <TouchableOpacity style={[styles.finishedBtn]} onPress={() => setChallengeVisible(true)}>
                <Swords size={16} color="#000" />
                <Text style={styles.finishedBtnText}>Challenge</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
      </SafeAreaView>
      <GameChallengeModal
        visible={challengeVisible}
        gameType="networkquiz"
        gameLabel="Network Quiz"
        currentScore={score}
        onClose={() => setChallengeVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: { padding: 4 },
  backText: { fontSize: 16, fontWeight: '800' },
  title: { fontSize: 20, fontWeight: '900', letterSpacing: -0.5 },
  headerRight: { width: 60 },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  progressText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  scoreBadge: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 16,
  },
  scoreText: { fontSize: 11, fontWeight: '900', color: '#000' },
  progressBarBg: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 2,
    marginHorizontal: 24,
    marginBottom: 24,
  },
  progressBarFill: {
    height: 4,
    backgroundColor: COLORS.primary,
    borderRadius: 2,
  },
  questionCard: {
    marginHorizontal: 24,
    borderRadius: 16,
    padding: 24,
    marginBottom: 24,
  },
  questionText: {
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 26,
  },
  options: { paddingHorizontal: 24, gap: 10 },
  optionBtn: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 14,
    borderWidth: 2,
  },
  optionText: { fontSize: 14, fontWeight: '700' },
  nextBtn: {
    marginHorizontal: 24,
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
  },
  nextBtnText: { fontSize: 14, fontWeight: '900', color: '#000' },
  finishedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  finishedEmoji: { fontSize: 56, marginBottom: 4 },
  finishedScore: { fontSize: 42, fontWeight: '900' },
  finishedSub: { fontSize: 14, fontWeight: '700', marginBottom: 20 },
  finishedActions: { flexDirection: 'row', gap: 12 },
  finishedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
  },
  finishedBtnText: { fontSize: 12, fontWeight: '900', color: '#000' },
  waitingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  waitingText: { fontSize: 18, fontWeight: '900', marginTop: 16, textAlign: 'center' },
  waitingSub: { fontSize: 12, fontWeight: '600', marginTop: 8, textAlign: 'center' },
  countdownText: { fontSize: 72, fontWeight: '900' },
});

export default NetworkQuizScreen;