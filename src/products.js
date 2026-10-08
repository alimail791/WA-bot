// Product settings: names, links and prices. Edit prices here; every message reads from this file.
// Prices are in rupees. "anchor" is the normal price shown crossed out next to the offer.
export const products = {
  yneet: {
    key: 'yneet',
    name: 'YNeet',
    botName: 'YNeet Tests',
    webBase: 'https://app.yneet.in',
    exam: 'NEET',
    mockSize: 180,
    // Price ladder: the middle plan is the one we want most people to pick.
    offers: {
      analysis: { id: 'analysis', title: 'Full analysis', price: 49, desc: 'Chapter accuracy, predicted rank, revision list' },
      pack10: { id: 'pack10', title: '10 mocks + analysis', price: 199, anchor: 490, desc: 'Best value · ₹20 per mock', best: true },
      season: { id: 'season', title: 'Season pass to NEET', price: 999, anchor: 2499, desc: 'Unlimited mocks, daily quiz, parent reports' },
    },
    streakReward: 3, // days of daily quiz streak that earn 1 free analysis
    referralReward: 1, // free analyses for both sides when a friend joins and attempts a quiz
    dailyQuizSize: 3,
  },

  testmandi: {
    key: 'testmandi',
    name: 'TestMandi',
    botName: 'TestMandi',
    webBase: 'https://testmandi.in',
    sellerShare: 0.7, // seller's share of each sale
    freeSample: 5, // free sample questions before buying
    pageSize: 8, // tests per page when browsing
    referral: {
      friendDiscount: 10, // ₹ off the invited buyer's first purchase
      buyerReward: 10, // ₹ wallet credit to the inviter when that friend's first purchase is paid
      sellerBonusPct: 0.05, // inviting seller earns 5% of an invited seller's sales (paid from the platform's share)
      sellerBonusDays: 180, // ...for this many days after the invited seller joins
    },
  },

  classcoach: {
    key: 'classcoach',
    name: 'ClassCoach',
    botName: 'ClassCoach',
    webBase: 'https://classcoach.in',
    freeStudents: 20, // free tier class size
    graceStudents: 5, // students allowed over the limit so no student is turned away mid-quiz
    trialDays: 14, // full Pro features for new tutors, then back to Free unless they upgrade
    quizSize: 10,
    referral: {
      friendDiscount: 50, // ₹ off the invited tutor's first paid plan
      rewardDays: 30, // free Pro days for the inviter when that tutor pays
    },
    plans: {
      pro50: { id: 'pro50', title: 'Pro 50 students', price: 299, period: 'month', students: 50 },
      pro100: { id: 'pro100', title: 'Pro 100 students', price: 499, period: 'month', students: 100, best: true },
      pro100y: { id: 'pro100y', title: 'Pro 100 · yearly', price: 4990, anchor: 5988, period: 'year', students: 100, desc: '2 months free' },
      neet: { id: 'neet', title: 'NEET/JEE question pack', price: 199, period: 'month', desc: '4,000+ PCB questions incl. PYQs', addon: true },
    },
  },
};

export const productKeys = Object.keys(products);
export const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN');
