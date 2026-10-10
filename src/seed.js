// Sample questions and tests so the simulator works out of the box.
// In production, import your real question bank with /admin/questions/import (see README).
import { db } from './store.js';

const Q = (product) => ([subject, topic, question, options, answer, explanation = '']) => ({ product, subject, topic, question, options, answer, explanation, tags: ['sample'], createdAt: new Date() });

const NEET = [
  ['Biology', 'Cell biology', 'Which organelle is called the powerhouse of the cell?', ['Ribosome', 'Mitochondria', 'Golgi body'], 1, 'Mitochondria make ATP through cellular respiration.'],
  ['Biology', 'Human physiology', 'Which blood cells have no nucleus in humans?', ['Leucocytes', 'Erythrocytes', 'Lymphocytes'], 1, 'Mature RBCs lose their nucleus to carry more haemoglobin.'],
  ['Biology', 'Genetics', 'The phenotypic ratio of a monohybrid cross in F2 is:', ['3:1', '9:3:3:1', '1:2:1'], 0],
  ['Biology', 'Plant physiology', 'Which pigment is mainly responsible for photosynthesis?', ['Carotene', 'Chlorophyll a', 'Xanthophyll'], 1],
  ['Biology', 'Human physiology', 'Normal adult human blood pressure is about:', ['120/80 mm Hg', '80/120 mm Hg', '140/100 mm Hg'], 0],
  ['Biology', 'Ecology', 'Which of these is a primary consumer?', ['Grasshopper', 'Frog', 'Snake'], 0],
  ['Biology', 'Reproduction', 'Fertilisation in humans usually takes place in the:', ['Uterus', 'Ampullary region of oviduct', 'Cervix'], 1],
  ['Biology', 'Biomolecules', 'Enzymes are mostly made of:', ['Lipids', 'Proteins', 'Carbohydrates'], 1],
  ['Biology', 'Genetics', 'DNA replication is:', ['Conservative', 'Semi-conservative', 'Dispersive'], 1, 'Proved by Meselson and Stahl.'],
  ['Biology', 'Human physiology', 'Insulin is secreted by:', ['Alpha cells', 'Beta cells', 'Delta cells'], 1],
  ['Physics', 'Electrostatics', 'SI unit of electric charge?', ['Ampere', 'Volt', 'Coulomb'], 2],
  ['Physics', 'Optics', 'Unit of power of a lens?', ['Dioptre', 'Watt', 'Lux'], 0],
  ['Physics', 'Kinematics', 'Slope of a velocity-time graph gives:', ['Displacement', 'Acceleration', 'Speed'], 1],
  ['Physics', 'Laws of motion', 'Newton\'s first law is also called the law of:', ['Inertia', 'Momentum', 'Action'], 0],
  ['Physics', 'Work and energy', 'Kinetic energy of a body of mass m and speed v is:', ['mv', '½mv²', 'mv²'], 1],
  ['Physics', 'Current electricity', 'Resistance of a wire increases when its length:', ['Decreases', 'Increases', 'Stays same'], 1],
  ['Physics', 'Optics', 'Focal length of a plane mirror is:', ['Zero', 'Infinite', 'Equal to its size'], 1],
  ['Physics', 'Gravitation', 'Value of g on the Moon is about … of Earth\'s:', ['1/2', '1/6', '1/10'], 1],
  ['Physics', 'Thermodynamics', 'In an isothermal process, which stays constant?', ['Pressure', 'Volume', 'Temperature'], 2],
  ['Physics', 'Modern physics', 'Photoelectric effect shows the … nature of light.', ['Wave', 'Particle', 'Transverse'], 1],
  ['Chemistry', 'Chemical bonding', 'Hybridisation of carbon in methane?', ['sp', 'sp²', 'sp³'], 2],
  ['Chemistry', 'Periodic table', 'Most electronegative element is:', ['Oxygen', 'Fluorine', 'Chlorine'], 1],
  ['Chemistry', 'Mole concept', 'Avogadro\'s number is about:', ['6.02 × 10²³', '3.0 × 10⁸', '1.6 × 10⁻¹⁹'], 0],
  ['Chemistry', 'Organic chemistry', 'General formula of alkanes is:', ['CnH2n', 'CnH2n+2', 'CnH2n-2'], 1],
  ['Chemistry', 'Equilibrium', 'pH of pure water at 25°C is:', ['0', '7', '14'], 1],
  ['Chemistry', 'Atomic structure', 'Number of orbitals in the d subshell:', ['3', '5', '7'], 1],
  ['Chemistry', 'Redox', 'Oxidation means:', ['Gain of electrons', 'Loss of electrons', 'Gain of protons'], 1],
  ['Chemistry', 'Organic chemistry', 'Benzene has how many π electrons?', ['4', '6', '8'], 1],
  ['Chemistry', 'Solutions', 'Molarity is moles of solute per:', ['kg of solvent', 'litre of solution', 'litre of solvent'], 1],
  ['Chemistry', 'States of matter', 'At constant temperature, PV = constant is:', ['Charles\'s law', 'Boyle\'s law', 'Avogadro\'s law'], 1],
];

