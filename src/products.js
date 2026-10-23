// Product settings: names, links and prices. Edit prices here; every message reads from this file.
// Prices are in rupees. "anchor" is the normal price shown crossed out next to the offer.
export const products = {
  yneet: {
    key: 'yneet',
    name: 'YNeet',
    botName: 'YNeet Tests',
    webBase: 'https://app.yneet.in',
    exam: 'NEET',
    classes: ['6th', '7th', '8th', '9th', '10th', '11th', '12th', 'Dropper'],
    // Same plans and prices as app.yneet.in (subscriptionController.js)
    // Free 30-day full-access trial, once per student (replaces the old ₹99 / 5-day plan)
    trial: { id: 'trial30d', key: 'TRIAL_30D', title: '30-day free trial', price: 0, days: 30 },
    // Monthly plan: buy 1 to 12 months in one payment; these are the quick choices shown in chat
    monthOptions: [1, 3, 6, 12],
    maxMonths: 12,
    monthlyByClass: { Dropper: 600, '12th': 500, '11th': 500, '10th': 400, '9th': 400, '8th': 300, '7th': 300, '6th': 300 },
    // NEET pattern: 180 questions, 180 minutes, +4 / −1
    mockPattern: { Physics: 45, Chemistry: 45, Biology: 90 },
    mockMinutes: 180,
    // Free "NEET score check": a short 30-question test that gives a projected /720 score, an estimated
    // rank and 3 weak chapters. It is the first thing new students are offered (a 3-hour mock is too big an ask).
    scoreCheck: { pattern: { Physics: 8, Chemistry: 8, Biology: 14 }, minutes: 35 },
    chapterTestSize: 15,
    pyqTestSize: 30,
    dailyQuizSize: 3,
    free: { mocks: 1, chapterTestsPerDay: 1 },
    streakReward: 3, // every 3-day quiz streak earns 1 free premium test
    referralCredits: 1, // free premium tests for both when an invited friend takes their first quiz
    referralMonthDays: 30, // inviter's free days when the friend buys the monthly plan (YNeet's rule)
  },

  testmandi: {
    key: 'testmandi',
    name: 'TestMandi',
    botName: 'TestMandi',
    webBase: 'https://testmandi.in',
    sellerShare: 0.8, // seller's share of each sale
    freeSample: 5, // free sample questions before buying
    pageSize: 8, // tests per page when browsing
    referral: {
      friendDiscount: 10, // ₹ off the invited buyer's first purchase
      sellerReferrerReward: 200, // ₹ to a TestMandi seller's payout when a buyer they invited makes a first purchase (testmandi.in rule)
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
    // Same plans and rules as classcoach.in (lib/plans.js, lib/referrals.js)
    trialDays: 30, // 1-month free trial
    trialStudents: 10,
    graceStudents: 0, // after the limit, new students wait until the teacher upgrades
    quizSize: 10,
    referral: { needed: 2, rewardMonths: 2 }, // every 2 invited teachers who buy → 2 months free
    plans: {
      starter: { id: 'starter', title: 'Starter · 20 students', price: 499, months: 2, students: 20, track: 'general' },
      growth: { id: 'growth', title: 'Growth · 50 students', price: 999, months: 2, students: 50, track: 'general', best: true },
      pro: { id: 'pro', title: 'Pro · 100 students', price: 1999, months: 2, students: 100, track: 'general' },
      starter_y: { id: 'starter_y', title: 'Starter 20 · yearly', price: 2499, months: 12, students: 20, track: 'general' },
      growth_y: { id: 'growth_y', title: 'Growth 50 · yearly', price: 4999, months: 12, students: 50, track: 'general' },
      pro_y: { id: 'pro_y', title: 'Pro 100 · yearly', price: 9999, months: 12, students: 100, track: 'general' },
      nj20_m: { id: 'nj20_m', title: 'NEET/JEE 20 · monthly', price: 599, months: 1, students: 20, track: 'neet_jee' },
      nj50_m: { id: 'nj50_m', title: 'NEET/JEE 50 · monthly', price: 1199, months: 1, students: 50, track: 'neet_jee' },
      nj100_m: { id: 'nj100_m', title: 'NEET/JEE 100 · monthly', price: 1999, months: 1, students: 100, track: 'neet_jee' },
      nj20_y: { id: 'nj20_y', title: 'NEET/JEE 20 · yearly', price: 5999, months: 12, students: 20, track: 'neet_jee' },
      nj50_y: { id: 'nj50_y', title: 'NEET/JEE 50 · yearly', price: 11999, months: 12, students: 50, track: 'neet_jee' },
      nj100_y: { id: 'nj100_y', title: 'NEET/JEE 100 · yearly', price: 19999, months: 12, students: 100, track: 'neet_jee' },
    },
  },
};

export const productKeys = Object.keys(products);
export const rupees = (n) => '₹' + Number(n).toLocaleString('en-IN');