const CLASS = [
  ['Class 10 Science', 'Light', 'The focal length of a plane mirror is:', ['Zero', 'Infinite', 'Equal to its size'], 1],
  ['Class 10 Science', 'Light', 'A convex lens is also called a:', ['Diverging lens', 'Converging lens', 'Plane lens'], 1],
  ['Class 10 Science', 'Light', 'The SI unit of power of a lens is:', ['Metre', 'Dioptre', 'Watt'], 1],
  ['Class 10 Science', 'Light', 'Refractive index of a medium is the ratio of speed of light in:', ['Medium to vacuum', 'Vacuum to medium', 'Air to water'], 1],
  ['Class 10 Science', 'Light', 'Image formed by a plane mirror is:', ['Real and inverted', 'Virtual and erect', 'Real and erect'], 1],
  ['Class 10 Science', 'Electricity', 'SI unit of resistance is:', ['Volt', 'Ohm', 'Ampere'], 1],
  ['Class 10 Science', 'Electricity', 'Ohm\'s law relates:', ['V and I', 'P and t', 'Q and t'], 0],
  ['Class 10 Science', 'Electricity', 'Resistors in series have the same:', ['Voltage', 'Current', 'Power'], 1],
  ['Class 10 Science', 'Chemical reactions', 'Rusting of iron is an example of:', ['Reduction', 'Oxidation', 'Neutralisation'], 1],
  ['Class 10 Science', 'Chemical reactions', 'Decomposition of limestone gives CaO and:', ['O₂', 'CO₂', 'H₂O'], 1],
  ['Class 10 Science', 'Acids and bases', 'Turmeric turns … in a basic solution.', ['Red', 'Blue', 'Green'], 0],
  ['Class 10 Science', 'Life processes', 'Site of photosynthesis in a leaf:', ['Mitochondria', 'Chloroplast', 'Nucleus'], 1],
  ['Class 10 Maths', 'Trigonometry', 'sin 30° equals:', ['1/2', '√3/2', '1'], 0],
  ['Class 10 Maths', 'Trigonometry', 'tan 45° equals:', ['0', '1', '√3'], 1],
  ['Class 10 Maths', 'Trigonometry', 'sin²θ + cos²θ =', ['0', '1', '2'], 1],
  ['Class 10 Maths', 'Trigonometry', 'cos 60° equals:', ['1/2', '√3/2', '0'], 0],
  ['Class 10 Maths', 'Quadratic equations', 'Roots of x² − 5x + 6 = 0 are:', ['2 and 3', '1 and 6', '−2 and −3'], 0],
  ['Class 10 Maths', 'Quadratic equations', 'If b² − 4ac < 0, the roots are:', ['Real and equal', 'Real and distinct', 'Not real'], 2],
  ['Class 10 Maths', 'Arithmetic progressions', 'Common difference of 3, 7, 11, … is:', ['3', '4', '7'], 1],
  ['Class 10 Maths', 'Real numbers', 'HCF of 12 and 18 is:', ['3', '6', '36'], 1],
  ['Class 10 Maths', 'Circles', 'A tangent to a circle is … to the radius at the point of contact.', ['Parallel', 'Perpendicular', 'Equal'], 1],
  ['Class 10 Maths', 'Statistics', 'The most frequent value in data is the:', ['Mean', 'Median', 'Mode'], 2],
  ...NEET.filter(([s]) => s === 'Biology').map(([, t, q, o, a, e]) => ['NEET Biology', t, q, o, a, e]),
  ...NEET.filter(([s]) => s === 'Physics').map(([, t, q, o, a, e]) => ['NEET Physics', t, q, o, a, e]),
];

const GK = [
  ['General Awareness', 'History', 'First Governor-General of independent India?', ['C. Rajagopalachari', 'Lord Mountbatten', 'Rajendra Prasad'], 1],
  ['General Awareness', 'Geography', 'Which river is called the Sorrow of Bihar?', ['Kosi', 'Gandak', 'Son'], 0],
  ['General Awareness', 'Polity', 'Article 21 of the Constitution deals with:', ['Right to Equality', 'Life and personal liberty', 'Right to Education'], 1],
  ['General Awareness', 'Science', 'ISRO headquarters is in:', ['Bengaluru', 'Sriharikota', 'Chennai'], 0],
  ['General Awareness', 'Polity', 'Minimum age to become President of India:', ['25 years', '30 years', '35 years'], 2],
  ['General Awareness', 'History', 'The Battle of Plassey was fought in:', ['1757', '1764', '1857'], 0],
  ['General Awareness', 'Geography', 'Largest state of India by area:', ['Madhya Pradesh', 'Rajasthan', 'Maharashtra'], 1],
  ['General Awareness', 'Economy', 'The Reserve Bank of India was set up in:', ['1935', '1947', '1950'], 0],
  ['General Awareness', 'Science', 'Vitamin C deficiency causes:', ['Rickets', 'Scurvy', 'Beriberi'], 1],
  ['General Awareness', 'Sports', 'The Durand Cup is linked with:', ['Cricket', 'Football', 'Hockey'], 1],
  ['General Awareness', 'Polity', 'The Rajya Sabha can have at most:', ['238 members', '250 members', '552 members'], 1],
  ['General Awareness', 'Geography', 'The Tropic of Cancer does NOT pass through:', ['Rajasthan', 'Odisha', 'Tripura'], 1],
];

export async function seed({ force = false, withTests = true } = {}) {
  if (!force && (await db.questions.count({})) > 0) return false;
  await db.questions.insertMany([...NEET.map(Q('yneet')), ...CLASS.map(Q('classcoach')), ...GK.map(Q('testmandi'))]);
  if (!withTests) return true; // production: questions only, no demo seller or tests
  const gk = await db.questions.find({ product: 'testmandi' });
  const ids = gk.map((q) => q._id);
  const seller = { sellerPhone: '919999900001', sellerName: 'Raise Academy', sellerShare: 0.8 };
  const base = { attemptsCount: 0, salesCount: 0, ratingSum: 0, ratingCount: 0, revenue: 0, createdAt: new Date(), listed: true, language: 'English', type: 'test' };
  await db.tests.insertMany([
    { ...base, ...seller, code: 'SSC-GK-101', title: 'SSC CGL GK Mock 1', category: 'SSC', price: 29, durationMin: 10, qids: ids.slice(0, 8) },
    { ...base, ...seller, code: 'SSC-GK-102', title: 'SSC CGL GK Mock 2', category: 'SSC', price: 29, durationMin: 10, qids: ids.slice(4, 12) },
    { ...base, ...seller, code: 'GK-FREE-1', title: 'Daily GK Practice (Free)', category: 'General Knowledge', price: 0, durationMin: 5, qids: ids.slice(0, 5) },
    { ...base, ...seller, code: 'TNPSC-GK-1', title: 'TNPSC Group 4 GK Mock', category: 'TNPSC', price: 19, durationMin: 10, qids: ids.slice(2, 10) },
    { ...base, ...seller, code: 'SSC-GK-PACK', title: 'SSC GK Mock Pack', type: 'bundle', price: 49, testCodes: ['SSC-GK-101', 'SSC-GK-102'] },
  ]);
  return true;
}
